// Activos de exportación: lo que hace que una pieza pese lo que debe.
//
// - assetBoxes: a qué tamaño se dibuja cada imagen en la pieza exportada
//   (foto, logo, piel, textura), para no embeber una foto de 1K en un 300×250.
// - prepareAsset (navegador): redimensiona al tamaño dibujado × dpr y
//   re-codifica (JPEG si no hay transparencia, PNG si la hay).
// - collectFontUsage + embedGoogleFonts (navegador): fuentes como subconjunto
//   WOFF2 embebido (solo los glifos usados), en vez de un <link> externo que
//   muchos ad servers no permiten y que no cuenta en el peso.
//
// Las funciones puras corren también en tests; las de navegador usan
// createImageBitmap/canvas/fetch.

import type { TemplateDefinition, TemplateLayer } from "./types";
import { findGoogleFont } from "./google-fonts";

export interface AssetBox {
  w: number;
  h: number;
}

// Tamaño máximo (en px de la pieza) con que se dibuja cada URL. `scale` es
// el factor del wrapper cuando el árbol se renderiza escalado (fit "scale").
export function assetBoxes(tree: TemplateDefinition, scale = 1): Map<string, AssetBox> {
  const out = new Map<string, AssetBox>();
  const add = (src: string | null | undefined, w: number, h: number) => {
    if (!src || src.startsWith("data:")) return;
    const cur = out.get(src);
    const box = { w: Math.ceil(w * scale), h: Math.ceil(h * scale) };
    if (!cur) out.set(src, box);
    else out.set(src, { w: Math.max(cur.w, box.w), h: Math.max(cur.h, box.h) });
  };
  const walk = (nodes: TemplateLayer[], k: number) => {
    for (const l of nodes) {
      if (l.visible === false) continue;
      const w = l.size.w * k;
      const h = l.size.h * k;
      if (l.type === "image") add(l.src, w, h);
      if (l.type === "text") {
        if (l.skin?.src) add(l.skin.src, w, h);
        if (l.style.fill?.type === "texture") add(l.style.fill.src, w, h);
      }
      if (l.type === "frame") walk(l.children, k);
    }
  };
  walk(tree.children, 1);
  return out;
}

// ---------------------------------------------------------------------------
// Fuentes
// ---------------------------------------------------------------------------

export interface FontUsage {
  // familia (nombre de Google Fonts) → pesos usados
  families: Map<string, Set<number>>;
  // caracteres que aparecen en la pieza (para el subconjunto)
  text: string;
}

const WEIGHT_NAMES: Record<string, number> = { normal: 400, bold: 700, lighter: 300, bolder: 700 };
// Siempre: dígitos, puntuación de precios y ambas cajas de las letras usadas
// (textTransform: uppercase dibuja glifos que no están en el contenido).
const BASE_CHARS = "0123456789.,:;-–—$%*()/+!?¡¿'\"&@ ";

export function collectFontUsage(tree: TemplateDefinition): FontUsage {
  const families = new Map<string, Set<number>>();
  const chars = new Set<string>(BASE_CHARS);
  const walk = (nodes: TemplateLayer[]) => {
    for (const l of nodes) {
      if (l.visible === false) continue;
      if (l.type === "frame") walk(l.children);
      if (l.type !== "text") continue;
      for (const ch of l.content) {
        chars.add(ch);
        chars.add(ch.toUpperCase());
        chars.add(ch.toLowerCase());
      }
      const font = l.style.fontFamily ? findGoogleFont(l.style.fontFamily) : null;
      if (!font) continue;
      const raw = l.style.fontWeight ?? 400;
      let weight = typeof raw === "number" ? raw : (WEIGHT_NAMES[String(raw).toLowerCase()] ?? Number(raw) ?? 400);
      if (!Number.isFinite(weight)) weight = 400;
      // Google solo tiene los pesos de la lista: el más cercano disponible.
      weight = font.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), font.weights[0]);
      if (!families.has(font.family)) families.set(font.family, new Set());
      families.get(font.family)!.add(weight);
    }
  };
  walk(tree.children);
  return { families, text: [...chars].filter((c) => c !== "\n" && c !== "\r" && c !== "\t").join("") };
}

// URL de la API css2 con subconjunto de texto. Google acepta varias
// familias; el `text` aplica a todas.
export function googleFontsCssUrl(usage: FontUsage): string | null {
  if (usage.families.size === 0) return null;
  const fam = [...usage.families]
    .map(([family, weights]) => {
      const plus = encodeURIComponent(family).replace(/%20/g, "+");
      return `family=${plus}:wght@${[...weights].sort((a, b) => a - b).join(";")}`;
    })
    .join("&");
  return `https://fonts.googleapis.com/css2?${fam}&text=${encodeURIComponent(usage.text.slice(0, 1500))}&display=block`;
}

// Reemplaza el <link> de Google Fonts por @font-face con los WOFF2 embebidos.
// Si algo falla, deja el link (la pieza sigue funcionando, con fuente externa).
export async function embedGoogleFonts(html: string, usage: FontUsage): Promise<{ html: string; embedded: boolean }> {
  const url = googleFontsCssUrl(usage);
  const linkRe = /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*">/;
  if (!url || !linkRe.test(html)) return { html, embedded: false };
  try {
    const css = await (await fetch(url, { cache: "force-cache" })).text();
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    if (faces.length === 0) return { html, embedded: false };
    const out: string[] = [];
    for (const face of faces) {
      const m = /url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/.exec(face);
      if (!m) continue;
      const res = await fetch(m[1], { cache: "force-cache" });
      if (!res.ok) return { html, embedded: false };
      const buf = new Uint8Array(await res.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      out.push(face.replace(m[1], `data:font/woff2;base64,${btoa(bin)}`));
    }
    if (out.length === 0) return { html, embedded: false };
    return { html: html.replace(linkRe, `<style>${out.join("\n")}</style>`), embedded: true };
  } catch {
    return { html, embedded: false };
  }
}

// ---------------------------------------------------------------------------
// Imágenes (navegador)
// ---------------------------------------------------------------------------

export interface PrepareOptions {
  // Tamaño dibujado en la pieza; sin caja, no se redimensiona.
  box?: AssetBox;
  dpr: number;
  // Calidad JPEG 0..1.
  quality: number;
}

function hasAlpha(bmp: ImageBitmap): boolean {
  const s = 48;
  const c = new OffscreenCanvas(s, s);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, s, s);
  const d = ctx.getImageData(0, 0, s, s).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

// Redimensiona al tamaño necesario (cubrir la caja × dpr, nunca agrandar) y
// re-codifica. SVG se deja tal cual.
export async function prepareAsset(blob: Blob, opts: PrepareOptions): Promise<Blob> {
  if (blob.type === "image/svg+xml" || typeof OffscreenCanvas === "undefined") return blob;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    return blob;
  }
  const need = opts.box ? Math.max(opts.box.w * opts.dpr, 1) : bmp.width;
  const needH = opts.box ? Math.max(opts.box.h * opts.dpr, 1) : bmp.height;
  const scale = Math.min(1, Math.max(need / bmp.width, needH / bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const alpha = blob.type === "image/png" || blob.type === "image/webp" ? hasAlpha(bmp) : false;
  // Ya chica y JPEG a calidad normal: no vale la pena re-codificar.
  if (scale >= 1 && blob.type === "image/jpeg" && opts.quality >= 0.8) {
    bmp.close();
    return blob;
  }
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  if (!alpha) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const out = alpha
    ? await canvas.convertToBlob({ type: "image/png" })
    : await canvas.convertToBlob({ type: "image/jpeg", quality: opts.quality });
  // Si re-codificar no achicó, la original sirve.
  return out.size < blob.size || scale < 1 ? out : blob;
}

// ---------------------------------------------------------------------------
// Fotos que sangran: recorte a lo visible
// ---------------------------------------------------------------------------
//
// Una foto de fondo reencuadrada tiene su caja más grande que el formato
// (una de 1456 px en un 728×90). Embeberla entera multiplica el peso por lo
// que no se ve. Se recorta al rectángulo visible y la capa pasa a medir eso,
// con el punto focal al centro (el recorte ya tiene la proporción exacta).

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BleedCrop {
  id: string;
  src: string;
  box: Rect;
  visible: Rect;
  focal: { x: number; y: number };
}

export function bleedingImages(tree: TemplateDefinition): BleedCrop[] {
  const F = tree.size;
  const out: BleedCrop[] = [];
  for (const l of tree.children) {
    if (l.type !== "image" || !l.src || l.src.startsWith("data:") || l.visible === false) continue;
    if ((l.fit ?? "cover") !== "cover" || l.rotation) continue;
    const box = { x: l.position.x, y: l.position.y, w: l.size.w, h: l.size.h };
    const outside = box.x < -1 || box.y < -1 || box.x + box.w > F.w + 1 || box.y + box.h > F.h + 1;
    if (!outside) continue;
    const x0 = Math.max(0, box.x);
    const y0 = Math.max(0, box.y);
    const x1 = Math.min(F.w, box.x + box.w);
    const y1 = Math.min(F.h, box.y + box.h);
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    out.push({
      id: l.id,
      src: l.src,
      box,
      visible: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      focal: { x: l.focalX ?? 50, y: l.focalY ?? 50 },
    });
  }
  return out;
}

// Rectángulo de la foto (en px de la imagen, 0..iw/0..ih) que queda visible
// con fit cover + object-position en la caja.
export function cropRectFor(crop: BleedCrop, iw: number, ih: number): Rect {
  const s = Math.max(crop.box.w / iw, crop.box.h / ih);
  const rw = iw * s;
  const rh = ih * s;
  const ox = (crop.box.w - rw) * (crop.focal.x / 100);
  const oy = (crop.box.h - rh) * (crop.focal.y / 100);
  const vx = crop.visible.x - crop.box.x;
  const vy = crop.visible.y - crop.box.y;
  const x = Math.max(0, Math.min(iw, (vx - ox) / s));
  const y = Math.max(0, Math.min(ih, (vy - oy) / s));
  const w = Math.max(1, Math.min(iw - x, crop.visible.w / s));
  const h = Math.max(1, Math.min(ih - y, crop.visible.h / s));
  return { x, y, w, h };
}

// Recorta y redimensiona (navegador). `scale` = px de salida por px de la
// pieza (wrapper × dpr).
export async function cropAsset(blob: Blob, crop: BleedCrop, scale: number, quality: number): Promise<Blob> {
  if (blob.type === "image/svg+xml" || typeof OffscreenCanvas === "undefined") return blob;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    return blob;
  }
  const r = cropRectFor(crop, bmp.width, bmp.height);
  const w = Math.max(1, Math.round(Math.min(r.w, crop.visible.w * scale)));
  const h = Math.max(1, Math.round(Math.min(r.h, crop.visible.h * scale)));
  const alpha = blob.type === "image/png" || blob.type === "image/webp" ? hasAlpha(bmp) : false;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  if (!alpha) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, w, h);
  bmp.close();
  return alpha
    ? canvas.convertToBlob({ type: "image/png" })
    : canvas.convertToBlob({ type: "image/jpeg", quality });
}

// Reescribe en el HTML la capa de la foto: su caja pasa a ser lo visible y
// la imagen el recorte (focal al centro). Opera sobre el <div data-layer-id>
// y su <img>, que es como template-layer.tsx los dibuja.
export function rewriteBleedingImage(html: string, crop: BleedCrop, dataUrl: string): string {
  const marker = `data-layer-id="${crop.id}"`;
  const at = html.indexOf(marker);
  if (at < 0) return html;
  const divStart = html.lastIndexOf("<div", at);
  const divEnd = html.indexOf(">", at);
  const imgStart = html.indexOf("<img", divEnd);
  const imgEnd = html.indexOf(">", imgStart);
  if (divStart < 0 || divEnd < 0 || imgStart < 0 || imgEnd < 0) return html;
  const px = (n: number) => `${Math.round(n * 100) / 100}px`;
  let div = html.slice(divStart, divEnd + 1);
  div = div
    .replace(/left:-?[\d.]+px/, `left:${px(crop.visible.x)}`)
    .replace(/top:-?[\d.]+px/, `top:${px(crop.visible.y)}`)
    .replace(/width:-?[\d.]+px/, `width:${px(crop.visible.w)}`)
    .replace(/height:-?[\d.]+px/, `height:${px(crop.visible.h)}`);
  let img = html.slice(imgStart, imgEnd + 1);
  img = img.replace(/object-position:[^;"]+/, "object-position:50% 50%").replace(/src="[^"]*"/, `src="${dataUrl}"`);
  return html.slice(0, divStart) + div + html.slice(divEnd + 1, imgStart) + img + html.slice(imgEnd + 1);
}
