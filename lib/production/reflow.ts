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
  return keepLayerAspect(next, layer);
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

// ---------------------------------------------------------------------------
// Seguir a las capas que se movieron en una edición
// ---------------------------------------------------------------------------

const BASE_PROPS: Partial<Record<AnimatableProperty, (l: TemplateLayer) => number>> = {
  "position.x": (l) => l.position.x,
  "position.y": (l) => l.position.y,
  "size.w": (l) => l.size.w,
  "size.h": (l) => l.size.h,
};

// Los keyframes de posición/tamaño guardan valores absolutos. Si una edición
// cambia la BASE de una capa animada (mover con el mouse, alinear, "Pídele a
// la IA"), sin esto la animación la devuelve al lugar viejo al reproducir.
// Desplaza los keyframes de esas propiedades en el mismo delta y quita los
// tracks de capas que ya no existen. Compara `prev` contra `next` y opera
// sobre next.animation, así no pisa keyframes que la misma edición cambió
// (auto-keyframe edita el keyframe y deja la base igual: delta 0).
export function followBaseChanges(prev: TemplateDefinition, next: TemplateDefinition): TemplateDefinition {
  const anim = next.animation;
  if (!anim || anim.tracks.length === 0 || prev === next) return next;
  const before = indexLayersById(prev);
  const after = indexLayersById(next);
  let changed = false;
  const tracks: AnimationTrack[] = [];
  for (const tr of anim.tracks) {
    const now = after.get(tr.layerId);
    if (!now) {
      changed = true;
      continue;
    }
    const was = before.get(tr.layerId);
    const read = BASE_PROPS[tr.property];
    if (!was || !read) {
      tracks.push(tr);
      continue;
    }
    const delta = read(now) - read(was);
    if (delta === 0) {
      tracks.push(tr);
      continue;
    }
    changed = true;
    tracks.push({
      ...tr,
      keyframes: tr.keyframes.map((k) => (typeof k.value === "number" ? { ...k, value: k.value + delta } : k)),
    });
  }
  return changed ? { ...next, animation: { ...anim, tracks } } : next;
}

// Íconos, badges circulares y elipses conservan su proporción: los
// constraints "scale"/"stretch" (y el ajuste por formato de adapt.ts) los
// estiraban en un eje (un badge cuadrado de 220 quedaba de 391×220 al pasar
// de 1080×1080 a 1920×1080). Se recorta el eje sobrante y se centra.
export function keepLayerAspect(l: TemplateLayer, orig: TemplateLayer): TemplateLayer {
  const ratio0 = orig.size.w / Math.max(1, orig.size.h);
  const roundBadge =
    orig.type === "text" &&
    !!orig.style.backgroundColor &&
    (orig.style.backgroundCornerRadius ?? 0) >= Math.min(orig.size.w, orig.size.h) * 0.45 &&
    Math.abs(ratio0 - 1) < 0.15;
  const ellipse = orig.type === "shape" && orig.shape === "ellipse";
  // Botones y badges en pastilla: pueden ensancharse o angostarse con el
  // formato, pero no cambiar de forma (una pastilla horizontal que queda
  // parada parte el texto y deja de verse como botón).
  const pill = orig.type === "text" && !!orig.style.backgroundColor && !roundBadge;
  if (orig.type !== "icon" && !roundBadge && !ellipse && !pill) return l;
  const ratio = l.size.w / Math.max(1, l.size.h);
  const tolerance = pill ? Math.log(1.4) : 0.03;
  if (Math.abs(Math.log(ratio / ratio0)) < tolerance) return l;
  const w = ratio > ratio0 ? l.size.h * ratio0 : l.size.w;
  const h = ratio > ratio0 ? l.size.h : l.size.w / ratio0;
  const next = {
    ...l,
    position: { x: l.position.x + (l.size.w - w) / 2, y: l.position.y + (l.size.h - h) / 2 },
    size: { w, h },
  };
  if (next.type === "text" && roundBadge) {
    return { ...next, style: { ...next.style, backgroundCornerRadius: Math.min(w, h) / 2 } };
  }
  return next;
}
