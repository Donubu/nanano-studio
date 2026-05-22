// Endpoint: genera una AnimationConfig para un template usando el agente
// Banner Designer en operación ANIMATE_TEMPLATE.
//
// URL: /api/production/templates/[id]/ai/animate
//   - [id] = id del template a animar (master o variante linked).
//   - Body: { intent: string, complexity?, durationHintMs?, instructions? }
//
// Flujo:
//   1. Resuelve template + verifica permisos admin.
//   2. Carga el brand kit del proyecto (cascada client + project).
//   3. Llama runAnimateTemplate con el template + brand kit + intent.
//   4. Registra la invocación en production_ai_invocations.
//   5. Devuelve { animation, rationale, tokenUsage, conversationId, invocation_id }.
//
// IMPORTANTE: NO escribe la animation al template. El cliente muestra
// preview/aplica directamente y persiste con el PUT estándar al template.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { TemplateDefinition } from "@/lib/production/types";
import {
  BrandKit,
  BrandKitContent,
  EMPTY_KIT_CONTENT,
  brandKitFromApi,
  mergeKits,
} from "@/lib/production/brand-kit";
import {
  runAnimateTemplate,
  brandKitForAgent,
  BANNER_DESIGNER_AGENT_NAME,
} from "@/lib/production/banner-designer";

interface TemplateRow extends RowDataPacket {
  id: number;
  production_project_id: number;
  design_id: number | null;
  base_width: number;
  base_height: number;
  definition_json: string;
}

interface ProjectRow extends RowDataPacket {
  client_id: number;
}

interface BrandKitRow extends RowDataPacket {
  id: number;
  client_id: number;
  production_project_id: number | null;
  name: string;
  colors_json: unknown;
  typography_json: unknown;
  logos_json: unknown;
  spacing_json: unknown;
  rules_text: string | null;
  is_default: number;
}

const bodySchema = z.object({
  intent: z.string().min(1).max(1000),
  complexity: z.enum(["subtle", "balanced", "energetic"]).optional(),
  durationHintMs: z.number().int().min(300).max(60000).optional(),
  instructions: z.string().max(2000).optional(),
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
    if (!session.user.email) {
      return NextResponse.json(
        { error: "Sesión sin email — no se puede invocar practicante" },
        { status: 400 },
      );
    }
    const { id: rawId } = await params;
    const templateId = Number(rawId);
    if (!Number.isFinite(templateId)) {
      return NextResponse.json({ error: "Template inválido" }, { status: 400 });
    }

    const parsed = await parseBody(request, bodySchema);
    if (parsed.error) return parsed.error;
    const { intent, complexity, durationHintMs, instructions } = parsed.data;

    // 1. Template
    const [tplRows] = await pool.execute<TemplateRow[]>(
      `SELECT id, production_project_id, design_id, base_width, base_height, definition_json
         FROM production_templates
        WHERE id = ? AND deleted_at IS NULL`,
      [templateId],
    );
    if (tplRows.length === 0) {
      return NextResponse.json(
        { error: "Template no encontrado" },
        { status: 404 },
      );
    }
    const tpl = tplRows[0];
    let definition: TemplateDefinition;
    try {
      definition = JSON.parse(tpl.definition_json) as TemplateDefinition;
    } catch {
      return NextResponse.json(
        { error: "Template tiene definition_json corrupto" },
        { status: 500 },
      );
    }

    // 2. Brand kit cascada — mismo patrón que adapt-orientation.
    const [projRows] = await pool.execute<ProjectRow[]>(
      "SELECT client_id FROM production_projects WHERE id = ?",
      [tpl.production_project_id],
    );
    let mergedKit: BrandKitContent = EMPTY_KIT_CONTENT;
    if (projRows.length > 0) {
      const clientId = projRows[0].client_id;
      const [kitRows] = await pool.execute<BrandKitRow[]>(
        `SELECT id, client_id, production_project_id, name,
                colors_json, typography_json, logos_json, spacing_json,
                rules_text, is_default
           FROM production_brand_kits
          WHERE client_id = ?
            AND (production_project_id IS NULL OR production_project_id = ?)`,
        [clientId, tpl.production_project_id],
      );
      const parsedKits: BrandKit[] = kitRows.map((r) => brandKitFromApi(r));
      const clientWide = parsedKits.filter((k) => k.production_project_id === null);
      const projectScoped = parsedKits.filter((k) => k.production_project_id != null);
      const baseClient = clientWide.find((k) => k.is_default) ?? clientWide[0];
      const baseProject = projectScoped.find((k) => k.is_default) ?? projectScoped[0];
      mergedKit = mergeKits(
        ...[baseClient, baseProject].filter((x): x is BrandKit => !!x),
      );
    }

    // 3. Llamar al agente
    const templateDims = { w: tpl.base_width, h: tpl.base_height };
    const result = await runAnimateTemplate({
      template: definition,
      templateDims,
      brandKit: brandKitForAgent(mergedKit),
      intent,
      complexity,
      durationHintMs,
      existingAnimation: definition.animation ?? null,
      instructions,
      userEmail: session.user.email,
    });

    // 4. Registrar invocación (pase lo que pase, para auditoría de cost).
    const [inv] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_ai_invocations
         (production_project_id, template_id, target_template_id, operation,
          agent_name, input_tokens, output_tokens, estimated_cost,
          success, error_msg, conversation_id, rationale, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tpl.production_project_id,
        tpl.id,
        tpl.id, // no hay distinción master/target acá; el target ES el template
        "ANIMATE_TEMPLATE",
        BANNER_DESIGNER_AGENT_NAME,
        result.tokenUsage?.inputTokens ?? null,
        result.tokenUsage?.outputTokens ?? null,
        result.tokenUsage?.estimatedCost ?? null,
        result.ok ? 1 : 0,
        result.ok ? null : result.error,
        result.conversationId ?? null,
        result.ok ? result.rationale : null,
        Number(session.user.id),
      ],
    );

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          invocation_id: inv.insertId,
          tokenUsage: result.tokenUsage,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      animation: result.animation,
      rationale: result.rationale,
      tokenUsage: result.tokenUsage,
      conversationId: result.conversationId,
      invocation_id: inv.insertId,
    });
  } catch (error) {
    console.error("Error en ai/animate:", error);
    return NextResponse.json(
      { error: `Error interno: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
