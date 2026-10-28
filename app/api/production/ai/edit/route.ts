// Endpoint: "Pídele a la IA" del editor. Traduce una instrucción en lenguaje
// natural a operaciones (lib/production/edit-ops.ts) con Gemini y devuelve la
// pieza editada + las imágenes que hay que generar. Sirve para el master,
// las orientaciones y los ajustes manuales de formatos: recibe el árbol que
// el editor tiene en pantalla (con cambios sin guardar).
//
// URL: POST /api/production/ai/edit
//   Body: {
//     production_project_id: number,
//     template_id?: number,        // para resolver su brand kit explícito
//     definition: TemplateDefinition,
//     instruction: string,
//     selected_ids?: string[],
//   }
//
// Devuelve { definition, images: [{ layer_id, prompt }], skins: [{ layer_id,
// kind, prompt, colors }], textures: [{ layer_id, prompt }], rationale, skipped, tokenUsage, invocation_id }. NO persiste: el editor aplica el resultado
// como un cambio deshacible y lo guarda con su autosave normal. Las imágenes
// las genera el cliente con /api/production/ai/generate-images y las pieles
// con /api/production/ai/generate-skin.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { TemplateDefinition } from "@/lib/production/types";
import { EMPTY_KIT_CONTENT, resolveColor, BrandKitContent } from "@/lib/production/brand-kit";
import { resolveTemplateBrandKit } from "@/lib/production/project-brand-kit";
import { checkProductionAiQuota, quotaBlockedBody } from "@/lib/production/ai-rate-limit";
import { loadClientBrandGuide } from "@/lib/production/plan-generation";
import { applyEditOps } from "@/lib/production/edit-ops";
import { requestEditPlan, EDIT_PLANNER_AGENT_NAME, EDIT_PLANNER_MODEL } from "@/lib/production/edit-planner";
import type { LayoutFixUsage } from "@/lib/production/layout-fixer";
import { downloadReference } from "@/lib/production/reference-images";
import { imageSize } from "@/lib/production/image-size";
import type { TemplateLayer, ImageLayer } from "@/lib/production/types";

// Cuántas fotos de capas se le muestran al modelo (cada una cuesta ~1k
// tokens). Primero las seleccionadas, después las más grandes.
const MAX_LAYER_IMAGES = 3;

async function loadLayerImages(tree: TemplateDefinition, selected: string[]) {
  const images: ImageLayer[] = [];
  const walk = (nodes: TemplateLayer[]) =>
    nodes.forEach((n) => {
      if (n.type === "image" && n.src) images.push(n);
      if (n.type === "frame") walk(n.children);
    });
  walk(tree.children);
  const pick = images
    .sort((a, b) => {
      const sa = selected.includes(a.id) ? 1 : 0;
      const sb = selected.includes(b.id) ? 1 : 0;
      return sb - sa || b.size.w * b.size.h - a.size.w * a.size.h;
    })
    .slice(0, MAX_LAYER_IMAGES);
  const out = await Promise.all(
    pick.map(async (l) => {
      try {
        const img = await downloadReference(l.src!);
        const size = imageSize(Buffer.from(img.data, "base64"));
        return { layerId: l.id, ...img, size };
      } catch {
        // Fotos fuera de nuestro bucket (o caídas) no se mandan; el modelo
        // sigue teniendo la caja en números.
        return null;
      }
    }),
  );
  return out.filter((x): x is NonNullable<typeof x> => x !== null);
}

const bodySchema = z.object({
  production_project_id: z.number().int().positive(),
  template_id: z.number().int().positive().optional(),
  definition: z.unknown(),
  instruction: z.string().trim().min(2).max(2000),
  selected_ids: z.array(z.string().max(100)).max(50).optional(),
});

interface ProjectRow extends RowDataPacket {
  client_id: number;
}
interface TemplateRow extends RowDataPacket {
  brand_kit_id: number | null;
}

function asRootTree(raw: unknown): TemplateDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<TemplateDefinition>;
  if (t.type !== "frame" || !Array.isArray(t.children) || !t.size || !t.layout) return null;
  return t as TemplateDefinition;
}

// Color de fondo de la capa (resuelto) para la piel que se va a generar.
function skinColors(def: TemplateDefinition, layerId: string, kit: BrandKitContent): string[] {
  const find = (nodes: TemplateLayer[]): TemplateLayer | null => {
    for (const n of nodes) {
      if (n.id === layerId) return n;
      if (n.type === "frame") {
        const f = find(n.children);
        if (f) return f;
      }
    }
    return null;
  };
  const l = find(def.children);
  if (l?.type !== "text" || !l.style.backgroundColor) return [];
  const c = resolveColor(l.style.backgroundColor, kit, "");
  return /^#[0-9a-f]{3,8}$/i.test(c) ? [c] : [];
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = Number(session.user.id);
    const parsed = await parseBody(request, bodySchema);
    if (parsed.error) return parsed.error;
    const { production_project_id, template_id, instruction } = parsed.data;
    const tree = asRootTree(parsed.data.definition);
    if (!tree) return NextResponse.json({ error: "Pieza inválida" }, { status: 400 });

    const [projRows] = await pool.execute<ProjectRow[]>(
      "SELECT client_id FROM production_projects WHERE id = ? AND deleted_at IS NULL",
      [production_project_id],
    );
    if (projRows.length === 0) {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }
    const clientId = projRows[0].client_id;

    const quota = await checkProductionAiQuota({ projectId: production_project_id, userId });
    if (!quota.ok) return NextResponse.json(quotaBlockedBody(quota), { status: 429 });

    let brandKitId: number | null = null;
    if (template_id) {
      const [tplRows] = await pool.execute<TemplateRow[]>(
        "SELECT brand_kit_id FROM production_templates WHERE id = ? AND production_project_id = ? AND deleted_at IS NULL",
        [template_id, production_project_id],
      );
      brandKitId = tplRows[0]?.brand_kit_id ?? null;
    }
    const kit =
      (
        await resolveTemplateBrandKit({
          brandKitId,
          clientId,
          productionProjectId: production_project_id,
        })
      )?.content ?? EMPTY_KIT_CONTENT;

    const startedAt = Date.now();
    let usage: LayoutFixUsage | null = null;
    let body: Record<string, unknown>;
    let error: string | null = null;
    let rationale: string | null = null;
    try {
      const selectedIds = parsed.data.selected_ids ?? [];
      const layerImages = await loadLayerImages(tree, selectedIds);
      const photoSizes: Record<string, { w: number; h: number }> = {};
      for (const li of layerImages) if (li.size) photoSizes[li.layerId] = li.size;
      const plan = await requestEditPlan({
        tree,
        instruction,
        selectedIds,
        layerImages,
        brandKit: kit,
        brandGuide: await loadClientBrandGuide(clientId),
      });
      usage = plan.usage;
      rationale = plan.rationale;
      const result = applyEditOps(tree, plan.ops, undefined, photoSizes, {
        resolveColor: (c) => resolveColor(c, kit, c),
        accent: kit.colors[0]?.value,
      });
      body = {
        definition: result.definition,
        images: result.images,
        skins: result.skins.map((sk) => ({ ...sk, colors: skinColors(result.definition, sk.layer_id, kit) })),
        textures: result.textures,
        applied: result.applied,
        skipped: result.skipped,
        rationale: plan.rationale,
      };
    } catch (e) {
      usage = (e as { usage?: LayoutFixUsage }).usage ?? null;
      error = (e as Error).message;
      body = {};
    }

    const [inv] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_ai_invocations
         (production_project_id, template_id, target_template_id, operation,
          agent_name, model, input_tokens, output_tokens, estimated_cost, duration_ms,
          success, error_msg, conversation_id, rationale, created_by)
       VALUES (?, ?, NULL, 'EDIT', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        production_project_id,
        template_id ?? null,
        EDIT_PLANNER_AGENT_NAME,
        EDIT_PLANNER_MODEL,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        usage?.estimatedCost ?? null,
        Date.now() - startedAt,
        error ? 0 : 1,
        error,
        rationale ? `${instruction.slice(0, 500)} → ${rationale}` : instruction.slice(0, 500),
        userId,
      ],
    );

    if (error) {
      return NextResponse.json({ error, invocation_id: inv.insertId, tokenUsage: usage }, { status: 502 });
    }
    return NextResponse.json({ ...body, tokenUsage: usage, invocation_id: inv.insertId });
  } catch (error) {
    console.error("Error en ai/edit:", error);
    return NextResponse.json({ error: `Error interno: ${(error as Error).message}` }, { status: 500 });
  }
}
