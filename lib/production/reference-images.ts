// Descarga de imágenes de referencia para mandarlas a Gemini como imagen
// nativa. Server-only.
//
// Solo descargamos de nuestro propio bucket (las sube /api/production/upload):
// evita que el server haga fetch a URLs arbitrarias que vengan en el body.

const GCS_PREFIX =
  (process.env.GCS_BASE_URL || `https://storage.googleapis.com/${process.env.GCS_BUCKET ?? ""}`).replace(/\/+$/, "") +
  "/";
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;

export async function downloadReference(url: string): Promise<{ mimeType: string; data: string }> {
  if (!url.startsWith(GCS_PREFIX)) {
    throw new Error("La referencia no viene del almacenamiento de la plataforma");
  }
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo descargar la referencia (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_REFERENCE_BYTES) throw new Error("Referencia demasiado pesada (máx. 8 MB)");
  const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
  return { mimeType, data: buf.toString("base64") };
}
