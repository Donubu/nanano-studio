// Endpoint: genera la piel gráfica de un botón o sello (LayerSkin, ver
// lib/production/skin.ts). Nano Banana dibuja la forma vacía, sin texto,
// sobre un color clave plano; skin-image.ts quita el fondo y recorta; se sube
// a GCS como PNG con transparencia. El texto de la capa sigue vivo encima.
//
// URL: POST /api/production/ai/generate-skin
//   Body: {
//     production_project_id: number,
//     kind: "button" | "badge",
//     description: string,          // estilo pedido por el productor
//     colors?: string[],            // hex de la marca / de la capa
//     box: { w: number, h: number } // caja actual de la capa (proporción)
//   }
//
// Devuelve { skin: LayerSkin, average_color, usage, invocation_id }. No
// escribe la pieza: el editor aplica la piel como un cambio deshacible.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { uploadToS3 } from "@/lib/s3";
import { checkProductionAiQuota, quotaBlockedBody } from "@/lib/production/ai-rate-limit";
import { IMAGE_MODEL, generateImage, imageCostPerImage } from "@/lib/production/image-generator";
import { pickKeyColor, processSkinImage } from "@/lib/production/skin-image";
import { defaultSkinGeometry } from "@/lib/production/skin";
import type { LayerSkin } from "@/lib/production/types";

export const maxDuration = 120;

// Proporciones que acepta el generador.
const ASPECTS: [string, number][] = [
  ["1:1", 1],
  ["5:4", 5 / 4],
  ["4:3", 4 / 3],
  ["3:2", 3 / 2],
  ["16:9", 16 / 9],
  ["21:9", 21 / 9],
  ["4:5", 4 / 5],
  ["3:4", 3 / 4],
  ["2:3", 2 / 3],
  ["9:16", 9 / 16],
];

function nearestAspect(w: number, h: number): string {
  const r = Math.log(w / h);
  return ASPECTS.reduce((best, a) => (Math.abs(Math.log(a[1]) - r) < Math.abs(Math.log(best[1]) - r) ? a : best))[0];
}

function skinPrompt(kind: "button" | "badge", description: string, colors: string[], key: { name: string; hex: string }) {
  const what =
    kind === "button"
      ? "a single call-to-action BUTTON shape for a display advertising banner (a wide pill or rounded rectangle)"
      : "a single promotional BADGE / sticker shape for a display advertising banner (for example a starburst, seal, ribbon or round sticker)";
  const stretch =
    kind === "button"
      ? " The button's left and right ends must match in style and its middle section must be uniform horizontally, so it can be stretched wider without distortion. Front view, no perspective."
      : " Front view, symmetrical, no perspective.";
  return [
    `Design ${what}. Style: ${description}.`,
    colors.length > 0 ? `Use these colors: ${colors.join(", ")}.` : "",
    `The shape must be completely EMPTY: absolutely no text, letters, numbers, prices, symbols, icons or logos on it — real text is added on top later.${stretch}`,
    "Centered, filling about 90% of the canvas.",
    `Place it on a perfectly flat, uniform, solid ${key.name} (${key.hex}) background: no gradient, texture, shadow, glow or reflection on the background, and no ${key.name} anywhere on the shape itself.`,
  ]
    .filter(Boolean)
    .join("\n");
}

const HEX_RE = /^#[0-9a-f]{3,8}$/i;

const bodySchema = z.object({
  production_project_id: z.number().int().positive(),
  kind: z.enum(["button", "badge"]),
  description: z.string().trim().min(3).max(600),
  colors: z.array(z.string().regex(HEX_RE)).max(4).optional(),
  box: z.object({ w: z.number().positive().max(10000), h: z.number().positive().max(10000) }),
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
    const { production_project_id, kind, description, box } = parsed.data;
    const colors = parsed.data.colors ?? [];

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

    const key = pickKeyColor(colors);
    const prompt = skinPrompt(kind, description, colors, key);
    // Un sello se genera casi cuadrado aunque la caja sea una pastilla: toma
    // la proporción de la imagen al aplicarse (applySkin).
    const ratio = kind === "badge" ? nearestAspect(Math.min(box.w, box.h * 1.4), box.h) : nearestAspect(box.w, box.h);
    const startedAt = Date.now();
    const costPerImage = await imageCostPerImage();

    let skin: LayerSkin | null = null;
    let averageColor: string | null = null;
    let errorMsg: string | null = null;
    try {
      const img = await generateImage(prompt, ratio, "productionSkin");
      const processed = await processSkinImage(img.data);
      const fileName = `skin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
      const up = await uploadToS3(processed.png, fileName, "image/png", `templates/${clientId}/ai`);
      skin = {
        src: up.url,
        imageW: processed.width,
        imageH: processed.height,
        ...defaultSkinGeometry(kind, processed.width, processed.height),
        prompt: description,
      };
      averageColor = processed.averageColor;
    } catch (e) {
      errorMsg = (e as Error).message;
    }

    // Se cobra la imagen aunque falle el recorte: el generador ya la entregó.
    const estimatedCost = skin || errorMsg?.startsWith("No se pudo separar") ? costPerImage : 0;
    const [inv] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_ai_invocations
         (production_project_id, template_id, target_template_id, operation,
          agent_name, model, input_tokens, output_tokens, estimated_cost, duration_ms,
          success, error_msg, conversation_id, rationale, created_by)
       VALUES (?, NULL, NULL, 'GENERATE_SKIN', 'skin-generator', ?, NULL, NULL, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        production_project_id,
        IMAGE_MODEL,
        estimatedCost,
        Date.now() - startedAt,
        skin ? 1 : 0,
        errorMsg?.slice(0, 4000) ?? null,
        `${kind} ${ratio}: ${description}`.slice(0, 8000),
        userId,
      ],
    );

    if (!skin) {
      return NextResponse.json({ error: errorMsg ?? "No se generó la piel", invocation_id: inv.insertId }, { status: 502 });
    }
    return NextResponse.json({
      skin,
      average_color: averageColor,
      usage: { images: 1, estimatedCost },
      invocation_id: inv.insertId,
    });
  } catch (error) {
    console.error("Error en generate-skin:", error);
    return NextResponse.json({ error: `Error interno: ${(error as Error).message}` }, { status: 500 });
  }
}
