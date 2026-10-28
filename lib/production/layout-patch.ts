// Correcciones por capa sobre una adaptación. La IA no reescribe el árbol:
// devuelve una lista corta de cambios (mover, redimensionar, cambiar el
// tamaño de letra, ocultar) y este módulo los aplica al árbol que ya armó
// el motor. Así el output del modelo son decenas de tokens por formato en
// vez de miles, y nada que no esté en la lista puede romperse.
//
// Reglas de aplicación:
//   - Geometría (x/y/w/h) solo en capas de primer nivel de un root libre.
//     En un root stack las ubica el flex: se ignoran x/y y se respetan w/h.
//   - Un frame redimensionado escala a sus hijos de forma uniforme (los
//     hijos tienen coords relativas al frame).
//   - fontSize reemplaza números y tokens; sobre un rango (smart text) fija
//     el máximo y baja el mínimo si hace falta, para que el auto-fit siga
//     funcionando.
//   - Las capas tocadas se reencajan dentro del formato (salvo fondos), así
//     un redondeo del modelo no deja el árbol fuera del schema.

import {
  TemplateDefinition,
  TemplateLayer,
  TextLayer,
  isFontSizeRange,
} from "./types";
import { scaleLayerUniform } from "./scale";
import { isBackgroundLayer } from "./layout-lint";

export interface LayerPatch {
  id: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fontSize?: number;
  hidden?: boolean;
  align?: "left" | "center" | "right";
}

export interface PatchResult {
  definition: TemplateDefinition;
  applied: string[];
  // ids que el modelo nombró pero no existen en el árbol.
  unknown: string[];
}

const MIN_FONT = 7;
const MAX_FONT = 1000;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round1 = (v: number) => Math.round(v * 10) / 10;

function patchText(layer: TextLayer, p: LayerPatch): TextLayer {
  let style = layer.style;
  if (finite(p.fontSize)) {
    const fs = round1(Math.min(MAX_FONT, Math.max(MIN_FONT, p.fontSize)));
    style = isFontSizeRange(style.fontSize)
      ? { ...style, fontSize: { min: Math.min(style.fontSize.min, fs), max: fs } }
      : { ...style, fontSize: fs };
  }
  if (p.align) style = { ...style, align: p.align };
  return style === layer.style ? layer : { ...layer, style };
}

// Cambios de una capa en cualquier nivel: tipografía y visibilidad.
function patchStyle(layer: TemplateLayer, p: LayerPatch): TemplateLayer {
  let next = layer;
  if (next.type === "text") next = patchText(next, p);
  if (typeof p.hidden === "boolean") next = { ...next, visible: !p.hidden };
  return next;
}

function patchGeometry(
  layer: TemplateLayer,
  p: LayerPatch,
  frame: { w: number; h: number },
  allowPosition: boolean,
): TemplateLayer {
  const w = finite(p.w) && p.w > 0 ? p.w : layer.size.w;
  const h = finite(p.h) && p.h > 0 ? p.h : layer.size.h;
  let next: TemplateLayer = layer;
  if (w !== layer.size.w || h !== layer.size.h) {
    if (layer.type === "frame") {
      const s = Math.min(w / layer.size.w, h / layer.size.h);
      next = scaleLayerUniform(layer, s, 0, 0);
      next = { ...next, position: layer.position };
    }
    next = { ...next, size: { w, h } };
  }
  if (allowPosition && (finite(p.x) || finite(p.y))) {
    next = {
      ...next,
      position: {
        x: finite(p.x) ? p.x : next.position.x,
        y: finite(p.y) ? p.y : next.position.y,
      },
    };
  }
  if (!allowPosition || isBackgroundLayer(layer, frame)) return next;
  // Reencaje: la caja no puede exceder el formato ni salirse de él.
  const cw = Math.min(next.size.w, frame.w);
  const ch = Math.min(next.size.h, frame.h);
  const cx = Math.min(Math.max(0, next.position.x), frame.w - cw);
  const cy = Math.min(Math.max(0, next.position.y), frame.h - ch);
  return {
    ...next,
    position: { x: round1(cx), y: round1(cy) },
    size: { w: round1(cw), h: round1(ch) },
  };
}

export function applyLayerPatches(
  def: TemplateDefinition,
  patches: LayerPatch[],
): PatchResult {
  const byId = new Map<string, LayerPatch>();
  for (const p of patches) {
    if (!p || typeof p.id !== "string") continue;
    byId.set(p.id, { ...byId.get(p.id), ...p });
  }
  const applied: string[] = [];
  const freeRoot = def.layout.mode !== "stack";

  const walk = (nodes: TemplateLayer[], topLevel: boolean): TemplateLayer[] =>
    nodes.map((n) => {
      const p = byId.get(n.id);
      let next = n;
      if (p) {
        applied.push(n.id);
        next = patchStyle(next, p);
        if (topLevel) next = patchGeometry(next, p, def.size, freeRoot);
      }
      if (next.type === "frame") {
        next = { ...next, children: walk(next.children, false) };
      }
      return next;
    });

  const children = walk(def.children, true);
  const unknown = [...byId.keys()].filter((id) => !applied.includes(id));
  return { definition: { ...def, children }, applied, unknown };
}
