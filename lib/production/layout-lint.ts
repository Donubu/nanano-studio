// Chequeo determinista de calidad de una adaptación. Corre sobre el árbol ya
// adaptado (adaptTree / manual_layout) con los tokens de marca resueltos y
// detecta lo que un productor marcaría a ojo: piezas que se salen del
// formato, textos que no caben o se pisan, tipografía ilegible.
//
// Sirve para dos cosas:
//   1. Elegir qué formatos de un paquete vale la pena mandar a la IA (los
//      que no tienen errores se quedan con el resultado del motor, gratis).
//   2. Verificar la corrección de la IA: se vuelve a correr sobre el árbol
//      parcheado y, si quedan errores, se pide una segunda pasada.
//
// Solo mira las capas de primer nivel del root en layout libre (las de un
// root en stack las ubica el flex, no sus coordenadas). La tipografía se
// revisa en todo el árbol. Las medidas de texto son estimaciones (ancho
// promedio de glifo), no un layout real del navegador: suficiente para
// detectar desbordes evidentes, no para medir al píxel.

import {
  TemplateDefinition,
  TemplateLayer,
  TextLayer,
  isFontSizeRange,
} from "./types";
import { insetFrameRatio, inferRoles, type LayerRole } from "./layer-roles";
import { hasSafeZone, type SafeZone } from "./safe-zone";

export type LintIssueKind =
  | "background_gap"
  | "empty_band"
  | "text_undersized"
  | "out_of_bounds"
  | "outside_safe_area"
  | "overlap"
  | "text_overflow"
  | "text_too_small"
  // Chequeo de marca (brand-lint.ts): no los corrige el modelo.
  | "brand_logo_size"
  | "brand_logo_space"
  | "brand_missing_legal"
  | "brand_forbidden_text"
  | "brand_name_case";

export interface LintIssue {
  kind: LintIssueKind;
  severity: "error" | "warning";
  layerIds: string[];
  // Frase corta en español para la UI y para el prompt del modelo.
  detail: string;
}

// Mismo criterio que adapt.ts: una capa que cubre ≥90% de un eje es fondo.
const BACKGROUND_COVER = 0.9;
// Margen de seguridad: 3% del lado corto, igual que el ajuste de adaptTree.
const SAFE_MARGIN_RATIO = 0.03;
// Fracción de la capa que puede quedar fuera del formato sin marcar error
// (sombras, redondeos, decoraciones que sangran a propósito).
const OUT_OF_BOUNDS_TOLERANCE = 0.03;
// Fracción del área de la capa más chica a partir de la cual dos capas se
// pisan. Por debajo es un roce que no se nota.
const OVERLAP_RATIO = 0.12;
// Si una capa contiene ≥95% de la otra es un patrón intencional (tarjeta con
// texto encima, foto con titular sobreimpreso), no un choque.
const CONTAINS_RATIO = 0.95;
// Ancho promedio de un glifo en múltiplos del font-size. 0.55 es razonable
// para sans-serif de banners (Inter, Montserrat, Roboto) en mixed case.
const AVG_GLYPH_W = 0.55;
const UPPERCASE_GLYPH_W = 0.66;
// Bajo estos tamaños el texto deja de leerse en display. MIN_FONT_ERROR es
// el piso duro de adaptTree; MIN_FONT_WARNING es "se lee con esfuerzo".
const MIN_FONT_ERROR = 8;
const MIN_FONT_WARNING = 10;
// Holgura antes de declarar desborde: la estimación es gruesa.
const TEXT_OVERFLOW_SLACK = 1.15;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function safeMargin(size: { w: number; h: number }): number {
  return Math.max(2, Math.round(Math.min(size.w, size.h) * SAFE_MARGIN_RATIO));
}

// Márgenes por lado: el mínimo del 3% y, si la plataforma tapa más (zona
// segura de stories, TikTok…), eso.
export function safeInsets(size: { w: number; h: number }, zone?: SafeZone | null): SafeZone {
  const m = safeMargin(size);
  return {
    top: Math.max(m, zone?.top ?? 0),
    right: Math.max(m, zone?.right ?? 0),
    bottom: Math.max(m, zone?.bottom ?? 0),
    left: Math.max(m, zone?.left ?? 0),
  };
}

export interface LintOptions {
  // Zona segura de la plataforma (safe-zone.ts). Sin ella, solo el 3%.
  safe?: SafeZone | null;
}

export function isVisibleLayer(l: TemplateLayer): boolean {
  return l.visible !== false && (l.opacity ?? 1) > 0.02;
}

export function isBackgroundLayer(l: TemplateLayer, frame: { w: number; h: number }): boolean {
  if (l.type === "text" || l.type === "icon") return false;
  return l.size.w >= frame.w * BACKGROUND_COVER && l.size.h >= frame.h * BACKGROUND_COVER;
}

function boxOf(l: TemplateLayer): Box {
  return { x: l.position.x, y: l.position.y, w: l.size.w, h: l.size.h };
}

function area(b: Box): number {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

function intersection(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function label(l: TemplateLayer): string {
  if (l.type === "text") {
    const t = l.content.replace(/\s+/g, " ").trim();
    return `"${t.length > 28 ? `${t.slice(0, 27)}…` : t}"`;
  }
  return l.name ? `${l.type} "${l.name}"` : l.type;
}

// Tamaño efectivo para medir. Con rango (smart text) el renderer elige el
// mayor tamaño del rango con el que el texto cabe en la caja; lo estimamos
// igual, bajando de a 1px desde el máximo. Si no cabe ni en el mínimo,
// queda en el mínimo (y el chequeo de desborde lo marca).
export function effectiveFontSize(layer: TextLayer): number | null {
  const fs = layer.style.fontSize;
  if (typeof fs === "number") return fs;
  if (!isFontSizeRange(fs)) return null; // token sin resolver: no podemos medir
  for (let size = Math.floor(fs.max); size > fs.min; size--) {
    if (!textOverflows(layer, size)) return size;
  }
  return fs.min;
}

function textMetrics(l: TextLayer, fs: number) {
  // Botones/badges (texto con fondo) llevan padding interno implícito.
  const padX = l.style.backgroundColor ? fs * 0.8 : 0;
  const { lines, wordTooLong } = estimateTextLines(l.content, l.size.w - padX, fs, {
    uppercase: l.style.textTransform === "uppercase",
    letterSpacing: l.style.letterSpacing,
  });
  const neededH = lines * fs * (l.style.lineHeight ?? 1.2);
  return { lines, wordTooLong, neededH };
}

function textOverflows(l: TextLayer, fs: number): boolean {
  const m = textMetrics(l, fs);
  return m.wordTooLong || m.neededH > l.size.h * TEXT_OVERFLOW_SLACK;
}

// Cuántas líneas ocupa el texto en un ancho dado, con word-wrap simple.
// Una palabra más ancha que la caja cuenta como desborde (devuelve
// `wordTooLong`), porque el renderer la corta o la deja salir.
export function estimateTextLines(
  content: string,
  boxW: number,
  fontSize: number,
  opts: { uppercase?: boolean; letterSpacing?: number } = {},
): { lines: number; wordTooLong: boolean } {
  const glyph =
    fontSize * (opts.uppercase ? UPPERCASE_GLYPH_W : AVG_GLYPH_W) + (opts.letterSpacing ?? 0);
  if (glyph <= 0 || boxW <= 0) return { lines: 1, wordTooLong: false };
  const maxChars = Math.max(1, Math.floor(boxW / glyph));
  let lines = 0;
  let wordTooLong = false;
  for (const paragraph of content.split(/\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines += 1;
      continue;
    }
    let current = 0;
    lines += 1;
    for (const word of words) {
      if (word.length > maxChars) wordTooLong = true;
      const needed = current === 0 ? word.length : current + 1 + word.length;
      if (needed <= maxChars) {
        current = needed;
      } else {
        lines += 1;
        current = Math.min(word.length, maxChars);
      }
    }
  }
  return { lines, wordTooLong };
}

function lintText(l: TextLayer, issues: LintIssue[]) {
  const fs = effectiveFontSize(l);
  if (fs == null || !l.content.trim()) return;

  if (fs < MIN_FONT_ERROR) {
    issues.push({
      kind: "text_too_small",
      severity: "error",
      layerIds: [l.id],
      detail: `${label(l)} queda en ${Math.round(fs)}px: ilegible`,
    });
  } else if (fs < MIN_FONT_WARNING) {
    issues.push({
      kind: "text_too_small",
      severity: "warning",
      layerIds: [l.id],
      detail: `${label(l)} queda en ${Math.round(fs)}px: se lee con esfuerzo`,
    });
  }

  const { lines, wordTooLong, neededH } = textMetrics(l, fs);
  if (wordTooLong || neededH > l.size.h * TEXT_OVERFLOW_SLACK) {
    issues.push({
      kind: "text_overflow",
      severity: "error",
      layerIds: [l.id],
      detail: wordTooLong
        ? `${label(l)} tiene una palabra más ancha que su caja`
        : `${label(l)} no cabe: necesita ~${lines} línea${lines === 1 ? "" : "s"} (${Math.round(neededH)}px) en una caja de ${Math.round(l.size.h)}px`,
    });
  }
}

function walkTexts(nodes: TemplateLayer[], issues: LintIssue[]) {
  for (const n of nodes) {
    if (!isVisibleLayer(n)) continue;
    if (n.type === "text") lintText(n, issues);
    else if (n.type === "frame") walkTexts(n.children, issues);
  }
}

// `def` debe venir con tokens resueltos (resolveTreeTokens): con un token
// en fontSize no hay número que medir y la capa se salta.
export function lintLayout(def: TemplateDefinition, opts: LintOptions = {}): LintIssue[] {
  const issues: LintIssue[] = [];
  const frame = def.size;
  walkTexts(def.children, issues);
  if (def.layout.mode === "stack") return issues;

  const margin = safeMargin(frame);
  const insets = safeInsets(frame, opts.safe);
  const platformZone = hasSafeZone(opts.safe);
  const frameBox: Box = { x: 0, y: 0, w: frame.w, h: frame.h };

  // Fondo que casi cubre pero deja bandas (típico de una foto achicada para
  // "caber"): se ve el color de fondo de la pieza en los bordes.
  for (const l of def.children) {
    if (!isVisibleLayer(l) || (l.type !== "image" && l.type !== "shape")) continue;
    const b = boxOf(l);
    const covered = intersection(b, frameBox) / (frame.w * frame.h);
    const nearlyBg = b.w >= frame.w * 0.75 && b.h >= frame.h * 0.75;
    // Un marco simétrico es diseño, no una banda.
    // Un marco chico (≤12% del lado corto en cada borde, aunque sea
    // asimétrico por un cintillo) es diseño, no una banda.
    const gaps = [b.x, b.y, frame.w - (b.x + b.w), frame.h - (b.y + b.h)];
    const framed = gaps.every((g) => g >= -1 && g <= Math.min(frame.w, frame.h) * 0.12);
    if (nearlyBg && covered < 0.995 && insetFrameRatio(l, frame) == null && !framed) {
      issues.push({
        kind: "background_gap",
        severity: "error",
        layerIds: [l.id],
        detail: `${label(l)} no cubre todo el formato: quedan bandas en los bordes`,
      });
    }
  }
  const foreground = def.children.filter(
    (l) => isVisibleLayer(l) && !isBackgroundLayer(l, frame),
  );

  for (const l of foreground) {
    const b = boxOf(l);
    const a = area(b);
    if (a <= 0) continue;
    const inside = intersection(b, frameBox) / a;
    if (inside < 1 - OUT_OF_BOUNDS_TOLERANCE) {
      issues.push({
        kind: "out_of_bounds",
        severity: l.type === "shape" ? "warning" : "error",
        layerIds: [l.id],
        detail: `${label(l)} se sale del formato (${Math.round((1 - inside) * 100)}% fuera)`,
      });
      continue;
    }
    if (l.type === "shape") continue; // decoración: puede ir al borde
    const crossesMargin =
      b.x < insets.left - 1 ||
      b.y < insets.top - 1 ||
      b.x + b.w > frame.w - insets.right + 1 ||
      b.y + b.h > frame.h - insets.bottom + 1;
    if (crossesMargin) {
      issues.push({
        kind: "outside_safe_area",
        severity: "warning",
        layerIds: [l.id],
        detail: platformZone
          ? `${label(l)} invade la zona que tapa la plataforma (arriba ${insets.top}px, abajo ${insets.bottom}px, izq ${insets.left}px, der ${insets.right}px)`
          : `${label(l)} invade el margen de seguridad (${margin}px)`,
      });
    }
  }

  // Choques: al menos una de las dos capas es texto o ícono (dos formas o
  // dos imágenes encimadas suelen ser composición intencional).
  for (let i = 0; i < foreground.length; i++) {
    for (let j = i + 1; j < foreground.length; j++) {
      const p = foreground[i];
      const q = foreground[j];
      const pText = p.type === "text" || p.type === "icon";
      const qText = q.type === "text" || q.type === "icon";
      if (!pText && !qText) continue;
      const bp = boxOf(p);
      const bq = boxOf(q);
      const inter = intersection(bp, bq);
      if (inter <= 0) continue;
      const ap = area(bp);
      const aq = area(bq);
      const smaller = Math.min(ap, aq);
      if (smaller <= 0 || inter / smaller < OVERLAP_RATIO) continue;
      // Contenedor intencional: forma/imagen que envuelve a la otra capa.
      const container = ap >= aq ? p : q;
      if (inter / smaller >= CONTAINS_RATIO && container.type !== "text" && container.type !== "icon") {
        continue;
      }
      issues.push({
        kind: "overlap",
        severity: pText && qText ? "error" : "warning",
        layerIds: [p.id, q.id],
        detail: `${label(p)} y ${label(q)} se pisan`,
      });
    }
  }
  return issues;
}

export function hasLintErrors(issues: LintIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}


// ---------------------------------------------------------------------------
// Aprovechamiento del formato (solo al recomponer una orientación o una pieza
// completa; en los formatos de salida chicos estas reglas no aplican)
// ---------------------------------------------------------------------------
//
// Al pasar de un cuadrado a un vertical la recomposición tiende a dejar los
// textos en su tamaño y el espacio extra vacío. Estas reglas le dicen, con
// números, qué agrandar y dónde sobra.

// Letra mínima por rol, como fracción del lado corto del formato.
const MIN_FONT_RATIO: Partial<Record<LayerRole, number>> = {
  headline: 0.06,
  price: 0.05,
  cta: 0.032,
  badge: 0.03,
  secondary: 0.026,
  legal: 0.014,
};
const ROLE_LABEL: Partial<Record<LayerRole, string>> = {
  headline: "el titular",
  price: "el precio",
  cta: "el CTA",
  badge: "el badge",
  secondary: "la bajada",
  legal: "el legal",
};
// Franja vacía máxima sobre el eje largo, como fracción de ese eje.
const MAX_EMPTY_BAND = 0.15;

export function lintComposition(def: TemplateDefinition, opts: LintOptions = {}): LintIssue[] {
  const issues: LintIssue[] = [];
  const frame = def.size;
  if (def.layout.mode === "stack") return issues;
  const insets = safeInsets(frame, opts.safe);
  const short = Math.min(frame.w, frame.h);
  const roles = inferRoles(def);
  const visible = def.children.filter(isVisibleLayer);

  for (const l of visible) {
    if (l.type !== "text") continue;
    const role = roles.get(l.id);
    const ratio = role ? MIN_FONT_RATIO[role] : undefined;
    const fs = effectiveFontSize(l);
    if (!ratio || fs == null) continue;
    const min = Math.round(short * ratio);
    if (fs < min * 0.9) {
      issues.push({
        kind: "text_undersized",
        severity: "error",
        layerIds: [l.id],
        detail: `${ROLE_LABEL[role!]} ("${l.content.slice(0, 30)}") queda en ${Math.round(fs)}px; en este formato debería tener al menos ${min}px: agranda la letra y su caja`,
      });
    }
  }

  // Franjas vacías sobre el eje largo (entre bloques y contra los bordes,
  // descontando el margen de seguridad). Los fondos no cuentan como contenido.
  const vertical = frame.h >= frame.w;
  const axis = vertical ? frame.h : frame.w;
  const start = vertical ? insets.top : insets.left;
  const end = axis - (vertical ? insets.bottom : insets.right);
  const spans = visible
    .filter((l) => !isBackgroundLayer(l, frame) && !(l.type === "shape" && l.size.w * l.size.h > frame.w * frame.h * 0.6))
    .map((l) => (vertical ? [l.position.y, l.position.y + l.size.h] : [l.position.x, l.position.x + l.size.w]))
    .map(([a, b]) => [Math.max(start, a), Math.min(end, b)])
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0]);
  let cursor = start;
  const bands: [number, number][] = [];
  for (const [a, b] of spans) {
    if (a > cursor) bands.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (end > cursor) bands.push([cursor, end]);
  for (const [a, b] of bands) {
    if (b - a > axis * MAX_EMPTY_BAND) {
      issues.push({
        kind: "empty_band",
        severity: "error",
        layerIds: [],
        detail: `franja vacía de ${Math.round(b - a)}px (${vertical ? "y" : "x"} ${Math.round(a)}–${Math.round(b)}): agranda la imagen o los bloques vecinos, o redistribúyelos para llenarla`,
      });
    }
  }
  return issues;
}
