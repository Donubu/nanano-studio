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
} from "./animation";

const MIN_SIZE = 8;

export function reflowForPreview(
  root: TemplateDefinition,
  previewSize: { w: number; h: number }
): TemplateDefinition {
  // Reflow de los layers PRIMERO para conocer las nuevas posiciones que
  // resultan de aplicar constraints. reflowAnimation las usa como anchor
  // para re-localizar los keyframes — si solo escaláramos los kfs por
  // sx/sy uniforme (como antes), los layers con constraint != "scale"
  // quedarían desanclados de su animación (ej. layer con constraint
  // "left" no se mueve al reflowear, pero su kf SÍ — el delta entre
  // ambos crece y la animación arranca en una posición arbitraria).
  const newChildren = root.children.map((c) =>
    reflowChild(c, root.size, previewSize),
  );
  const newRootBase: TemplateDefinition = {
    ...root,
    size: previewSize,
    children: newChildren,
  };
  return {
    ...newRootBase,
    animation: root.animation
      ? reflowAnimation(root.animation, root, newRootBase)
      : root.animation,
  };
}

// Reflowa el AnimationConfig usando "delta-anchor": los keyframes se re-anclan
// a la NUEVA posición/tamaño del layer y conservan su delta relativo escalado
// por sx/sy. Necesita los árboles original y nuevo para poder mirar el layer
// referenciado por cada track.
//
//   newKf = newLayerBase + (origKf - origLayerBase) * scale
//
// Para layers que ya no existen en el árbol nuevo (track huérfano), se aplica
// el escalado proporcional viejo como fallback. opacity, rotation, scale*,
// color son adimensionales y pasan inalterados.
export function reflowAnimation(
  animation: AnimationConfig,
  origRoot: TemplateDefinition,
  newRoot: TemplateDefinition,
): AnimationConfig {
  const origSize = origRoot.size;
  const newSize = newRoot.size;
  if (origSize.w <= 0 || origSize.h <= 0) return animation;
  const sx = newSize.w / origSize.w;
  const sy = newSize.h / origSize.h;
  // Para blur usamos el promedio de los dos factores — no hay una dimensión
  // natural para blur. El productor puede ajustar a mano si lo necesita.
  const sblur = (sx + sy) / 2;
  const origLayers = indexLayersById(origRoot);
  const newLayers = indexLayersById(newRoot);
  return {
    ...animation,
    tracks: animation.tracks.map((track) =>
      reanchorTrack(
        track,
        origLayers.get(track.layerId) ?? null,
        newLayers.get(track.layerId) ?? null,
        sx,
        sy,
        sblur,
      ),
    ),
  };
}

function indexLayersById(root: TemplateDefinition): Map<string, TemplateLayer> {
  const out = new Map<string, TemplateLayer>();
  function walk(layer: TemplateLayer) {
    out.set(layer.id, layer);
    if (layer.type === "frame") for (const c of layer.children) walk(c);
  }
  walk(root);
  return out;
}

function reanchorTrack(
  track: AnimationTrack,
  origLayer: TemplateLayer | null,
  newLayer: TemplateLayer | null,
  sx: number,
  sy: number,
  sblur: number,
): AnimationTrack {
  // Helper: re-ancla un kf numérico al newBase + (kf - origBase) * scale.
  // Cuando falta el layer (track huérfano) cae al escalado proporcional viejo.
  const reanchor = (
    origBase: number | null,
    newBase: number | null,
    scale: number,
  ) => (kfValue: number): number => {
    if (origBase === null || newBase === null) return kfValue * scale;
    return newBase + (kfValue - origBase) * scale;
  };
  const property = track.property;
  let transform: ((v: number) => number) | null = null;
  switch (property) {
    case "position.x":
      transform = reanchor(
        origLayer?.position.x ?? null,
        newLayer?.position.x ?? null,
        sx,
      );
      break;
    case "position.y":
      transform = reanchor(
        origLayer?.position.y ?? null,
        newLayer?.position.y ?? null,
        sy,
      );
      break;
    case "size.w":
      transform = reanchor(
        origLayer?.size.w ?? null,
        newLayer?.size.w ?? null,
        sx,
      );
      break;
    case "size.h":
      transform = reanchor(
        origLayer?.size.h ?? null,
        newLayer?.size.h ?? null,
        sy,
      );
      break;
    case "blur":
      // blur no es relativo a una posición del layer; siempre proporcional.
      transform = (v: number) => v * sblur;
      break;
  }
  if (transform === null) return track; // prop adimensional, sin cambios
  const t = transform;
  return {
    ...track,
    keyframes: track.keyframes.map((k) => ({
      ...k,
      value: typeof k.value === "number" ? t(k.value) : k.value,
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
