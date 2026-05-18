// Brand kit: design tokens scoped to a client (and optionally to one production
// project, for project-specific overrides created from the editor).
//
// Token references in a template's definition_json use a {kind.name} syntax:
//   color:    "{color.primary}"
//   font:     "{font.display}"     (resolves to a fontFamily string)
//   scale:    "{scale.lg}"          (resolves to a fontSize number)
//   spacing:  "{spacing.md}"        (resolves to a padding/gap number)
//   logo:     "{logo.primary}"      (resolves to an image URL)
//
// Anything that doesn't match the {kind.name} pattern is treated as a literal
// value (e.g. "#1a73e8", "Inter", 48).

import { TemplateLayer, TemplateDefinition, FrameLayer, TextLayer, ImageLayer } from "./types";

// ---------- Token shapes ----------

export interface ColorToken {
  name: string;
  label: string;
  value: string; // CSS color
}

export interface FontToken {
  name: string;
  label: string;
  fontFamily: string;
  fontWeight?: number; // default weight when not overridden
}

export interface ScaleToken {
  name: string;
  label: string;
  fontSize: number;
}

export interface SpacingToken {
  name: string;
  label: string;
  value: number; // px
}

export interface LogoToken {
  name: string;
  label: string;
  src: string; // image URL
}

export interface BrandKitContent {
  colors: ColorToken[];
  fonts: FontToken[];
  scales: ScaleToken[];
  spacing: SpacingToken[];
  logos: LogoToken[];
  rulesText?: string;
}

export interface BrandKit {
  id: number;
  client_id: number;
  production_project_id: number | null;
  name: string;
  is_default: boolean;
  // null cuando está activo. Cuando soft-deleted lleva el timestamp (ISO o
  // Date dependiendo del transporte). En UI sirve para mostrar el badge
  // "Eliminado" y el botón de reactivar.
  deleted_at: string | null;
  content: BrandKitContent;
}

export const EMPTY_KIT_CONTENT: BrandKitContent = {
  colors: [],
  fonts: [],
  scales: [],
  spacing: [],
  logos: [],
};

// ---------- Parsing of API rows ----------

interface ApiBrandKitRow {
  id: number;
  client_id: number;
  production_project_id: number | null;
  name: string;
  colors_json: unknown;
  typography_json: unknown;
  logos_json: unknown;
  spacing_json: unknown;
  rules_text: string | null;
  is_default: number | boolean;
  deleted_at?: string | Date | null;
}

function parseJsonField(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v;
}

function asArray<T>(v: unknown, key?: string): T[] {
  const parsed = parseJsonField(v);
  if (Array.isArray(parsed)) return parsed as T[];
  if (parsed && typeof parsed === "object" && key && Array.isArray((parsed as Record<string, unknown>)[key])) {
    return (parsed as Record<string, unknown>)[key] as T[];
  }
  return [];
}

export function brandKitFromApi(row: ApiBrandKitRow): BrandKit {
  // Columns are stored as JSON. We accept either a bare array or { tokens: [...] }
  // / { fonts: [...], scales: [...] } / { logos: [...] } shapes.
  const typography = parseJsonField(row.typography_json) as { fonts?: FontToken[]; scales?: ScaleToken[] } | null;
  return {
    id: row.id,
    client_id: row.client_id,
    production_project_id: row.production_project_id,
    name: row.name,
    is_default: !!row.is_default,
    deleted_at:
      row.deleted_at == null
        ? null
        : typeof row.deleted_at === "string"
          ? row.deleted_at
          : row.deleted_at.toISOString(),
    content: {
      colors: asArray<ColorToken>(row.colors_json, "tokens"),
      fonts: typography?.fonts ?? [],
      scales: typography?.scales ?? [],
      spacing: asArray<SpacingToken>(row.spacing_json, "tokens"),
      logos: asArray<LogoToken>(row.logos_json, "logos"),
      rulesText: row.rules_text ?? undefined,
    },
  };
}

// Serialize back to the JSON columns we store.
export function brandKitToApi(content: BrandKitContent): {
  colors_json: unknown;
  typography_json: unknown;
  logos_json: unknown;
  spacing_json: unknown;
  rules_text: string | null;
} {
  return {
    colors_json: { tokens: content.colors },
    typography_json: { fonts: content.fonts, scales: content.scales },
    logos_json: { logos: content.logos },
    spacing_json: { tokens: content.spacing },
    rules_text: content.rulesText ?? null,
  };
}

// ---------- Merging multiple kits ----------

// Merge several kits in order of increasing precedence (later overrides earlier).
// Typical use: [clientWide, projectSpecific] so project tokens override.
export function mergeKits(...kits: BrandKit[]): BrandKitContent {
  const out: BrandKitContent = {
    colors: [],
    fonts: [],
    scales: [],
    spacing: [],
    logos: [],
  };
  const mergeArr = <T extends { name: string }>(target: T[], source: T[]) => {
    for (const s of source) {
      const idx = target.findIndex((t) => t.name === s.name);
      if (idx >= 0) target[idx] = s;
      else target.push(s);
    }
  };
  for (const k of kits) {
    mergeArr(out.colors, k.content.colors);
    mergeArr(out.fonts, k.content.fonts);
    mergeArr(out.scales, k.content.scales);
    mergeArr(out.spacing, k.content.spacing);
    mergeArr(out.logos, k.content.logos);
  }
  return out;
}

// ---------- Token reference parsing ----------

const REF_RE = /^\{(color|font|scale|spacing|logo)\.([a-zA-Z0-9_-]+)\}$/;

export function parseRef(value: unknown): { kind: string; name: string } | null {
  if (typeof value !== "string") return null;
  const m = value.match(REF_RE);
  return m ? { kind: m[1], name: m[2] } : null;
}

export function isTokenRef(value: unknown): boolean {
  return parseRef(value) !== null;
}

export function makeRef(kind: "color" | "font" | "scale" | "spacing" | "logo", name: string): string {
  return `{${kind}.${name}}`;
}

// ---------- Resolution ----------

// Sustitución global de {color.X} dentro de cualquier string. La usamos para
// strings que pueden contener varios token refs embebidos — típicamente
// gradientes CSS como "linear-gradient(45deg, {color.primary}, {color.bg})".
const EMBEDDED_COLOR_REF = /\{color\.([a-zA-Z0-9_-]+)\}/g;

export function resolveColor(value: string | undefined, kit: BrandKitContent, fallback = "#000000"): string {
  if (!value) return fallback;
  const ref = parseRef(value);
  if (ref && ref.kind === "color") {
    const t = kit.colors.find((c) => c.name === ref.name);
    return t ? t.value : fallback;
  }
  // String compuesto (gradiente, rgba con var, etc.). Sustituimos cada
  // {color.X} embebido por su valor resuelto. Si el token no existe, lo
  // dejamos literal — el navegador lo ignorará silenciosamente, pero al
  // menos no rompe los tokens que sí existen.
  if (value.includes("{color.")) {
    return value.replace(EMBEDDED_COLOR_REF, (full, name) => {
      const t = kit.colors.find((c) => c.name === name);
      return t ? t.value : full;
    });
  }
  return value;
}

export function resolveFontFamily(value: string | undefined, kit: BrandKitContent, fallback = "inherit"): string {
  if (!value) return fallback;
  const ref = parseRef(value);
  if (!ref || ref.kind !== "font") return value;
  const t = kit.fonts.find((f) => f.name === ref.name);
  return t ? t.fontFamily : fallback;
}

export function resolveFontWeight(value: number | string | undefined, kit: BrandKitContent, fallback = 400): number | string {
  if (value == null) return fallback;
  if (typeof value === "number") return value;
  const ref = parseRef(value);
  if (!ref || ref.kind !== "font") return value;
  const t = kit.fonts.find((f) => f.name === ref.name);
  return t?.fontWeight ?? fallback;
}

export function resolveSize(value: number | string | undefined, kit: BrandKitContent, fallback = 16): number {
  if (value == null) return fallback;
  if (typeof value === "number") return value;
  const ref = parseRef(value);
  if (!ref) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  if (ref.kind === "scale") {
    const t = kit.scales.find((s) => s.name === ref.name);
    return t ? t.fontSize : fallback;
  }
  if (ref.kind === "spacing") {
    const t = kit.spacing.find((s) => s.name === ref.name);
    return t ? t.value : fallback;
  }
  return fallback;
}

export function resolveLogoSrc(value: string | null | undefined, kit: BrandKitContent): string | null {
  if (!value) return null;
  const ref = parseRef(value);
  if (!ref || ref.kind !== "logo") return value;
  const t = kit.logos.find((l) => l.name === ref.name);
  return t ? t.src : null;
}

// ---------- Tree resolution (renderer convenience) ----------

// Returns a fresh tree where every token-reference value has been replaced by
// the resolved literal. Used by the renderer so the canvas DOM gets real CSS
// values. The master JSON is never mutated.
export function resolveTreeTokens(
  root: TemplateDefinition,
  kit: BrandKitContent
): TemplateDefinition {
  return resolveLayer(root, kit) as TemplateDefinition;
}

// Sombra: el color puede ser token ref. Resuelvo siempre antes de despachar
// al specializer de cada tipo, así no hay que repetirlo en cada uno.
function resolveBaseShadow<T extends TemplateLayer>(layer: T, kit: BrandKitContent): T {
  if (!layer.shadow) return layer;
  return {
    ...layer,
    shadow: { ...layer.shadow, color: resolveColor(layer.shadow.color, kit, "rgba(0,0,0,0.25)") },
  };
}

function resolveLayer(layer: TemplateLayer, kit: BrandKitContent): TemplateLayer {
  const base = resolveBaseShadow(layer, kit);
  switch (base.type) {
    case "frame":
      return resolveFrame(base, kit);
    case "text":
      return resolveText(base, kit);
    case "image":
      return resolveImage(base, kit);
    case "shape":
      return {
        ...base,
        fill: resolveColor(base.fill, kit, "#cccccc"),
        stroke: base.stroke
          ? { ...base.stroke, color: resolveColor(base.stroke.color, kit, "#000000") }
          : base.stroke,
      };
  }
}

function resolveFrame(layer: FrameLayer, kit: BrandKitContent): FrameLayer {
  const bg = layer.background;
  const resolvedBg =
    bg && bg.type === "color"
      ? { type: "color" as const, value: resolveColor(bg.value, kit, "#ffffff") }
      : bg;
  const resolvedLayout =
    layer.layout.mode === "stack"
      ? {
          ...layer.layout,
          // padding entries may be number | string (token ref)
          padding: layer.layout.padding.map((p) => resolveSize(p as number | string, kit, 0)) as [
            number,
            number,
            number,
            number
          ],
          gap: resolveSize(layer.layout.gap as number | string, kit, 0),
        }
      : layer.layout;
  return {
    ...layer,
    background: resolvedBg,
    layout: resolvedLayout,
    children: layer.children.map((c) => resolveLayer(c, kit)),
  };
}

function resolveText(layer: TextLayer, kit: BrandKitContent): TextLayer {
  const s = layer.style;
  return {
    ...layer,
    style: {
      ...s,
      fontFamily: resolveFontFamily(s.fontFamily, kit),
      fontSize: resolveSize(s.fontSize as number | string, kit, s.fontSize as number),
      fontWeight: resolveFontWeight(s.fontWeight, kit, 400),
      color: resolveColor(s.color, kit, "#000000"),
      backgroundColor: s.backgroundColor
        ? resolveColor(s.backgroundColor, kit, "#ffffff")
        : s.backgroundColor,
    },
  };
}

function resolveImage(layer: ImageLayer, kit: BrandKitContent): ImageLayer {
  return {
    ...layer,
    src: resolveLogoSrc(layer.src, kit),
  };
}
