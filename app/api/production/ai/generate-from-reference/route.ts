// Endpoint: genera un banner desde 1-3 imágenes de referencia. El productor
// las sube vía /api/production/upload y pasa las URLs públicas; el server
// las descarga y se las pasa a Gemini como imagen nativa (sin la ida y
// vuelta de analyze_media). Gemini elige la plantilla del catálogo cuya
// composición más se parece y la completa con paleta, tono y copy de la
// referencia más el brand kit del cliente (lib/production/layout-plan.ts).
//
// URL: POST /api/production/ai/generate-from-reference
//   Body: {
//     production_project_id: number,
//     reference_files: [{ filename, publicUrl, mimeType }],  // 1-3
//     intent?: string,
//     instructions?: string,
//     master_dims?: { w, h },         // default 1920x1080
//     secondary_aspects?: [{ w, h }], // default [1080x1080, 1080x1920]
//   }
//
// Devuelve lo mismo que /generate-from-prompt (lib/production/
// plan-generation.ts). NO crea el template.

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
import { downloadReference } from "@/lib/production/reference-images";

interface ProjectRow extends RowDataPacket {
  client_id: number;
}

const bodySchema = z.object({
  production_project_id: z.number().int().positive(),
  reference_files: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        publicUrl: z.string().url().max(2000),
        mimeType: z.string().min(1).max(100),
      }),
    )
    .min(1)
    .max(3),
  intent: z.string().max(2000).optional(),
  instructions: z.string().max(2000).optional(),
  master_dims: z
    .object({
      w: z.number().int().positive().max(10000),
      h: z.number().int().positive().max(10000),
    })
    .optional(),
  secondary_aspects: z
    .array(
      z.object({
        w: z.number().int().positive().max(10000),
        h: z.number().int().positive().max(10000),
      }),
    )
    .max(5)
    .optional(),
});

// Dims default: igual que CANONICAL_SIZES en lib/production/layout-templates.ts

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
      reference_files,
      intent,
      instructions,
      master_dims,
      secondary_aspects,
    } = parsed.data;

    // Brand kit del cliente. Mismo patrón que adapt-orientation:
    // client-wide default + project-scoped default, merged. Si el productor
    // tiene un fork project-scoped en uso, se aplica encima. Esto va al
    // CONTEXTO del agente para que use los tokens correctos.
    const [projRows] = await pool.execute<ProjectRow[]>(
      "SELECT client_id FROM production_projects WHERE id = ?",
      [production_project_id],
    );
    if (projRows.length === 0) {
      return NextResponse.json(
        { error: "Proyecto no encontrado" },
        { status: 404 },
      );
    }
    const clientId = projRows[0].client_id;

    const quota = await checkProductionAiQuota({
      projectId: production_project_id,
      userId: Number(session.user.id),
    });
    if (!quota.ok) {
      return NextResponse.json(quotaBlockedBody(quota), { status: 429 });
    }

    const resolvedKit = await resolveProjectBrandKit(clientId, production_project_id);
    const mergedKit = resolvedKit?.content ?? EMPTY_KIT_CONTENT;

    // Llamada al agente.
    let images: { mimeType: string; data: string }[];
    try {
      images = await Promise.all(reference_files.map((f) => downloadReference(f.publicUrl)));
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }

    const result = await generateFromPlans({
      operation: "GENERATE_FROM_REFERENCE",
      productionProjectId: production_project_id,
      clientId,
      userId: Number(session.user.id),
      brandKit: mergedKit,
      brandKitId: resolvedKit?.id ?? null,
      intent,
      instructions,
      images,
      masterDims: master_dims,
      variantDims: secondary_aspects,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Error en generate-from-reference:", error);
    return NextResponse.json(
      { error: `Error interno: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}

