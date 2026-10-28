// Planes de diseño sobre las plantillas de layout-templates.ts.
//
// Para crear un banner desde texto o referencia, la IA no compone el árbol:
// elige una plantilla del catálogo y devuelve un PLAN chico (textos por
// slot, capas a ocultar, mapeo de colores y fuentes, prompts para las
// imágenes). Este módulo:
//   1. describe el catálogo para el modelo (slots con su capacidad aprox.),
//   2. expande un plan a master + orientaciones con el mismo motor que usan
//      las plantillas a mano (cada aspect tiene su composición propia).
//
// Puro: corre en server (rutas de IA) y en cliente (tests, previews).

import {
  TemplateDefinition,
  TemplateLayer,
  TextLayer,
  isFontSizeRange,
} from "./types";
import { LAYOUT_TEMPLATES, LayoutTemplate, AspectKey, findLayoutTemplate } from "./layout-templates";
import { collapseShapeTextPairs } from "./composites";
import { adaptTree, aspectDiff } from "./adapt";

export interface LayoutPlan {
  template_id: string;
  // Contenido por id de capa de texto. Los ids que falten conservan el
  // placeholder de la plantilla (y el plan se marca incompleto en la UI).
  texts: { id: string; content: string }[];
  // Capas a quitar (texto, imagen, forma). Un texto que era botón/badge se
  // lleva su fondo, porque antes se fusiona el par shape+text.
  hidden: string[];
  // Recolor: color de la plantilla → color nuevo (hex o token "{color.x}").
  colors: { from: string; to: string }[];
  heading_font?: string | null;
  body_font?: string | null;
  // Prompt (en inglés, para el generador de imágenes) por slot de imagen.
  image_prompts: { id: string; prompt: string }[];
  rationale: string;
}

export interface TemplateSlot {
  id: string;
  name: string;
  placeholder: string;
  // Caracteres que caben en total y por línea (estimación, el mínimo entre
  // aspects). line_chars es el tope de una palabra: el renderer no la
  // corta bien y el auto-fit solo achica por alto.
  max_chars: number;
  line_chars: number;
}

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  texts: TemplateSlot[];
  images: { id: string; name: string; full_bleed: boolean }[];
  colors: string[];
  // Lleva el logo de la marca (slot "logo", se llena solo).
  has_logo?: boolean;
}

// Slot de imagen reservado para el logo: no se genera con IA, se llena con
// el logo de la marca al instanciar.
export const LOGO_SLOT_ID = "logo";

const ASPECTS: AspectKey[] = ["horizontal", "square", "vertical"];
// Mismo ancho de glifo que layout-lint.ts: estimación, no layout real.
const AVG_GLYPH_W = 0.55;
// Piso del auto-fit al instanciar: el texto real casi nunca mide lo mismo que
// el placeholder, así que cada texto pasa a rango [45% .. 100%] de su tamaño.
const AUTOFIT_MIN_RATIO = 0.45;
const AUTOFIT_MIN_PX = 12;

function walk(nodes: TemplateLayer[], fn: (l: TemplateLayer) => void) {
  for (const n of nodes) {
    fn(n);
    if (n.type === "frame") walk(n.children, fn);
  }
}

const normColor = (c: string) => c.trim().toLowerCase();

function templateColors(def: TemplateDefinition): string[] {
  const out = new Set<string>();
  const add = (c: string | undefined) => {
    if (c && c.startsWith("#")) out.add(normColor(c));
  };
  if (def.background?.type === "color") add(def.background.value);
  walk(def.children, (l) => {
    if (l.type === "shape") add(l.fill);
    if (l.type === "text") {
      add(l.style.color);
      add(l.style.backgroundColor);
    }
    if (l.type === "icon") add(l.color);
  });
  return [...out];
}

function slotCapacity(l: TextLayer): { total: number; perLine: number } {
  const fs = typeof l.style.fontSize === "number" ? l.style.fontSize : isFontSizeRange(l.style.fontSize) ? l.style.fontSize.max : 32;
  // Texto con fondo (botón/badge, o par shape+text) lleva padding interno.
  const w = l.style.backgroundColor ? l.size.w - fs * 0.8 : l.size.w * 0.9;
  const perLine = Math.max(1, Math.floor(w / (fs * AVG_GLYPH_W)));
  const lines = Math.max(1, Math.floor(l.size.h / (fs * (l.style.lineHeight ?? 1.2))));
  return { total: perLine * lines, perLine };
}

export function describeTemplate(t: LayoutTemplate): CatalogEntry {
  const texts = new Map<string, TemplateSlot>();
  const images = new Map<string, { id: string; name: string; full_bleed: boolean }>();
  const colors = new Set<string>();
  for (const a of ASPECTS) {
    const def = t.aspects[a];
    templateColors(def).forEach((c) => colors.add(c));
    walk(def.children, (l) => {
      if (l.type === "text") {
        const cap = slotCapacity(l);
        const prev = texts.get(l.id);
        // La capacidad que manda es la más chica entre aspects: el texto
        // tiene que caber en todas las orientaciones.
        texts.set(l.id, {
          id: l.id,
          name: prev?.name ?? l.name ?? l.id,
          placeholder: prev?.placeholder ?? l.content,
          max_chars: Math.min(prev?.max_chars ?? Infinity, cap.total),
          line_chars: Math.min(prev?.line_chars ?? Infinity, cap.perLine),
        });
      }
      if (l.type === "image" && l.id === LOGO_SLOT_ID) return;
      if (l.type === "image" && !images.has(l.id)) {
        images.set(l.id, {
          id: l.id,
          name: l.name ?? l.id,
          full_bleed: l.size.w >= def.size.w * 0.9 && l.size.h >= def.size.h * 0.9,
        });
      }
    });
  }
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    texts: [...texts.values()],
    images: [...images.values()],
    colors: [...colors],
    ...(ASPECTS.some((a) => t.aspects[a].children.some((l) => l.id === LOGO_SLOT_ID)) ? { has_logo: true } : {}),
  };
}

export function describeCatalog(): CatalogEntry[] {
  return LAYOUT_TEMPLATES.map(describeTemplate);
}

function applyToLayer(
  l: TemplateLayer,
  plan: { texts: Map<string, string>; colors: Map<string, string>; heading?: string | null; body?: string | null },
): TemplateLayer {
  const color = (c: string | undefined) =>
    c && plan.colors.has(normColor(c)) ? plan.colors.get(normColor(c))! : c;

  if (l.type === "text") {
    const content = plan.texts.get(l.id) ?? l.content;
    const weight = Number(l.style.fontWeight ?? 400);
    const font = weight >= 700 ? plan.heading : plan.body;
    const fs = l.style.fontSize;
    return {
      ...l,
      content,
      style: {
        ...l.style,
        color: color(l.style.color) ?? l.style.color,
        backgroundColor: color(l.style.backgroundColor),
        ...(font ? { fontFamily: font } : {}),
        fontSize:
          typeof fs === "number"
            ? { min: Math.min(fs, Math.max(AUTOFIT_MIN_PX, Math.round(fs * AUTOFIT_MIN_RATIO))), max: fs }
            : fs,
      },
    };
  }
  if (l.type === "shape") {
    return {
      ...l,
      fill: color(l.fill) ?? l.fill,
      stroke: l.stroke ? { ...l.stroke, color: color(l.stroke.color) ?? l.stroke.color } : l.stroke,
    };
  }
  if (l.type === "icon") return { ...l, color: color(l.color) ?? l.color };
  return l;
}

function instantiateAspect(def: TemplateDefinition, plan: LayoutPlan, logoSrc: string | null): TemplateDefinition {
  const collapsed = collapseShapeTextPairs(def).definition;
  const hidden = new Set(plan.hidden);
  // Sin logo cargado, el slot se quita (no queda un recuadro vacío).
  if (!logoSrc) hidden.add(LOGO_SLOT_ID);
  const ctx = {
    texts: new Map(plan.texts.map((t) => [t.id, t.content])),
    colors: new Map(plan.colors.map((c) => [normColor(c.from), c.to])),
    heading: plan.heading_font,
    body: plan.body_font,
  };
  const mapChildren = (nodes: TemplateLayer[]): TemplateLayer[] =>
    nodes
      .filter((n) => !hidden.has(n.id))
      .map((n) => {
        const next =
          n.type === "image" && n.id === LOGO_SLOT_ID && logoSrc ? { ...n, src: logoSrc } : applyToLayer(n, ctx);
        return next.type === "frame" ? { ...next, children: mapChildren(next.children) } : next;
      });
  const bg = collapsed.background;
  const bgColor = bg?.type === "color" ? ctx.colors.get(normColor(bg.value)) : undefined;
  return {
    ...collapsed,
    background: bgColor ? { type: "color", value: bgColor } : collapsed.background,
    children: mapChildren(collapsed.children),
  };
}

// Aspect de la plantilla más parecido a unas dims. Si las dims no son las
// canónicas, se adapta con el motor (adaptTree) desde ese aspect.
function aspectFor(t: LayoutTemplate, dims: { w: number; h: number }): AspectKey {
  let best: AspectKey = "horizontal";
  let bestDiff = Infinity;
  for (const a of ASPECTS) {
    const s = t.aspects[a].size;
    const d = aspectDiff(s.w, s.h, dims.w, dims.h);
    if (d < bestDiff) {
      best = a;
      bestDiff = d;
    }
  }
  return best;
}

export interface ExpandedPlan {
  definition: TemplateDefinition;
  variants: { dims: { w: number; h: number }; definition: TemplateDefinition }[];
}

export function expandPlan(
  plan: LayoutPlan,
  masterDims: { w: number; h: number },
  variantDims: { w: number; h: number }[],
  // Logo de la marca (token {logo.x} o URL) para el slot "logo".
  logoSrc: string | null = null,
): ExpandedPlan | null {
  const t = findLayoutTemplate(plan.template_id);
  if (!t) return null;
  const build = (dims: { w: number; h: number }) => {
    const def = instantiateAspect(t.aspects[aspectFor(t, dims)], plan, logoSrc);
    return def.size.w === dims.w && def.size.h === dims.h ? def : adaptTree(def, dims);
  };
  return {
    definition: build(masterDims),
    variants: variantDims.map((dims) => ({ dims, definition: build(dims) })),
  };
}

// Normaliza la respuesta cruda del modelo. Descarta planes con plantilla
// inexistente; filtra ids que no son de esa plantilla.
// Precios en formato chileno: "UF21776" → "UF 21.776", "$9990" → "$9.990".
// El modelo a veces los comprime para que quepan en la línea; el auto-fit
// del texto ya se encarga del espacio. Montos con decimales o ya
// formateados no se tocan.
export function formatChileanPrices(text: string): string {
  const thousands = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return text
    .replace(/\bUF\s*(\d{4,})(?![\d.,])/gi, (_, d: string) => `UF ${thousands(d)}`)
    .replace(/\$\s*(\d{4,})(?![\d.,])/g, (_, d: string) => `$${thousands(d)}`);
}

export function sanitizePlan(raw: unknown): LayoutPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const t = typeof p.template_id === "string" ? findLayoutTemplate(p.template_id) : null;
  if (!t) return null;
  const entry = describeTemplate(t);
  const textIds = new Set(entry.texts.map((s) => s.id));
  const imageIds = new Set(entry.images.map((s) => s.id));
  const allIds = new Set<string>();
  for (const a of ASPECTS) walk(t.aspects[a].children, (l) => allIds.add(l.id));

  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    template_id: t.id,
    texts: arr(p.texts)
      .map((x) => ({
        id: str((x as { id?: unknown }).id),
        content: formatChileanPrices(str((x as { content?: unknown }).content).trim()),
      }))
      .filter((x) => textIds.has(x.id) && x.content.length > 0),
    hidden: arr(p.hidden).map(str).filter((id) => allIds.has(id)),
    colors: arr(p.colors)
      .map((x) => ({ from: str((x as { from?: unknown }).from), to: str((x as { to?: unknown }).to).trim() }))
      .filter((x) => x.from && x.to && (/^#[0-9a-f]{3,8}$/i.test(x.to) || /^\{color\.[\w-]+\}$/.test(x.to))),
    heading_font: str(p.heading_font) || null,
    body_font: str(p.body_font) || null,
    image_prompts: arr(p.image_prompts)
      .map((x) => ({ id: str((x as { id?: unknown }).id), prompt: str((x as { prompt?: unknown }).prompt).trim() }))
      .filter((x) => imageIds.has(x.id) && x.prompt.length > 0),
    rationale: str(p.rationale),
  };
}

// ---------------------------------------------------------------------------
// Imágenes generadas para los slots de una propuesta
// ---------------------------------------------------------------------------

// Proporciones que acepta el generador (Imagen 4).
export const IMAGE_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
export type ImageRatio = (typeof IMAGE_RATIOS)[number];

export function nearestImageRatio(w: number, h: number): ImageRatio {
  const r = w / h;
  let best: ImageRatio = "1:1";
  let bestDiff = Infinity;
  for (const ratio of IMAGE_RATIOS) {
    const [a, b] = ratio.split(":").map(Number);
    const d = Math.abs(Math.log(r / (a / b)));
    if (d < bestDiff) {
      best = ratio;
      bestDiff = d;
    }
  }
  return best;
}

export interface ImageJob {
  slot_id: string;
  ratio: ImageRatio;
  prompt: string;
}

// Qué imágenes hay que generar: una por slot y por proporción distinta que
// necesiten las orientaciones (un fondo full-bleed 16:9 y su versión 9:16
// son dos imágenes; recortar una sola dejaría el vertical sin sujeto).
// Solo slots vacíos (src null) con prompt en el plan.
export function imageJobsFor(
  defs: TemplateDefinition[],
  prompts: { id: string; prompt: string }[],
): ImageJob[] {
  const byId = new Map(prompts.map((p) => [p.id, p.prompt]));
  const seen = new Set<string>();
  const jobs: ImageJob[] = [];
  for (const def of defs) {
    walk(def.children, (l) => {
      if (l.type !== "image" || l.src != null || l.visible === false) return;
      const prompt = byId.get(l.id);
      if (!prompt) return;
      const ratio = nearestImageRatio(l.size.w, l.size.h);
      const key = `${l.id}|${ratio}`;
      if (seen.has(key)) return;
      seen.add(key);
      jobs.push({ slot_id: l.id, ratio, prompt });
    });
  }
  return jobs;
}

// Pone en cada slot la imagen generada de su proporción.
export function applyGeneratedImages(
  def: TemplateDefinition,
  images: { slot_id: string; ratio: ImageRatio; url: string }[],
): TemplateDefinition {
  const byKey = new Map(images.map((i) => [`${i.slot_id}|${i.ratio}`, i.url]));
  const map = (nodes: TemplateLayer[]): TemplateLayer[] =>
    nodes.map((l) => {
      if (l.type === "frame") return { ...l, children: map(l.children) };
      if (l.type !== "image" || l.src != null) return l;
      const url = byKey.get(`${l.id}|${nearestImageRatio(l.size.w, l.size.h)}`);
      return url ? { ...l, src: url, fit: l.fit ?? "cover" } : l;
    });
  return { ...def, children: map(def.children) };
}

// ---------------------------------------------------------------------------
// Contraste mínimo tras el recolor
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number | null {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return null;
  const la = luminance(ra);
  const lb = luminance(rb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// WCAG AA para texto grande: los textos de banner casi siempre lo son.
const MIN_CONTRAST = 3;

// El recolor del plan puede dejar texto sobre un fondo del mismo tono (ej.
// precio gris sobre la nueva pastilla azul). Para cada texto con fondo
// propio, o apoyado directo sobre el fondo del root, si el contraste no
// alcanza se pasa a blanco o negro (el que contraste más). `resolve` traduce
// tokens de marca a hex; un color que no resuelve a hex se deja como está.
export function ensureTextContrast(
  def: TemplateDefinition,
  resolve: (color: string) => string,
): TemplateDefinition {
  const rootBg = def.background?.type === "color" ? resolve(def.background.value) : null;
  const hasImageBehind = (t: TemplateLayer, siblings: TemplateLayer[]) =>
    siblings.some(
      (s) =>
        s !== t &&
        (s.type === "image" || s.type === "shape") &&
        s.visible !== false &&
        s.position.x < t.position.x + t.size.w &&
        t.position.x < s.position.x + s.size.w &&
        s.position.y < t.position.y + t.size.h &&
        t.position.y < s.position.y + s.size.h,
    );
  const fix = (nodes: TemplateLayer[], topLevel: boolean): TemplateLayer[] =>
    nodes.map((l) => {
      if (l.type === "frame") return { ...l, children: fix(l.children, false) };
      if (l.type !== "text") return l;
      const bg = l.style.backgroundColor
        ? resolve(l.style.backgroundColor)
        : topLevel && rootBg && !hasImageBehind(l, nodes)
          ? rootBg
          : null;
      if (!bg) return l;
      const fg = resolve(l.style.color);
      const ratio = contrastRatio(fg, bg);
      if (ratio == null || ratio >= MIN_CONTRAST) return l;
      const white = contrastRatio("#ffffff", bg) ?? 0;
      const black = contrastRatio("#111111", bg) ?? 0;
      return { ...l, style: { ...l.style, color: white >= black ? "#FFFFFF" : "#111111" } };
    });
  return { ...def, children: fix(def.children, true) };
}
