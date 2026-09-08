// Endpoint: adapta el contenido de una orientación a partir del master del
// mismo design, usando el agente Banner Designer de practicante.
//
// URL: /api/production/templates/[id]/ai/adapt-orientation
//   - [id] = id del template que SE VA A ADAPTAR (target orientation; suele
//     ser una variante linked dentro del design).
//   - Body: { instructions?: string }
//
// Flujo:
//   1. Resuelve target template (cumpliendo id de la URL).
//   2. Resuelve master = principal del design del target. Si el target ES el
//     principal, error (no tiene sentido adaptar el master a sí mismo desde acá).
//   3. Carga el brand kit del proyecto + cliente (cascada mismo patrón que el editor).
//   4. Llama runAdaptOrientation con master + target dims + brand kit + instructions.
//   5. Registra la invocación en production_ai_invocations (success + tokens + costo).
//   6. Devuelve { proposal: TemplateDefinition, rationale, tokenUsage, conversationId, invocation_id }
//      o un error con el status apropiado.
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
import {
  runAdaptOrientation,
  brandKitForAgent,
  aspectFamilyFromDims,
  BANNER_DESIGNER_AGENT_NAME,
} from "@/lib/production/banner-designer";

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

// `files` permite mandar imágenes de referencia al agente. El cliente las
// genera capturando el master renderizado a tamaño nativo y subiéndolas a
// /api/production/upload para tener una URL pública. Sonnet 4.6 las recibe
// como input multi-modal y las usa como referencia visual de la composición
// actual.
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
    if (!session.user.email) {
      return NextResponse.json(
        { error: "Sesión sin email — no se puede invocar practicante" },
        { status: 400 },
      );
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
    const master = principalRows[0];
    if (master.id === target.id) {
      return NextResponse.json(
        {
          error:
            "Estás adaptando el master a sí mismo. Usá ✨ desde una variante (cuadrado, vertical, etc.).",
        },
        { status: 400 },
      );
    }

    let masterDefinition: TemplateDefinition;
    try {
      masterDefinition = JSON.parse(master.definition_json) as TemplateDefinition;
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
            brandKitId: target.brand_kit_id ?? master.brand_kit_id,
            clientId: projRows[0].client_id,
            productionProjectId: target.production_project_id,
          })
        : null;
    const mergedKit = resolvedKit?.content ?? EMPTY_KIT_CONTENT;

    // 4. Llamar al agente
    const targetDims = { w: target.base_width, h: target.base_height };
    const masterDims = { w: master.base_width, h: master.base_height };
    const result = await runAdaptOrientation({
      master: masterDefinition,
      masterDims,
      targetDims,
      targetAspectFamily: aspectFamilyFromDims(targetDims.w, targetDims.h),
      brandKit: brandKitForAgent(mergedKit),
      instructions,
      userEmail: session.user.email,
      referenceFiles: files,
    });

    // 5. Registrar invocación. Lo hacemos pase lo que pase, incluso si falla,
    // para tener auditoría de costos y errores.
    const [inv] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_ai_invocations
         (production_project_id, template_id, target_template_id, operation,
          agent_name, input_tokens, output_tokens, estimated_cost,
          success, error_msg, conversation_id, rationale, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        target.production_project_id,
        master.id,
        target.id,
        "ADAPT_ORIENTATION",
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
      proposal: result.definition,
      rationale: result.rationale,
      tokenUsage: result.tokenUsage,
      conversationId: result.conversationId,
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
