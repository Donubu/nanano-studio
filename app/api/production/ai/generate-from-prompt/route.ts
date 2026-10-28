// Endpoint: genera un banner desde una descripción textual. Gemini elige
// plantillas del catálogo (layout-templates.ts) y devuelve hasta 3 planes
// chicos que el motor expande a master + variantes (lib/production/
// layout-plan.ts). Sin practicante: una llamada de ~2k tokens de entrada.
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
// Devuelve { proposal: { definition, variants[] }, proposals[], rationale,
// tokenUsage, invocation_id, brand_kit_id } (ver lib/production/
// plan-generation.ts). NO crea el template — el cliente arma el POST final
// con la propuesta elegida cuando el productor confirma.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { EMPTY_KIT_CONTENT } from "@/lib/production/brand-kit";
import { resolveProjectBrandKit } from "@/lib/production/project-brand-kit";
import { checkProductionAiQuota, quotaBlockedBody } from "@/lib/production/ai-rate-limit";
import { generateFromPlans } from "@/lib/production/plan-generation";

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


export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
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

    const result = await generateFromPlans({
      operation: "GENERATE_FROM_PROMPT",
      productionProjectId: production_project_id,
      userId: Number(session.user.id),
      brandKit: mergedKit,
      brandKitId: resolvedKit?.id ?? null,
      intent,
      tone,
      instructions,
      masterDims: master_dims,
      variantDims: secondary_aspects,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Error en generate-from-prompt:", error);
    return NextResponse.json(
      { error: `Error interno: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
