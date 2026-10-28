// Endpoint: genera una TemplateDefinition desde una descripción textual
// usando el agente Banner Designer (operación GENERATE_FROM_PROMPT, BANNERS.md
// §2.2). Sin imágenes: el agente compone master + variantes desde cero con la
// intención, el tono opcional y el brand kit del cliente.
//
// URL: POST /api/production/ai/generate-from-prompt
//   Body: {
//     production_project_id: number,
//     intent: string,                 // qué comunica el banner (obligatorio)
//     tone?: string,                  // "energetic" | "premium" | ... (libre)
//     instructions?: string,
//     master_dims?: { w, h },         // default 1920x1080
//     secondary_aspects?: [{ w, h }], // default [1080x1080, 1080x1920]
//   }
//
// Devuelve { proposal: { definition, variants[] }, rationale, tokenUsage,
// invocation_id }. NO crea el template — el cliente arma el POST final con
// la proposal cuando el productor confirma. Mismo contrato que
// /generate-from-reference.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { EMPTY_KIT_CONTENT } from "@/lib/production/brand-kit";
import { resolveProjectBrandKit } from "@/lib/production/project-brand-kit";
import { checkProductionAiQuota, quotaBlockedBody } from "@/lib/production/ai-rate-limit";
import {
  runGenerateFromPrompt,
  brandKitForAgent,
  BANNER_DESIGNER_AGENT_NAME,
} from "@/lib/production/banner-designer";

interface ProjectRow extends RowDataPacket {
  client_id: number;
}

const dimsSchema = z.object({
  w: z.number().int().positive().max(10000),
  h: z.number().int().positive().max(10000),
});

const bodySchema = z.object({
  production_project_id: z.number().int().positive(),
  intent: z.string().trim().min(3, "Describe qué debe comunicar el banner").max(2000),
  tone: z.string().trim().max(100).optional(),
  instructions: z.string().trim().max(2000).optional(),
  master_dims: dimsSchema.optional(),
  secondary_aspects: z.array(dimsSchema).max(5).optional(),
});

// Dims default: igual que CANONICAL_SIZES en lib/production/layout-templates.ts
const DEFAULT_MASTER = { w: 1920, h: 1080 };
const DEFAULT_VARIANTS = [
  { w: 1080, h: 1080 },
  { w: 1080, h: 1920 },
];

export async function POST(request: NextRequest) {
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

    const parsed = await parseBody(request, bodySchema);
    if (parsed.error) return parsed.error;
    const {
      production_project_id,
      intent,
      tone,
      instructions,
      master_dims,
      secondary_aspects,
    } = parsed.data;

    const [projRows] = await pool.execute<ProjectRow[]>(
      "SELECT client_id FROM production_projects WHERE id = ? AND deleted_at IS NULL",
      [production_project_id],
    );
    if (projRows.length === 0) {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }

    const quota = await checkProductionAiQuota({
      projectId: production_project_id,
      userId: Number(session.user.id),
    });
    if (!quota.ok) {
      return NextResponse.json(quotaBlockedBody(quota), { status: 429 });
    }

    const resolvedKit = await resolveProjectBrandKit(
      projRows[0].client_id,
      production_project_id,
    );
    const mergedKit = resolvedKit?.content ?? EMPTY_KIT_CONTENT;

    const masterDims = master_dims ?? DEFAULT_MASTER;
    const secondaryAspects = secondary_aspects ?? DEFAULT_VARIANTS;
    // Latencia de pared (incluye el retry de validación) para production_ai_invocations.duration_ms.
    const startedAt = Date.now();
    const result = await runGenerateFromPrompt({
      masterDims,
      secondaryAspects,
      brandKit: brandKitForAgent(mergedKit),
      intent,
      tone: tone || undefined,
      instructions: instructions || undefined,
      userEmail: session.user.email,
    });

    // Registro de invocación para auditoría / cost tracking.
    const [inv] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_ai_invocations
         (production_project_id, template_id, target_template_id, operation,
          agent_name, input_tokens, output_tokens, estimated_cost, duration_ms,
          success, error_msg, conversation_id, rationale, created_by)
       VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        production_project_id,
        "GENERATE_FROM_PROMPT",
        BANNER_DESIGNER_AGENT_NAME,
        result.tokenUsage?.inputTokens ?? null,
        result.tokenUsage?.outputTokens ?? null,
        result.tokenUsage?.estimatedCost ?? null,
        Date.now() - startedAt,
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
      proposal: {
        definition: result.definition,
        variants: result.variants,
      },
      rationale: result.rationale,
      tokenUsage: result.tokenUsage,
      conversationId: result.conversationId,
      invocation_id: inv.insertId,
      // Kit con el que el agente resolvió los tokens. El cliente lo manda en
      // el POST del template para que el editor muestre exactamente eso.
      brand_kit_id: resolvedKit?.id ?? null,
    });
  } catch (error) {
    console.error("Error en generate-from-prompt:", error);
    return NextResponse.json(
      { error: `Error interno: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
