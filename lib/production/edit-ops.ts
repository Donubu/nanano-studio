// Operaciones de edición por IA sobre una pieza ("Pídele a la IA" del
// editor). El modelo no devuelve el árbol: devuelve una lista corta de
// operaciones (cambiar texto, mover/editar, agregar, quitar, fondo, generar
// imagen) que este módulo aplica con los mismos constructores del editor.
// Puro: corre en server (para validar y armar la propuesta) y en tests.

import {
  TemplateDefinition,
  TemplateLayer,
  TextLayer,
  newTextLayer,
  newImageLayer,
  newShapeLayer,
  newIconLayer,
  isFontSizeRange,
} from "./types";
import { newButtonLayer, newBadgeLayer } from "./preset-layers";
import { isValidIconName } from "./icon-catalog";

export const EDIT_OPS = ["set_text", "update", "add", "remove", "set_background", "generate_image"] as const;
export type EditOpKind = (typeof EDIT_OPS)[number];
export const ADD_KINDS = ["text", "button", "badge", "image", "shape", "icon"] as const;
export type AddKind = (typeof ADD_KINDS)[number];

export interface EditOp {
  op: EditOpKind;
  id?: string;
  kind?: AddKind;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  content?: string;
  font_size?: number;
  font_weight?: number;
  color?: string;
  background_color?: string;
  align?: "left" | "center" | "right";
  hidden?: boolean;
  icon_name?: string;
  // Para "generate_image" y para "add" de kind image.
  image_prompt?: string;
  name?: string;
}

export interface ImageRequest {
  layer_id: string;
  prompt: string;
}

export interface EditResult {
  definition: TemplateDefinition;
  images: ImageRequest[];
  applied: number;
  skipped: string[];
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const COLOR_RE = /^(#[0-9a-f]{3,8}|\{color\.[\w-]+\})$/i;
const color = (v: unknown) => (typeof v === "string" && COLOR_RE.test(v.trim()) ? v.trim() : undefined);

function mapLayers(nodes: TemplateLayer[], id: string, fn: (l: TemplateLayer) => TemplateLayer | null): TemplateLayer[] {
  const out: TemplateLayer[] = [];
  for (const n of nodes) {
    if (n.id === id) {
      const r = fn(n);
      if (r) out.push(r);
      continue;
    }
    out.push(n.type === "frame" ? { ...n, children: mapLayers(n.children, id, fn) } : n);
  }
  return out;
}

function exists(nodes: TemplateLayer[], id: string): boolean {
  return nodes.some((n) => n.id === id || (n.type === "frame" && exists(n.children, id)));
}

function clampBox(l: TemplateLayer, frame: { w: number; h: number }): TemplateLayer {
  const w = Math.min(Math.max(4, l.size.w), frame.w);
  const h = Math.min(Math.max(4, l.size.h), frame.h);
  const x = Math.min(Math.max(-w * 0.5, l.position.x), frame.w - w * 0.5);
  const y = Math.min(Math.max(-h * 0.5, l.position.y), frame.h - h * 0.5);
  return { ...l, position: { x: Math.round(x), y: Math.round(y) }, size: { w: Math.round(w), h: Math.round(h) } };
}

function applyStyle(l: TemplateLayer, op: EditOp): TemplateLayer {
  let next = l;
  if (finite(op.x) || finite(op.y) || finite(op.w) || finite(op.h)) {
    next = {
      ...next,
      position: { x: finite(op.x) ? op.x : next.position.x, y: finite(op.y) ? op.y : next.position.y },
      size: { w: finite(op.w) && op.w > 0 ? op.w : next.size.w, h: finite(op.h) && op.h > 0 ? op.h : next.size.h },
    };
  }
  if (typeof op.hidden === "boolean") next = { ...next, visible: !op.hidden };
  if (typeof op.name === "string" && op.name.trim()) next = { ...next, name: op.name.trim().slice(0, 60) };
  const c = color(op.color);
  if (next.type === "text") {
    const t: TextLayer = next;
    let style = t.style;
    if (finite(op.font_size)) {
      const fs = Math.max(7, Math.min(1000, Math.round(op.font_size)));
      style = { ...style, fontSize: isFontSizeRange(style.fontSize) ? { min: Math.min(style.fontSize.min, fs), max: fs } : fs };
    }
    if (finite(op.font_weight)) style = { ...style, fontWeight: Math.max(100, Math.min(900, Math.round(op.font_weight / 100) * 100)) };
    if (c) style = { ...style, color: c };
    const bg = color(op.background_color);
    if (bg) style = { ...style, backgroundColor: bg };
    if (op.align) style = { ...style, align: op.align };
    next = { ...t, style, ...(typeof op.content === "string" ? { content: op.content.slice(0, 500) } : {}) };
  } else if (next.type === "shape" && c) {
    next = { ...next, fill: c };
  } else if (next.type === "icon") {
    if (c) next = { ...next, color: c };
    if (op.icon_name && isValidIconName(op.icon_name)) next = { ...next, iconName: op.icon_name };
  }
  return next;
}

// Color del texto visible más cercano a una caja: lo heredan los textos e
// íconos nuevos cuando el modelo no indica color (el default del editor es
// casi negro y desaparece sobre fotos oscuras).
function nearestTextColor(nodes: TemplateLayer[], box: { x: number; y: number; w: number; h: number }): string | null {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let best: { d: number; color: string } | null = null;
  for (const n of nodes) {
    if (n.type !== "text" || n.visible === false || n.style.backgroundColor) continue;
    const d = Math.hypot(n.position.x + n.size.w / 2 - cx, n.position.y + n.size.h / 2 - cy);
    if (!best || d < best.d) best = { d, color: n.style.color };
  }
  return best?.color ?? null;
}

// El nombre de la capa lo pone el código, no el modelo: como campo libre del
// schema, Gemini a veces entraba en un bucle de palabras en "name".
const KIND_LABEL: Record<AddKind, string> = {
  text: "Texto",
  button: "Botón",
  badge: "Badge",
  image: "Imagen",
  shape: "Forma",
  icon: "Ícono",
};

function layerName(op: EditOp, l: TemplateLayer): string {
  const label = op.kind ? KIND_LABEL[op.kind] : l.name ?? "Capa";
  if (l.type === "icon" && op.icon_name) return `${label} ${op.icon_name}`;
  const text = typeof op.content === "string" ? op.content.replace(/\s+/g, " ").trim() : "";
  return text ? `${label} · ${text.slice(0, 24)}` : label;
}

function newLayer(
  op: EditOp,
  frame: { w: number; h: number },
  siblings: TemplateLayer[],
  makeId: () => string,
): TemplateLayer | null {
  const cx = frame.w / 2;
  const cy = frame.h / 2;
  let l: TemplateLayer;
  switch (op.kind) {
    case "text":
      l = newTextLayer(cx, cy);
      break;
    case "button":
      l = newButtonLayer(cx, cy);
      break;
    case "badge":
      l = newBadgeLayer(cx, cy);
      break;
    case "image":
      l = newImageLayer(cx, cy);
      break;
    case "shape":
      l = newShapeLayer(cx, cy);
      break;
    case "icon":
      l = newIconLayer(cx, cy, op.icon_name && isValidIconName(op.icon_name) ? op.icon_name : "Star");
      break;
    default:
      return null;
  }
  const placed = clampBox(applyStyle({ ...l, id: makeId(), name: layerName(op, l) }, op), frame);
  if (!color(op.color) && (placed.type === "icon" || (placed.type === "text" && !placed.style.backgroundColor))) {
    const inherited = nearestTextColor(siblings, { ...placed.position, ...placed.size });
    if (inherited) {
      return placed.type === "icon"
        ? { ...placed, color: inherited }
        : { ...placed, style: { ...placed.style, color: inherited } };
    }
  }
  return placed;
}

export function applyEditOps(
  def: TemplateDefinition,
  ops: EditOp[],
  makeId: () => string = () => crypto.randomUUID(),
): EditResult {
  let children = def.children;
  let background = def.background;
  const images: ImageRequest[] = [];
  const skipped: string[] = [];
  let applied = 0;

  for (const op of ops) {
    const needsId = op.op !== "add" && op.op !== "set_background";
    if (needsId && (!op.id || !exists(children, op.id))) {
      skipped.push(`${op.op}: capa "${op.id ?? "?"}" no existe`);
      continue;
    }
    switch (op.op) {
      case "set_text":
        children = mapLayers(children, op.id!, (l) =>
          l.type === "text" && typeof op.content === "string" ? { ...l, content: op.content.slice(0, 500) } : l,
        );
        break;
      case "update":
        children = mapLayers(children, op.id!, (l) => applyStyle(l, op));
        break;
      case "remove":
        children = mapLayers(children, op.id!, () => null);
        break;
      case "set_background": {
        const c = color(op.color);
        if (!c) {
          skipped.push("set_background: color inválido");
          continue;
        }
        background = { type: "color", value: c };
        break;
      }
      case "generate_image":
        if (!op.image_prompt?.trim()) {
          skipped.push(`generate_image: falta prompt para "${op.id}"`);
          continue;
        }
        children = mapLayers(children, op.id!, (l) => l);
        images.push({ layer_id: op.id!, prompt: op.image_prompt.trim() });
        break;
      case "add": {
        const l = newLayer(op, def.size, children, makeId);
        if (!l) {
          skipped.push(`add: tipo "${op.kind ?? "?"}" no soportado`);
          continue;
        }
        // Fondos y fotos grandes van atrás; el resto, arriba de todo.
        const isBack = l.type === "image" && l.size.w >= def.size.w * 0.9 && l.size.h >= def.size.h * 0.9;
        children = isBack ? [l, ...children] : [...children, l];
        if (l.type === "image" && op.image_prompt?.trim()) {
          images.push({ layer_id: l.id, prompt: op.image_prompt.trim() });
        }
        break;
      }
    }
    applied++;
  }
  return { definition: { ...def, background, children }, images, applied, skipped };
}
