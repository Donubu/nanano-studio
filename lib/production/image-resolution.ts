// Resolución de las fotos frente a lo que pide cada pieza.
//
// Las fotos generadas salen a 1K; en un master de 1920 px o en un feed
// exportado a 2× se estiran y quedan blandas. Acá se compara el tamaño
// natural de cada imagen con la caja más grande en que se dibuja (× el
// pixel ratio de exportación) y se decide a cuánto hay que reescalarla.
// Compartido UI/backend; puro.

import type { TemplateDefinition } from "./types";
import { assetBoxes } from "./export-assets";

// Hasta este porcentaje de estiramiento no se nota (la foto se recorta
// con cover y los JPG de salida se recomprimen igual).
export const LOW_RES_TOLERANCE = 0.8;
// Factores que ofrece Topaz; más de 4× no mejora una foto generada.
export const MAX_UPSCALE_FACTOR = 4;
// Topaz Standard V2 acepta hasta 512 MP; nos quedamos muy por debajo.
const MAX_OUTPUT_SIDE = 8192;

export interface NaturalSize {
  w: number;
  h: number;
}

export interface LowResAsset {
  src: string;
  have: NaturalSize;
  // Lo que necesita la pieza más exigente (px reales de salida).
  need: NaturalSize;
  // Factor entero de reescalado (2..4) que cubre `need`.
  factor: number;
  // Piezas (etiquetas) donde se nota.
  where: string[];
}

// Cajas requeridas por una pieza: tamaño dibujado × pixel ratio de export.
export function requiredPixels(tree: TemplateDefinition, pixelRatio: number): Map<string, NaturalSize> {
  return assetBoxes(tree, pixelRatio);
}

export function upscaleFactor(have: NaturalSize, need: NaturalSize): number {
  const f = Math.max(need.w / have.w, need.h / have.h);
  if (f <= 1 / LOW_RES_TOLERANCE) return 1;
  const sideCap = Math.floor(MAX_OUTPUT_SIDE / Math.max(have.w, have.h));
  return Math.max(2, Math.min(MAX_UPSCALE_FACTOR, sideCap, Math.ceil(f)));
}

// Junta las piezas: por imagen, la caja más exigente y dónde aparece.
export function lowResAssets(
  pieces: { label: string; tree: TemplateDefinition; pixelRatio: number }[],
  natural: Map<string, NaturalSize>,
): LowResAsset[] {
  const bySrc = new Map<string, { need: NaturalSize; where: string[] }>();
  for (const p of pieces) {
    for (const [src, box] of requiredPixels(p.tree, p.pixelRatio)) {
      const have = natural.get(src);
      if (!have || have.w <= 0 || have.h <= 0) continue;
      if (upscaleFactor(have, box) === 1) continue;
      const cur = bySrc.get(src);
      if (!cur) bySrc.set(src, { need: { ...box }, where: [p.label] });
      else {
        cur.need = { w: Math.max(cur.need.w, box.w), h: Math.max(cur.need.h, box.h) };
        if (!cur.where.includes(p.label)) cur.where.push(p.label);
      }
    }
  }
  return [...bySrc].map(([src, v]) => {
    const have = natural.get(src)!;
    return { src, have, need: v.need, factor: upscaleFactor(have, v.need), where: v.where };
  });
}

// Fotos que vale la pena reescalar: rasters nuestros, no íconos SVG ni
// datos embebidos.
export function isUpscalableSrc(src: string): boolean {
  if (!/^https:\/\//.test(src)) return false;
  return !/\.svg(\?|$)/i.test(src);
}
