// Piezas reales de la marca (BrandGuide.desempeno.piezas): al sincronizar la
// guía, nanano descarga la imagen de cada anuncio que mandó practicante y la
// re-sube a su bucket. Las URLs de las plataformas de medios (Meta, Google)
// expiran, y el resto de la IA de producción solo lee de nuestro bucket
// (reference-images.ts). Server-only.
//
// La URL viene de la respuesta de un agente: se trata como no confiable.
// Solo https, nada que resuelva a una IP privada o local (también en cada
// redirect), tope de peso y de tiempo, y se valida que sea una imagen.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";
import { uploadToS3 } from "@/lib/s3";
import { downloadReference } from "./reference-images";
import type { BrandGuide, PiezaReal } from "./brand-guide";

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const MAX_SIDE = 1080;

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

async function assertPublicHttps(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("solo https");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error("host no permitido");
  }
  return url;
}

export async function fetchPublicImage(raw: string): Promise<Buffer> {
  if (raw.startsWith("data:image/")) {
    const b64 = raw.slice(raw.indexOf(",") + 1);
    const buf = Buffer.from(b64, "base64");
    if (buf.length > MAX_BYTES) throw new Error("imagen demasiado pesada");
    return buf;
  }
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicHttps(current);
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new Error(`redirect sin destino (${res.status})`);
      current = new URL(next, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("imagen demasiado pesada");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error("imagen demasiado pesada");
    return buf;
  }
  throw new Error("demasiados redirects");
}

// Descarga, normaliza a JPEG (máx. 1080 px) y sube cada imagen. Una pieza
// cuya imagen no se pudo traer queda con imagen "" (sus métricas siguen
// sirviendo como texto).
export async function importPieceImages(
  guide: BrandGuide,
  clientId: number,
): Promise<{ guide: BrandGuide; imported: number; failed: string[] }> {
  const piezas = guide.desempeno?.piezas ?? [];
  if (piezas.length === 0) return { guide, imported: 0, failed: [] };
  const failed: string[] = [];
  const next: PiezaReal[] = await Promise.all(
    piezas.map(async (p, i) => {
      if (!p.imagen_origen) return p;
      try {
        const buf = await fetchPublicImage(p.imagen_origen);
        const jpeg = await sharp(buf)
          .rotate()
          .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();
        const name = `pieza_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}.jpg`;
        const up = await uploadToS3(jpeg, name, "image/jpeg", `brand-guides/${clientId}`);
        return { ...p, imagen: up.url };
      } catch (e) {
        failed.push(`${p.texto.slice(0, 40) || `pieza ${i + 1}`}: ${(e as Error).message}`);
        return { ...p, imagen: "" };
      }
    }),
  );
  return {
    guide: { ...guide, desempeno: { ...guide.desempeno!, piezas: next } },
    imported: next.filter((p) => p.imagen).length,
    failed,
  };
}

// Las mejores piezas con imagen, ya descargadas, para mandarlas al
// planificador como referencia visual.
export async function topPieceImages(
  guide: BrandGuide | null,
  max = 3,
): Promise<{ mimeType: string; data: string; caption: string }[]> {
  const top = (guide?.desempeno?.piezas ?? []).filter((p) => p.rendimiento === "alto" && p.imagen).slice(0, max);
  const out = await Promise.all(
    top.map(async (p) => {
      try {
        const img = await downloadReference(p.imagen);
        const caption = [p.texto && `"${p.texto}"`, p.formato, p.canal, p.resultado].filter(Boolean).join(" · ");
        return { ...img, caption };
      } catch {
        return null;
      }
    }),
  );
  return out.filter((x): x is NonNullable<typeof x> => x !== null);
}
