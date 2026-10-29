// Topaz Image API (enhance): reescala una imagen a un tamaño de salida.
// Lo usa el upscale 2x del chat (app/api/images/upscale) y el de producción
// (app/api/production/designs/[id]/upscale-image). Server-only.

import { calculateTopazCredits } from "./cost-calculator";

const TOPAZ_API_KEY = process.env.TOPAZ_API_KEY || "";
// Precio por crédito en USD (el pack de la cuenta); solo para estimar el
// costo registrado en production_ai_invocations.
export const TOPAZ_CREDIT_USD = Number(process.env.TOPAZ_CREDIT_USD || 0.05);
export const TOPAZ_IMAGE_MODEL = "Standard V2";

export function topazConfigured(): boolean {
  return TOPAZ_API_KEY.length > 0;
}

export async function upscaleWithTopaz(
  image: Buffer,
  out: { width: number; height: number },
): Promise<{ data: Buffer; credits: number; estimatedCost: number }> {
  if (!TOPAZ_API_KEY) throw new Error("Topaz API no configurada (TOPAZ_API_KEY)");
  const formData = new FormData();
  formData.append("image", new Blob([new Uint8Array(image)]), "image.png");
  formData.append("model", TOPAZ_IMAGE_MODEL);
  formData.append("output_width", String(Math.round(out.width)));
  formData.append("output_height", String(Math.round(out.height)));
  const res = await fetch("https://api.topazlabs.com/image/v1/enhance", {
    method: "POST",
    headers: { Accept: "application/json", "X-API-Key": TOPAZ_API_KEY },
    body: formData,
    signal: AbortSignal.timeout(170_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Topaz ${res.status}: ${text.slice(0, 300)}`);
  }
  const credits = calculateTopazCredits(out.width, out.height);
  return { data: Buffer.from(await res.arrayBuffer()), credits, estimatedCost: credits * TOPAZ_CREDIT_USD };
}
