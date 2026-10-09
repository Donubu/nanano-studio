import type { ChatMessage, AttachedFile } from "./google-ai";
import { isOwnStorageUrl } from "./s3";

/**
 * Archivos adjuntos por referencia (`sourceUrl` sin `dataUrl`).
 *
 * El canvas manda las imágenes de referencia que ya viven en GCS solo por
 * URL: así el request al server pesa KB en vez de decenas de MB de base64
 * (que el Traefik de Coolify cortaba a los 60s con un 502) y el job en Redis
 * tampoco arrastra el base64. El server descarga el archivo justo antes de
 * llamar al modelo.
 */

const MAX_REFERENCE_BYTES = 30 * 1024 * 1024;

export function needsDownload(file: Pick<AttachedFile, "dataUrl" | "sourceUrl">): boolean {
  return !!file.sourceUrl && !(file.dataUrl && file.dataUrl.startsWith("data:"));
}

/** Rechaza sourceUrl fuera de nuestro bucket. Devuelve el mensaje de error o null. */
export function validateSourceUrls(files: Array<Pick<AttachedFile, "dataUrl" | "sourceUrl" | "name">> | undefined): string | null {
  if (!files) return null;
  for (const f of files) {
    if (needsDownload(f) && !isOwnStorageUrl(f.sourceUrl!)) {
      return `Referencia externa no permitida: ${f.sourceUrl!.slice(0, 120)}`;
    }
  }
  return null;
}

export async function downloadAttachedFile(file: AttachedFile): Promise<AttachedFile> {
  const url = file.sourceUrl!;
  if (!isOwnStorageUrl(url)) {
    throw new Error(`Referencia externa no permitida: ${url.slice(0, 120)}`);
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo descargar la referencia ${file.name || ""} (${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_REFERENCE_BYTES) {
    throw new Error(`Referencia ${file.name || ""} demasiado grande (${Math.round(buf.length / 1048576)} MB)`);
  }
  // El content-type de GCS refleja lo que se declaró al subir (a veces mal,
  // ej. JPEG guardado como image/png); los magic bytes mandan.
  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
  const mimeType = sniffImageMime(buf) || (contentType && contentType !== "application/octet-stream" ? contentType : file.mimeType);
  return { ...file, mimeType, dataUrl: `data:${mimeType};base64,${buf.toString("base64")}` };
}

function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  return null;
}

/** Completa in-place el dataUrl de todos los adjuntos por referencia. */
export async function resolveAttachedFiles(messages: ChatMessage[]): Promise<void> {
  for (const msg of messages) {
    if (!msg.files?.length) continue;
    if (!msg.files.some(needsDownload)) continue;
    msg.files = await Promise.all(
      msg.files.map((f) => (needsDownload(f) ? downloadAttachedFile(f) : f))
    );
  }
}
