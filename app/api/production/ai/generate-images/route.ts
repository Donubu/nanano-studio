// Endpoint: genera las imágenes de los slots de una propuesta IA con el
// generador de imágenes de la plataforma (Nano Banana 2 por la API de
// Gemini por defecto) y las sube a GCS. Imagen 4 por Vertex no sirve acá:
// GOOGLE_CLOUD_LOCATION=global (local y prod) y Imagen no existe en global.
// Los prompts los escribió el planificador (layout-planner.ts); el cliente
// arma los jobs con imageJobsFor (una imagen por slot y proporción).
//
// URL: POST /api/production/ai/generate-images
//   Body: {
//     production_project_id: number,
//     jobs: [{ slot_id, ratio: "16:9" | "9:16" | "1:1" | "4:3" | "3:4", prompt }]  // 1..6
//   }
//
// Devuelve { images: [{ slot_id, ratio, url } | { slot_id, ratio, error }],
// usage: { images, estimatedCost }, invocation_id }. Corren en paralelo.
// El lote es UNA invocación GENERATE_IMAGES en production_ai_invocations
// (costo = imágenes OK × precio del modelo, tabla `models`).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { IMAGE_MODEL, generateImage, imageCostPerImage } from "@/lib/production/image-generator";
import sharp from "sharp";
import { uploadToS3 } from "@/lib/s3";
import { checkProductionAiQuota, quotaBlockedBody } from "@/lib/production/ai-rate-limit";
import { IMAGE_RATIOS } from "@/lib/production/layout-plan";

export const maxDuration = 180;

const PHOTO_SUFFIX = "\n\nPhotographic advertising image. No text, letters, logos or watermarks anywhere in the image.";

const bodySchema = z.object({
  production_project_id: z.number().int().positive(),
  jobs: z
    .array(
      z.object({
        slot_id: z.string().min(1).max(100),
        ratio: z.enum(IMAGE_RATIOS),
        prompt: z.string().trim().min(3).max(2000),
        // "texture": relleno de letras (text-effects.ts); se guarda como JPEG
        // de 512 px, que alcanza para texto y no infla el banner HTML5.
        purpose: z.enum(["photo", "texture"]).optional(),
      }),
    )
    .min(1)
    .max(6),
});

interface ProjectRow extends RowDataPacket {
  client_id: number;
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
    const { production_project_id, jobs } = parsed.data;

    const [projRows] = await pool.execute<ProjectRow[]>(
      "SELECT client_id FROM production_projects WHERE id = ? AND deleted_at IS NULL",
      [production_project_id],
    );
    if (projRows.length === 0) {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }
    const clientId = projRows[0].client_id;

    const quota = await checkProductionAiQuota({ projectId: production_project_id, userId });
    if (!quota.ok) {
      return NextResponse.json(quotaBlockedBody(quota), { status: 429 });
    }

    const costPerImage = await imageCostPerImage();

    const startedAt = Date.now();
    const images = await Promise.all(
      jobs.map(async (job) => {
        try {
          let img = await generateImage(`${job.prompt}${PHOTO_SUFFIX}`, job.ratio);
          if (job.purpose === "texture") {
            const data = await sharp(img.data).resize(512, 512, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();
            img = { data, mimeType: "image/jpeg" };
          }
          const ext = img.mimeType.includes("jpeg") ? "jpg" : "png";
          const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const up = await uploadToS3(img.data, fileName, img.mimeType, `templates/${clientId}/ai`);
          return { slot_id: job.slot_id, ratio: job.ratio, url: up.url };
        } catch (e) {
          return { slot_id: job.slot_id, ratio: job.ratio, error: (e as Error).message };
        }
      }),
    );

    const ok = images.filter((i) => "url" in i).length;
    const failed = images.filter((i) => "error" in i) as { slot_id: string; ratio: string; error: string }[];
    const estimatedCost = ok * costPerImage;
    const [inv] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_ai_invocations
         (production_project_id, template_id, target_template_id, operation,
          agent_name, model, input_tokens, output_tokens, estimated_cost, duration_ms,
          success, error_msg, conversation_id, rationale, created_by)
       VALUES (?, NULL, NULL, 'GENERATE_IMAGES', 'image-generator', ?, NULL, NULL, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        production_project_id,
        IMAGE_MODEL,
        estimatedCost,
        Date.now() - startedAt,
        ok > 0 ? 1 : 0,
        failed.length > 0
          ? failed.map((f) => `${f.slot_id} ${f.ratio}: ${f.error}`).join("\n").slice(0, 4000)
          : null,
        jobs.map((j) => `${j.slot_id} ${j.ratio}: ${j.prompt}`).join("\n").slice(0, 8000),
        userId,
      ],
    );

    if (ok === 0) {
      return NextResponse.json(
        { error: failed[0]?.error ?? "No se generó ninguna imagen", images, invocation_id: inv.insertId },
        { status: 502 },
      );
    }
    return NextResponse.json({
      images,
      usage: { images: ok, estimatedCost },
      invocation_id: inv.insertId,
    });
  } catch (error) {
    console.error("Error en generate-images:", error);
    return NextResponse.json(
      { error: `Error interno: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
