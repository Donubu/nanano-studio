// Reescala con Topaz una foto del design y la reemplaza en todas las
// piezas que la usan (masters/orientaciones y ajustes manuales de las
// adaptaciones). Lo pide el preflight del paso Descargar cuando una foto
// se dibuja más grande que su resolución natural.
//
// URL: POST /api/production/designs/[id]/upscale-image
//   Body: { url: string, factor?: 2 | 3 | 4 }
// Devuelve { url, width, height, credits, estimated_cost, replaced:
// { templates, adaptations } }. Es una invocación UPSCALE_IMAGE en
// production_ai_invocations (cuota de IA del proyecto incluida).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { uploadToS3 } from "@/lib/s3";
import { imageSize } from "@/lib/production/image-size";
import { fetchPublicImage } from "@/lib/production/brand-pieces";
import { upscaleWithTopaz, topazConfigured, TOPAZ_IMAGE_MODEL } from "@/lib/topaz-image";
import { checkProductionAiQuota, quotaBlockedBody } from "@/lib/production/ai-rate-limit";
import { isUpscalableSrc, MAX_UPSCALE_FACTOR } from "@/lib/production/image-resolution";

export const maxDuration = 180;

const bodySchema = z.object({
  url: z.string().url().max(2000),
  factor: z.number().int().min(2).max(MAX_UPSCALE_FACTOR).optional(),
});

interface DesignRow extends RowDataPacket {
  id: number;
  production_project_id: number;
  client_id: number;
}
interface TemplateRow extends RowDataPacket {
  id: number;
  definition_json: string;
}
interface AdaptationRow extends RowDataPacket {
  id: number;
  overrides_json: string | null;
}

function upscaledName(url: string, factor: number): string {
  const base = url.split("/").pop() || "image.png";
  const dot = base.lastIndexOf(".");
  const stem = (dot === -1 ? base : base.slice(0, dot)).replace(/--\dx$/, "");
  return `${stem}--${factor}x.png`;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = Number(session.user.id);
    const designId = Number((await params).id);
    if (!Number.isFinite(designId)) return NextResponse.json({ error: "Design inválido" }, { status: 400 });
    if (!topazConfigured()) return NextResponse.json({ error: "Topaz API no configurada" }, { status: 500 });

    const parsed = await parseBody(request, bodySchema);
    if (parsed.error) return parsed.error;
    const { url } = parsed.data;
    if (!isUpscalableSrc(url)) return NextResponse.json({ error: "Esa imagen no se puede reescalar" }, { status: 400 });

    const [designRows] = await pool.execute<DesignRow[]>(
      `SELECT d.id, d.production_project_id, p.client_id
         FROM production_designs d JOIN production_projects p ON p.id = d.production_project_id
        WHERE d.id = ? AND d.deleted_at IS NULL`,
      [designId],
    );
    const design = designRows[0];
    if (!design) return NextResponse.json({ error: "Design no encontrado" }, { status: 404 });

    // Solo fotos que el design usa de verdad: evita reescalar URLs ajenas.
    const [tplRows] = await pool.execute<TemplateRow[]>(
      "SELECT id, definition_json FROM production_templates WHERE design_id = ? AND deleted_at IS NULL",
      [designId],
    );
    const [adaptRows] = await pool.execute<AdaptationRow[]>(
      "SELECT id, overrides_json FROM production_template_adaptations WHERE design_id = ?",
      [designId],
    );
    const uses = (s: string | null) => !!s && s.includes(url);
    if (!tplRows.some((t) => uses(t.definition_json)) && !adaptRows.some((a) => uses(a.overrides_json))) {
      return NextResponse.json({ error: "Esa imagen no está en ninguna pieza del design" }, { status: 400 });
    }

    const quota = await checkProductionAiQuota({ projectId: design.production_project_id, userId });
    if (!quota.ok) return NextResponse.json(quotaBlockedBody(quota), { status: 429 });

    const startedAt = Date.now();
    const original = await fetchPublicImage(url);
    const have = imageSize(original);
    if (!have) return NextResponse.json({ error: "No se pudo leer el tamaño de la imagen" }, { status: 400 });
    const factor = parsed.data.factor ?? 2;
    const out = { width: have.w * factor, height: have.h * factor };

    let result: Awaited<ReturnType<typeof upscaleWithTopaz>>;
    try {
      result = await upscaleWithTopaz(original, out);
    } catch (e) {
      await pool.execute<ResultSetHeader>(
        `INSERT INTO production_ai_invocations
           (production_project_id, template_id, target_template_id, operation, agent_name, model,
            input_tokens, output_tokens, estimated_cost, duration_ms, success, error_msg, conversation_id, rationale, created_by)
         VALUES (?, NULL, NULL, 'UPSCALE_IMAGE', 'topaz', ?, NULL, NULL, NULL, ?, 0, ?, NULL, ?, ?)`,
        [design.production_project_id, TOPAZ_IMAGE_MODEL, Date.now() - startedAt, (e as Error).message.slice(0, 4000), url, userId],
      );
      return NextResponse.json({ error: `Topaz falló: ${(e as Error).message}` }, { status: 502 });
    }

    const up = await uploadToS3(result.data, upscaledName(url, factor), "image/png", `templates/${design.client_id}/ai`);

    // Reemplazo textual de la URL en los JSON: el mismo string en masters,
    // orientaciones y ajustes manuales. Cada template sube de versión.
    let templates = 0;
    for (const t of tplRows) {
      if (!uses(t.definition_json)) continue;
      await pool.execute<ResultSetHeader>(
        "UPDATE production_templates SET definition_json = ?, version = version + 1 WHERE id = ?",
        [t.definition_json.split(url).join(up.url), t.id],
      );
      templates++;
    }
    let adaptations = 0;
    for (const a of adaptRows) {
      if (!uses(a.overrides_json)) continue;
      await pool.execute<ResultSetHeader>("UPDATE production_template_adaptations SET overrides_json = ? WHERE id = ?", [
        a.overrides_json!.split(url).join(up.url),
        a.id,
      ]);
      adaptations++;
    }

    await pool.execute<ResultSetHeader>(
      `INSERT INTO production_ai_invocations
         (production_project_id, template_id, target_template_id, operation, agent_name, model,
          input_tokens, output_tokens, estimated_cost, duration_ms, success, error_msg, conversation_id, rationale, created_by)
       VALUES (?, NULL, NULL, 'UPSCALE_IMAGE', 'topaz', ?, NULL, NULL, ?, ?, 1, NULL, NULL, ?, ?)`,
      [
        design.production_project_id,
        TOPAZ_IMAGE_MODEL,
        result.estimatedCost,
        Date.now() - startedAt,
        `${url} → ${up.url} (${have.w}×${have.h} → ${out.width}×${out.height}, ${result.credits} créditos)`,
        userId,
      ],
    );

    return NextResponse.json({
      url: up.url,
      width: out.width,
      height: out.height,
      credits: result.credits,
      estimated_cost: result.estimatedCost,
      replaced: { templates, adaptations },
    });
  } catch (error) {
    console.error("Error en upscale-image:", error);
    return NextResponse.json({ error: `Error interno: ${(error as Error).message}` }, { status: 500 });
  }
}
