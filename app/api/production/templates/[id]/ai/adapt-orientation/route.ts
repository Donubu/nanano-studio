// Endpoint: "Adaptar con IA" de una orientación a partir del master del
// mismo design. Gemini directo, sin practicante:
//   1. el motor adapta el master a las dims del target (adaptTree),
//   2. Gemini recompone con correcciones por capa (layout-fixer.ts en modo
//      recompose: cambio de orientación, puede reubicar todo), con la captura
//      del master como referencia del original si viene,
//   3. lint y, si quedan errores, una segunda pasada.
//
// URL: /api/production/templates/[id]/ai/adapt-orientation
//   - [id] = id del template que SE VA A ADAPTAR (target orientation; suele
//     ser una variante linked dentro del design).
//   - Body: { instructions?: string, files?: [{ filename, publicUrl, mimeType }] }
//
// Devuelve { proposal: TemplateDefinition, rationale, tokenUsage, invocation_id }.
//
// IMPORTANTE: NO escribe el resultado en production_templates. El cliente
// muestra preview y solo persiste si el productor acepta — vía PUT al template.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { TemplateDefinition } from "@/lib/production/types";
import { EMPTY_KIT_CONTENT } from "@/lib/production/brand-kit";
import { resolveTemplateBrandKit } from "@/lib/production/project-brand-kit";
import { checkProductionAiQuota, quotaBlockedBody } from "@/lib/production/ai-rate-limit";
import { resolveTreeTokens } from "@/lib/production/brand-kit";
import { adaptTree } from "@/lib/production/adapt";
import { collapseShapeTextPairs } from "@/lib/production/composites";
import {
  runLayoutFix,
  LayoutFixUsage,
  LAYOUT_FIXER_MODEL,
  LAYOUT_FIXER_AGENT_NAME,
} from "@/lib/production/layout-fixer";
import { downloadReference } from "@/lib/production/reference-images";

interface TemplateRow extends RowDataPacket {
  id: number;
  production_project_id: number;
  design_id: number | null;
  linked_to_template_id: number | null;
  name: string;
  base_width: number;
  base_height: number;
  definition_json: string;
  brand_kit_id: number | null;
}

interface ProjectRow extends RowDataPacket {
  client_id: number;
}

// `files`: captura del master renderizado (el cliente la sube a
// /api/production/upload). Se descarga y va a Gemini como imagen nativa, como
// referencia visual del diseño original. Solo se usa la primera.
const bodySchema = z.object({
  instructions: z.string().max(2000).optional(),
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        publicUrl: z.string().url().max(2000),
        mimeType: z.string().min(1).max(100),
      }),
    )
    .max(4)
    .optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id: rawId } = await params;
    const targetId = Number(rawId);
    if (!Number.isFinite(targetId)) {
      return NextResponse.json({ error: "Template inválido" }, { status: 400 });
    }

    const parsed = await parseBody(request, bodySchema);
    if (parsed.error) return parsed.error;
    const { instructions, files } = parsed.data;

    // 1. Target template
    const [targetRows] = await pool.execute<TemplateRow[]>(
      `SELECT id, production_project_id, design_id, linked_to_template_id,
              name, base_width, base_height, definition_json, brand_kit_id
         FROM production_templates
        WHERE id = ? AND deleted_at IS NULL`,
      [targetId],
    );
    if (targetRows.length === 0) {
      return NextResponse.json(
        { error: "Template target no encontrado" },
        { status: 404 },
      );
    }
    const target = targetRows[0];
    if (target.design_id == null) {
      return NextResponse.json(
        { error: "El target no pertenece a un design — no hay master del que adaptar" },
        { status: 400 },
      );
    }

    // 2. Master = principal del design (MIN id sin linked_to_template_id).
    // Si target ES el principal, rechazamos: adaptar el master a sí mismo no
    // tiene sentido. El flujo correcto es usar el master como referencia para
    // OTRA orientación.
    const [principalRows] = await pool.execute<TemplateRow[]>(
      `SELECT id, production_project_id, design_id, linked_to_template_id,
              name, base_width, base_height, definition_json, brand_kit_id
         FROM production_templates
        WHERE design_id = ? AND linked_to_template_id IS NULL AND deleted_at IS NULL
        ORDER BY id ASC LIMIT 1`,
      [target.design_id],
    );
    if (principalRows.length === 0) {
      return NextResponse.json(
        { error: "No se encontró el master del design" },
        { status: 404 },
      );
    }
    const masterRow = principalRows[0];
    if (masterRow.id === target.id) {
      return NextResponse.json(
        {
          error:
            "Estás adaptando el master a sí mismo. Usa ✨ desde una variante (cuadrado, vertical, etc.).",
        },
        { status: 400 },
      );
    }

    let masterDefinition: TemplateDefinition;
    try {
      masterDefinition = JSON.parse(masterRow.definition_json) as TemplateDefinition;
    } catch {
      return NextResponse.json(
        { error: "Master tiene definition_json corrupto" },
        { status: 500 },
      );
    }

    // 3. Tope de uso + brand kit efectivo del target (explícito → fork del
    // proyecto → kit de la marca). Mismo resolver que usa el editor.
    const quota = await checkProductionAiQuota({
      projectId: target.production_project_id,
      userId: Number(session.user.id),
    });
    if (!quota.ok) {
      return NextResponse.json(quotaBlockedBody(quota), { status: 429 });
    }
    const [projRows] = await pool.execute<ProjectRow[]>(
      "SELECT client_id FROM production_projects WHERE id = ?",
      [target.production_project_id],
    );
    const resolvedKit =
      projRows.length > 0
        ? await resolveTemplateBrandKit({
            brandKitId: target.brand_kit_id ?? masterRow.brand_kit_id,
            clientId: projRows[0].client_id,
            productionProjectId: target.production_project_id,
          })
        : null;
    const mergedKit = resolvedKit?.content ?? EMPTY_KIT_CONTENT;

    // 4. Motor + Gemini
    let masterImage: { mimeType: string; data: string } | null = null;
    if (files && files.length > 0) {
      try {
        masterImage = await downloadReference(files[0].publicUrl);
      } catch (e) {
        console.warn("adapt-orientation: sin captura del master:", (e as Error).message);
      }
    }
    const targetDims = { w: target.base_width, h: target.base_height };
    const master = collapseShapeTextPairs(masterDefinition).definition;
    const base = adaptTree(master, targetDims);
    const startedAt = Date.now();
    let result:
      | { ok: true; tree: TemplateDefinition; rationale: string; usage: LayoutFixUsage }
      | { ok: false; error: string; usage: LayoutFixUsage | null };
    try {
      const res = await runLayoutFix({
        tree: base,
        sourceTree: master,
        view: (t) => resolveTreeTokens(t, mergedKit),
        image: masterImage,
        imageRole: "original",
        recompose: true,
        instructions,
      });
      result = { ok: true, tree: res.tree, rationale: res.rationale, usage: res.usage };
    } catch (e) {
      result = {
        ok: false,
        error: (e as Error).message,
        usage: (e as { usage?: LayoutFixUsage }).usage ?? null,
      };
    }

    // 5. Registrar invocación. Lo hacemos pase lo que pase, incluso si falla,
    // para tener auditoría de costos y errores.
    const usage = result.usage;
    const [inv] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_ai_invocations
         (production_project_id, template_id, target_template_id, operation,
          agent_name, model, input_tokens, output_tokens, estimated_cost, duration_ms,
          success, error_msg, conversation_id, rationale, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        target.production_project_id,
        masterRow.id,
        target.id,
        "ADAPT_ORIENTATION",
        LAYOUT_FIXER_AGENT_NAME,
        LAYOUT_FIXER_MODEL,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        usage?.estimatedCost ?? null,
        Date.now() - startedAt,
        result.ok ? 1 : 0,
        result.ok ? null : result.error,
        result.ok ? result.rationale : null,
        Number(session.user.id),
      ],
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, invocation_id: inv.insertId, tokenUsage: usage },
        { status: 502 },
      );
    }

    return NextResponse.json({
      proposal: result.tree,
      rationale: result.rationale,
      tokenUsage: usage,
      invocation_id: inv.insertId,
    });
  } catch (error) {
    console.error("Error en adapt-orientation:", error);
    return NextResponse.json(
      { error: `Error interno: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
