// Generador de imágenes de la IA de producción: Nano Banana 2 por la API de
// Gemini. Imagen 4 por Vertex no sirve: GOOGLE_CLOUD_LOCATION=global (local y
// prod) y Imagen no existe en global. Lo usan generate-images (fotos de las
// propuestas) y generate-skin (pieles de botones y sellos). Server-only.

import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getClient, withRetry } from "@/lib/google-ai";

export const IMAGE_MODEL = process.env.PRODUCTION_AI_IMAGE_MODEL || "gemini-3.1-flash-image-preview";
// Fallback si el modelo no está en la tabla `models`.
const FALLBACK_COST_PER_IMAGE = 0.067;

export async function generateImage(
  prompt: string,
  ratio: string,
  operationName = "productionImage",
): Promise<{ data: Buffer; mimeType: string }> {
  const response = await withRetry(
    () =>
      getClient("gemini").models.generateContent({
        model: IMAGE_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: ratio, imageSize: "1K" },
        },
      }),
    operationName,
  );
  const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) {
    const reason =
      response.promptFeedback?.blockReason ?? response.candidates?.[0]?.finishReason ?? "sin imagen";
    throw new Error(`El generador no devolvió imagen (${reason})`);
  }
  return {
    data: Buffer.from(part.inlineData.data, "base64"),
    mimeType: part.inlineData.mimeType || "image/png",
  };
}

interface ModelRow extends RowDataPacket {
  cost_image_1k: string | null;
}

export async function imageCostPerImage(): Promise<number> {
  const [rows] = await pool.execute<ModelRow[]>(
    "SELECT cost_image_1k FROM models WHERE model_id = ? LIMIT 1",
    [IMAGE_MODEL],
  );
  return Number(rows[0]?.cost_image_1k ?? FALLBACK_COST_PER_IMAGE);
}

// Quita de una foto los textos, logos y gráficos superpuestos (cintillos,
// cajas de precio, sellos) y reconstruye el fondo. Lo usa la copia íntegra
// desde referencia: el recorte de la foto trae impresos los textos originales,
// que ahora van como capas editables encima.
export async function cleanPhotoOverlays(
  input: { data: Buffer; mimeType: string },
  ratio: string,
): Promise<{ data: Buffer; mimeType: string }> {
  const response = await withRetry(
    () =>
      getClient("gemini").models.generateContent({
        model: IMAGE_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: input.mimeType, data: input.data.toString("base64") } },
              {
                text: "Remove ALL text, letters, numbers, logos, watermarks and graphic overlays (colored bands, ribbons, price boxes, badges, buttons, frames) from this photo, reconstructing what is behind them naturally. Keep the photo itself identical: same framing, subject, colors, light and perspective. Return only the cleaned photo.",
              },
            ],
          },
        ],
        config: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: ratio, imageSize: "1K" },
        },
      }),
    "productionCleanPhoto",
  );
  const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error("El generador no devolvió la foto limpia");
  return { data: Buffer.from(part.inlineData.data, "base64"), mimeType: part.inlineData.mimeType || "image/png" };
}
