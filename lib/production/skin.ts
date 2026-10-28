// Piel gráfica de textos (LayerSkin, types.ts): geometría del render y
// aplicación de una piel recién generada a la capa. Puro: lo usan el editor,
// las previews, el export HTML5 y los tests.
//
// El render son celdas con background-image (no <img> ni border-image):
// html-to-image embebe background-image al exportar JPG, y el export HTML5
// inlinea esas URLs una sola vez (html5-export.ts).

import type { LayerSkin, TemplateLayer, TextLayer } from "./types";
import { safeMargin } from "./layout-lint";

export type SkinKind = "button" | "badge";

export interface SkinCell {
  x: number;
  y: number;
  w: number;
  h: number;
  bgW: number;
  bgH: number;
  bgX: number;
  bgY: number;
}

export interface SkinLayout {
  cells: SkinCell[];
  // Caja del texto dentro de la capa.
  content: { x: number; y: number; w: number; h: number };
}

// Escala uniforme de la piel en la caja: la que la hace caber en ambos ejes.
// En "slice" los bordes se dibujan a esa escala y el centro rellena el resto;
// en "fit" la imagen entera queda centrada a esa escala (nunca se deforma).
export function skinLayout(skin: LayerSkin, box: { w: number; h: number }): SkinLayout {
  const W = skin.imageW;
  const H = skin.imageH;
  const k = Math.min(box.w / W, box.h / H);
  const [it, ir, ib, il] = skin.inset;

  if (skin.mode === "fit" || !skin.slice) {
    const rw = W * k;
    const rh = H * k;
    const ox = (box.w - rw) / 2;
    const oy = (box.h - rh) / 2;
    return {
      cells: [{ x: ox, y: oy, w: rw, h: rh, bgW: rw, bgH: rh, bgX: 0, bgY: 0 }],
      content: {
        x: ox + il * rw,
        y: oy + it * rh,
        w: Math.max(1, rw * (1 - il - ir)),
        h: Math.max(1, rh * (1 - it - ib)),
      },
    };
  }

  const [T, R, B, L] = skin.slice;
  // Bordes de destino redondeados a px enteros: con posiciones fraccionarias
  // el navegador deja líneas finas entre celdas.
  const cols = [0, Math.round(L * k), Math.round(box.w - R * k), Math.round(box.w)];
  const rows = [0, Math.round(T * k), Math.round(box.h - B * k), Math.round(box.h)];
  const srcCols = [0, L, W - R, W];
  const srcRows = [0, T, H - B, H];
  const cells: SkinCell[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const w = cols[c + 1] - cols[c];
      const h = rows[r + 1] - rows[r];
      const sw = srcCols[c + 1] - srcCols[c];
      const sh = srcRows[r + 1] - srcRows[r];
      if (w <= 0 || h <= 0 || sw <= 0 || sh <= 0) continue;
      const sx = w / sw;
      const sy = h / sh;
      // Cada celda (salvo la primera de su fila/columna) se monta 1 px sobre
      // la anterior: con el zoom fraccionario del canvas o del navegador, las
      // uniones exactas dejan ver una rendija del fondo.
      const ox = c > 0 ? 1 : 0;
      const oy = r > 0 ? 1 : 0;
      cells.push({
        x: cols[c] - ox,
        y: rows[r] - oy,
        w: w + ox,
        h: h + oy,
        bgW: W * sx,
        bgH: H * sy,
        bgX: -srcCols[c] * sx + ox,
        bgY: -srcRows[r] * sy + oy,
      });
    }
  }
  return {
    cells,
    content: {
      x: il * W * k,
      y: it * H * k,
      w: Math.max(1, box.w - (il + ir) * W * k),
      h: Math.max(1, box.h - (it + ib) * H * k),
    },
  };
}

// Bordes y zona de texto por defecto según el tipo, a partir del tamaño de
// la imagen ya recortada. Botón: los extremos (hasta media altura, como una
// pastilla) no se estiran; el texto evita los extremos y un poco el borde
// de arriba/abajo (biseles, brillos). Sello: el texto queda en el centro.
export function defaultSkinGeometry(
  kind: SkinKind,
  w: number,
  h: number,
): Pick<LayerSkin, "mode" | "slice" | "inset"> {
  if (kind === "badge") {
    return { mode: "fit", inset: [0.2, 0.18, 0.2, 0.18] };
  }
  const end = Math.round(Math.min(h * 0.5, w * 0.3));
  const cap = Math.round(h * 0.3);
  const side = Math.min(0.3, (end * 0.6) / w);
  return { mode: "slice", slice: [cap, end, cap, end], inset: [0.12, side, 0.14, side] };
}

// Aplica una piel a un texto. Toma el color promedio de la piel como
// backgroundColor: así el contraste, la inferencia de rol (CTA/badge) y las
// reglas de proporción siguen funcionando como con un fondo plano. Un sello
// ("fit") toma la proporción de la imagen conservando el área y el centro.
export function applySkin(
  layer: TemplateLayer,
  skin: LayerSkin,
  averageColor: string | null,
  frame?: { w: number; h: number },
): TemplateLayer {
  if (layer.type !== "text") return layer;
  let next: TextLayer = {
    ...layer,
    skin,
    style: {
      ...layer.style,
      backgroundColor: averageColor ?? layer.style.backgroundColor ?? "#000000",
      verticalAlign: "middle",
      align: "center",
    },
  };
  if (skin.mode === "fit") {
    const ratio = skin.imageW / skin.imageH;
    let s = Math.sqrt((layer.size.w * layer.size.h) / ratio);
    let w = s * ratio;
    let x = layer.position.x + (layer.size.w - w) / 2;
    let y = layer.position.y + (layer.size.h - s) / 2;
    if (frame) {
      // Dentro del formato y, si la capa ya estaba dentro, del margen de
      // seguridad (crecer desde el centro la sacaba hacia el borde).
      const m = safeMargin(frame);
      const fit = Math.min(1, (frame.w - 2 * m) / w, (frame.h - 2 * m) / s);
      s *= fit;
      w *= fit;
      x = layer.position.x + (layer.size.w - w) / 2;
      y = layer.position.y + (layer.size.h - s) / 2;
      const inside =
        layer.position.x >= m - 1 &&
        layer.position.y >= m - 1 &&
        layer.position.x + layer.size.w <= frame.w - m + 1 &&
        layer.position.y + layer.size.h <= frame.h - m + 1;
      const lo = inside ? m : 0;
      x = Math.min(Math.max(lo, x), frame.w - lo - w);
      y = Math.min(Math.max(lo, y), frame.h - lo - s);
    }
    next = {
      ...next,
      position: { x: Math.round(x), y: Math.round(y) },
      size: { w: Math.round(w), h: Math.round(s) },
    };
  }
  return next;
}

export function removeSkin(layer: TemplateLayer): TemplateLayer {
  if (layer.type !== "text" || !layer.skin) return layer;
  return { ...layer, skin: null };
}
