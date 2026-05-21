// Reflow engine: recompute layer positions and sizes for a new parent size,
// honoring each layer's constraints. Used by the editor's preview mode and
// (later) by the adaptations renderer to derive layouts for non-master formats.
//
// Slice 2D: visual-only reflow on a cloned tree; never mutates the master.

import {
  TemplateDefinition,
  TemplateLayer,
  Constraints,
  ConstraintH,
  ConstraintV,
} from "./types";
import { effectiveConstraints } from "./smart-constraints";
import {
  AnimationConfig,
  AnimationTrack,
  AnimatableProperty,
} from "./animation";

const MIN_SIZE = 8;

export function reflowForPreview(
  root: TemplateDefinition,
  previewSize: { w: number; h: number }
): TemplateDefinition {
  return {
    ...root,
    size: previewSize,
    children: root.children.map((c) => reflowChild(c, root.size, previewSize)),
    // Si hay timeline, los keyframes de propiedades con unidad de
    // píxel (position.x/y, size.w/h, blur) se reescalan proporcional al
    // cambio del root. opacity, scale, rotation y color son adimensionales
    // y pasan inalterados. Mismo principio que el reflow de constraints
    // sobre los layers — el productor anima en el master y la animación
    // se propaga a variantes/adapts sin volver a tocarse.
    animation: root.animation
      ? reflowAnimation(root.animation, root.size, previewSize)
      : root.animation,
  };
}

export function reflowAnimation(
  animation: AnimationConfig,
  origSize: { w: number; h: number },
  newSize: { w: number; h: number },
): AnimationConfig {
  if (origSize.w <= 0 || origSize.h <= 0) return animation;
  const sx = newSize.w / origSize.w;
  const sy = newSize.h / origSize.h;
  // Para blur usamos el promedio de los dos factores (la idea es "tamaño
  // visual" — no hay una dimensión natural para blur). Es una aproximación;
  // si el productor necesita blur exacto en una orientación, lo ajusta a
  // mano. Lo mismo aplica al scale-uniform del adapt fit en overrides.ts.
  const sblur = (sx + sy) / 2;
  return {
    ...animation,
    tracks: animation.tracks.map((track) =>
      scaleTrack(track, track.property, sx, sy, sblur),
    ),
  };
}

function scaleTrack(
  track: AnimationTrack,
  property: AnimatableProperty,
  sx: number,
  sy: number,
  sblur: number,
): AnimationTrack {
  let factor: number | null = null;
  switch (property) {
    case "position.x":
    case "size.w":
      factor = sx;
      break;
    case "position.y":
    case "size.h":
      factor = sy;
      break;
    case "blur":
      factor = sblur;
      break;
  }
  if (factor === null) return track;
  const f = factor;
  return {
    ...track,
    keyframes: track.keyframes.map((k) => ({
      ...k,
      value: typeof k.value === "number" ? k.value * f : k.value,
    })),
  };
}

function reflowChild(
  layer: TemplateLayer,
  origParent: { w: number; h: number },
  newParent: { w: number; h: number }
): TemplateLayer {
  // Smart inference: cuando la capa no tiene constraints custom, se calcula
  // un constraint razonable según la posición. Si el usuario eligió algo
  // explícito, se respeta.
  const constraints: Constraints = effectiveConstraints(layer, { size: origParent });
  const horiz = applyAxis(layer.position.x, layer.size.w, origParent.w, newParent.w, constraints.h);
  const vert = applyAxisV(layer.position.y, layer.size.h, origParent.h, newParent.h, constraints.v);
  const next: TemplateLayer = {
    ...layer,
    position: { x: horiz.pos, y: vert.pos },
    size: { w: horiz.size, h: vert.size },
  };
  if (next.type === "frame") {
    // Recurse: each child reflows against this frame's NEW size, comparing to
    // its ORIGINAL size.
    return {
      ...next,
      children: next.children.map((c) =>
        reflowChild(
          c,
          { w: layer.size.w, h: layer.size.h },
          { w: horiz.size, h: vert.size }
        )
      ),
    };
  }
  return next;
}

function applyAxis(
  pos: number,
  size: number,
  origParent: number,
  newParent: number,
  c: ConstraintH
): { pos: number; size: number } {
  switch (c) {
    case "left":
      return { pos, size };
    case "right": {
      const rightDist = origParent - (pos + size);
      return { pos: newParent - rightDist - size, size };
    }
    case "center": {
      const centerOffset = pos + size / 2 - origParent / 2;
      return { pos: newParent / 2 + centerOffset - size / 2, size };
    }
    case "stretch": {
      const leftDist = pos;
      const rightDist = origParent - (pos + size);
      const newSize = Math.max(MIN_SIZE, newParent - leftDist - rightDist);
      return { pos: leftDist, size: newSize };
    }
    case "scale": {
      const factor = origParent > 0 ? newParent / origParent : 1;
      return { pos: pos * factor, size: Math.max(MIN_SIZE, size * factor) };
    }
    default: {
      // Defensive: si llega un valor que TS no esperaba (data legacy,
      // import externo malformado), tratamos como "left" en vez de
      // retornar undefined y crashear más arriba con un mensaje opaco.
      console.warn("[reflow] applyAxis constraint desconocido, usando 'left':", c);
      return { pos, size };
    }
  }
}

function applyAxisV(
  pos: number,
  size: number,
  origParent: number,
  newParent: number,
  c: ConstraintV
): { pos: number; size: number } {
  switch (c) {
    case "top":
      return { pos, size };
    case "bottom": {
      const bottomDist = origParent - (pos + size);
      return { pos: newParent - bottomDist - size, size };
    }
    case "center": {
      const centerOffset = pos + size / 2 - origParent / 2;
      return { pos: newParent / 2 + centerOffset - size / 2, size };
    }
    case "stretch": {
      const topDist = pos;
      const bottomDist = origParent - (pos + size);
      const newSize = Math.max(MIN_SIZE, newParent - topDist - bottomDist);
      return { pos: topDist, size: newSize };
    }
    case "scale": {
      const factor = origParent > 0 ? newParent / origParent : 1;
      return { pos: pos * factor, size: Math.max(MIN_SIZE, size * factor) };
    }
    default: {
      // Mismo razonamiento que applyAxis: fallback a "top" en vez de crashear.
      console.warn("[reflow] applyAxisV constraint desconocido, usando 'top':", c);
      return { pos, size };
    }
  }
}
