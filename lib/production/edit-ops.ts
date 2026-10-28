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
import { removeSkin, type SkinKind } from "./skin";
import { formatChileanPrices } from "./layout-plan";
import { applyTextPreset, TEXT_PRESETS, type TextPresetId } from "./text-presets";

export const EDIT_OPS = [
  "set_text",
  "update",
  "add",
  "remove",
  "set_background",
  "generate_image",
  "frame_subject",
  "set_skin",
] as const;
export type EditOpKind = (typeof EDIT_OPS)[number];
export const ADD_KINDS = ["text", "button", "badge", "image", "shape", "icon"] as const;
export type AddKind = (typeof ADD_KINDS)[number];
export const SKIN_KINDS = ["button", "badge", "none"] as const;

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
  // Imágenes: punto que sobrevive al recorte (0-100, % del ancho/alto de la
  // foto) y modo de ajuste en su caja.
  focal_x?: number;
  focal_y?: number;
  fit?: "cover" | "contain";
  // frame_subject: dónde está el sujeto en la foto (0-100 del ancho/alto de
  // la foto) y dónde debe quedar en la pieza (0-100 del formato; default
  // centro). El encuadre exacto lo calcula frameSubject.
  subject_x?: number;
  subject_y?: number;
  target_x?: number;
  target_y?: number;
  // Para "generate_image" y para "add" de kind image.
  image_prompt?: string;
  // Piel gráfica (skin.ts) para "set_skin" y para "add" de button/badge:
  // descripción del estilo y tipo ("none" la quita).
  skin_prompt?: string;
  skin_kind?: (typeof SKIN_KINDS)[number];
  // Texto gráfico (text-effects.ts): estilo rápido y/o efectos sueltos.
  text_style?: TextPresetId;
  gradient_colors?: string[];
  gradient_angle?: number;
  outline_color?: string;
  outline_width?: number;
  outline2_color?: string;
  outline2_width?: number;
  extrude_color?: string;
  extrude_depth?: number;
  // Textura dentro de las letras (se genera aparte, como las imágenes).
  texture_prompt?: string;
  name?: string;
}

// Para aplicar estilos de texto que aclaran u oscurecen el color (los
// tokens de marca no se pueden mezclar sin resolver).
export interface EditOpsOptions {
  resolveColor?: (c: string) => string;
  accent?: string;
}

export interface SkinRequest {
  layer_id: string;
  kind: SkinKind;
  prompt: string;
}

export interface ImageRequest {
  layer_id: string;
  prompt: string;
}

export interface EditResult {
  definition: TemplateDefinition;
  images: ImageRequest[];
  skins: SkinRequest[];
  textures: ImageRequest[];
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

function findLayer(nodes: TemplateLayer[], id: string): TemplateLayer | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.type === "frame") {
      const f = findLayer(n.children, id);
      if (f) return f;
    }
  }
  return null;
}

// Tipo de piel: el que indica el modelo, o por la forma de la capa (casi
// cuadrada = sello; ancha = botón).
function skinKindFor(l: TemplateLayer, op: EditOp): SkinKind {
  if (op.skin_kind === "button" || op.skin_kind === "badge") return op.skin_kind;
  if (op.kind === "badge") return "badge";
  if (op.kind === "button") return "button";
  return l.size.w / Math.max(1, l.size.h) < 1.6 ? "badge" : "button";
}

function exists(nodes: TemplateLayer[], id: string): boolean {
  return nodes.some((n) => n.id === id || (n.type === "frame" && exists(n.children, id)));
}

// Las imágenes pueden sangrar (hasta 2× el formato) para reencuadrar una
// foto de fondo; el resto no puede ser más grande que la pieza.
function clampBox(l: TemplateLayer, frame: { w: number; h: number }): TemplateLayer {
  const maxScale = l.type === "image" ? 2 : 1;
  const w = Math.min(Math.max(4, l.size.w), frame.w * maxScale);
  const h = Math.min(Math.max(4, l.size.h), frame.h * maxScale);
  const x = Math.min(Math.max(-w * 0.5, l.position.x), frame.w - w * 0.5);
  const y = Math.min(Math.max(-h * 0.5, l.position.y), frame.h - h * 0.5);
  return { ...l, position: { x: Math.round(x), y: Math.round(y) }, size: { w: Math.round(w), h: Math.round(h) } };
}

const PRESET_IDS = new Set<string>(TEXT_PRESETS.map((p) => p.id));
const px = (v: unknown, max: number) => (finite(v) ? Math.max(0, Math.min(max, v)) : undefined);

// Efectos de texto de una op: primero el estilo rápido, después los efectos
// sueltos encima (así "estilo sticker con contorno rojo" funciona).
function applyTextEffects(t: TextLayer, op: EditOp, opts: EditOpsOptions): TextLayer {
  let next = t;
  if (op.text_style && PRESET_IDS.has(op.text_style)) {
    const resolved = opts.resolveColor?.(t.style.color) ?? t.style.color;
    next = applyTextPreset(next, op.text_style, resolved, opts.accent);
  }
  let style = next.style;
  const stops = (op.gradient_colors ?? []).map(color).filter((c): c is string => !!c);
  if (stops.length >= 2) {
    const angle = finite(op.gradient_angle) ? Math.round(op.gradient_angle) : 180;
    style = { ...style, color: stops[0], fill: { type: "gradient", value: `linear-gradient(${angle}deg, ${stops.slice(0, 3).join(", ")})` } };
  }
  const oc = color(op.outline_color);
  const ow = px(op.outline_width, 20);
  if (oc || ow != null) {
    style = { ...style, outline: ow === 0 ? null : { color: oc ?? style.outline?.color ?? "#FFFFFF", width: ow ?? style.outline?.width ?? 2 } };
  }
  const o2c = color(op.outline2_color);
  const o2w = px(op.outline2_width, 40);
  if (o2c || o2w != null) {
    style = { ...style, outline2: o2w === 0 ? null : { color: o2c ?? style.outline2?.color ?? "#111111", width: o2w ?? style.outline2?.width ?? 2 } };
  }
  const ec = color(op.extrude_color);
  const ed = px(op.extrude_depth, 200);
  if (ec || ed != null) {
    style = {
      ...style,
      extrude: ed === 0 ? null : { color: ec ?? style.extrude?.color ?? "#000000", depth: ed ?? style.extrude?.depth ?? 4, angle: style.extrude?.angle ?? 60 },
    };
  }
  return style === next.style ? next : { ...next, style };
}

function applyStyle(l: TemplateLayer, op: EditOp, opts: EditOpsOptions = {}): TemplateLayer {
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
    next = applyTextEffects(
      { ...t, style, ...(typeof op.content === "string" ? { content: formatChileanPrices(op.content.slice(0, 500)) } : {}) },
      op,
      opts,
    );
  } else if (next.type === "image") {
    const pct = (v: number) => Math.round(Math.max(0, Math.min(100, v)));
    if (finite(op.focal_x)) next = { ...next, focalX: pct(op.focal_x) };
    if (finite(op.focal_y)) next = { ...next, focalY: pct(op.focal_y) };
    if (op.fit === "cover" || op.fit === "contain") next = { ...next, fit: op.fit };
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
  opts: EditOpsOptions = {},
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
  const placed = clampBox(applyStyle({ ...l, id: makeId(), name: layerName(op, l) }, op, opts), frame);
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

// ---------------------------------------------------------------------------
// Reencuadre de una foto para poner al sujeto en un punto de la pieza
// ---------------------------------------------------------------------------
//
// Con fit "cover" y object-position fx%, la foto (pw×ph) se escala a
// rw×rh = cubrir la caja y se desplaza (caja − render)·fx/100. El sujeto,
// en sx% de la foto, cae en: X = cajaX + (cajaW − rw)·fx/100 + sx·rw/100.
// Para un fondo (cubre la pieza) se puede además mover y agrandar la caja
// mientras siga cubriendo el formato; se busca el menor zoom que llega.
// Para una foto en caja propia solo se mueve el focal.

// Hasta 1.6×: más zoom pixela una foto de ~1.4k px en un formato de 1920.
// Si no alcanza para llevar al sujeto al punto pedido, queda lo más cerca.
const ZOOM_STEPS = Array.from({ length: 13 }, (_, i) => 1 + i * 0.05); // 1.00 .. 1.60

function solveAxis(
  frameLen: number,
  boxLen: number,
  renderLen: number,
  subjectPct: number,
  target: number,
  boxPos: number,
  canMoveBox: boolean,
): { pos: number; focal: number; err: number } {
  const subjectInRender = (subjectPct / 100) * renderLen;
  const slack = boxLen - renderLen; // ≤ 0 si la foto se recorta en este eje
  let pos = canMoveBox ? (frameLen - boxLen) / 2 : boxPos;
  let focal = slack !== 0 ? ((target - pos - subjectInRender) * 100) / slack : 50;
  focal = Math.max(0, Math.min(100, focal));
  if (canMoveBox) {
    pos = target - (slack * focal) / 100 - subjectInRender;
    pos = Math.max(frameLen - boxLen, Math.min(0, pos));
  }
  const x = pos + (slack * focal) / 100 + subjectInRender;
  return { pos, focal, err: Math.abs(x - target) };
}

export function frameSubject(
  layer: TemplateLayer,
  frame: { w: number; h: number },
  photo: { w: number; h: number } | null,
  subject: { x: number; y: number },
  targetPct: { x: number; y: number },
): TemplateLayer {
  if (layer.type !== "image") return layer;
  const sx = Math.max(0, Math.min(100, subject.x));
  const sy = Math.max(0, Math.min(100, subject.y));
  // Sin dimensiones de la foto: el focal en el sujeto es lo mejor posible.
  if (!photo || photo.w <= 0 || photo.h <= 0) {
    return { ...layer, fit: "cover", focalX: Math.round(sx), focalY: Math.round(sy) };
  }
  const background =
    layer.position.x <= 1 &&
    layer.position.y <= 1 &&
    layer.position.x + layer.size.w >= frame.w - 1 &&
    layer.position.y + layer.size.h >= frame.h - 1;
  const tx = (Math.max(0, Math.min(100, targetPct.x)) / 100) * frame.w;
  const ty = (Math.max(0, Math.min(100, targetPct.y)) / 100) * frame.h;

  const tryBox = (bw: number, bh: number, bx: number, by: number, movable: boolean) => {
    const s = Math.max(bw / photo.w, bh / photo.h);
    const ax = solveAxis(frame.w, bw, photo.w * s, sx, tx, bx, movable);
    const ay = solveAxis(frame.h, bh, photo.h * s, sy, ty, by, movable);
    return { bw, bh, ax, ay, err: ax.err / frame.w + ay.err / frame.h };
  };

  let best: ReturnType<typeof tryBox>;
  if (background) {
    best = tryBox(frame.w, frame.h, 0, 0, true);
    for (const z of ZOOM_STEPS) {
      const cand = tryBox(frame.w * z, frame.h * z, 0, 0, true);
      if (cand.err < best.err - 1e-6) best = cand;
      if (cand.err < 0.01) {
        best = cand;
        break;
      }
    }
  } else {
    best = tryBox(layer.size.w, layer.size.h, layer.position.x, layer.position.y, false);
  }
  return {
    ...layer,
    fit: "cover",
    position: { x: Math.round(best.ax.pos), y: Math.round(best.ay.pos) },
    size: { w: Math.round(best.bw), h: Math.round(best.bh) },
    focalX: Math.round(best.ax.focal),
    focalY: Math.round(best.ay.focal),
  };
}

export function applyEditOps(
  def: TemplateDefinition,
  ops: EditOp[],
  makeId: () => string = () => crypto.randomUUID(),
  // Dimensiones reales de las fotos por id de capa (para frame_subject).
  photoSizes: Record<string, { w: number; h: number }> = {},
  opts: EditOpsOptions = {},
): EditResult {
  let children = def.children;
  let background = def.background;
  const images: ImageRequest[] = [];
  const skins: SkinRequest[] = [];
  const textures: ImageRequest[] = [];
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
          l.type === "text" && typeof op.content === "string" ? { ...l, content: formatChileanPrices(op.content.slice(0, 500)) } : l,
        );
        break;
      case "update":
        children = mapLayers(children, op.id!, (l) => {
          const next = applyStyle(l, op, opts);
          return next === l ? l : clampBox(next, def.size);
        });
        if (op.texture_prompt?.trim() && findLayer(children, op.id!)?.type === "text") {
          textures.push({ layer_id: op.id!, prompt: op.texture_prompt.trim() });
        }
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
      case "frame_subject": {
        if (!finite(op.subject_x) || !finite(op.subject_y)) {
          skipped.push(`frame_subject: falta la posición del sujeto en "${op.id}"`);
          continue;
        }
        children = mapLayers(children, op.id!, (l) =>
          frameSubject(
            l,
            def.size,
            photoSizes[l.id] ?? null,
            { x: op.subject_x!, y: op.subject_y! },
            { x: finite(op.target_x) ? op.target_x : 50, y: finite(op.target_y) ? op.target_y : 50 },
          ),
        );
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
      case "set_skin": {
        const target = findLayer(children, op.id!);
        if (target?.type !== "text") {
          skipped.push(`set_skin: "${op.id}" no es un texto`);
          continue;
        }
        if (op.skin_kind === "none") {
          children = mapLayers(children, op.id!, removeSkin);
          break;
        }
        if (!op.skin_prompt?.trim()) {
          skipped.push(`set_skin: falta la descripción para "${op.id}"`);
          continue;
        }
        // Un color pedido para la piel queda como fondo de la capa: es el
        // color que se le pasa al generador.
        children = mapLayers(children, op.id!, (l) => applyStyle(l, { op: "update", background_color: op.background_color }));
        skins.push({ layer_id: op.id!, kind: skinKindFor(target, op), prompt: op.skin_prompt.trim() });
        break;
      }
      case "add": {
        const l = newLayer(op, def.size, children, makeId, opts);
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
        if (l.type === "text" && op.texture_prompt?.trim()) {
          textures.push({ layer_id: l.id, prompt: op.texture_prompt.trim() });
        }
        if (l.type === "text" && op.skin_prompt?.trim() && op.skin_kind !== "none") {
          skins.push({ layer_id: l.id, kind: skinKindFor(l, op), prompt: op.skin_prompt.trim() });
        }
        break;
      }
    }
    applied++;
  }
  return { definition: { ...def, background, children }, images, skins, textures, applied, skipped };
}
