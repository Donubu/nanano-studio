// "Fiel a la referencia" (Crear con referencia): el modelo describe la
// composición de la imagen de referencia como una lista corta de bloques
// (rol, caja en % del formato, color, texto) y este módulo la arma como pieza
// real, con capas editables. Las plantillas del catálogo no alcanzan a
// parecerse a una referencia arbitraria; esto sí. Puro.

import type { IconLayer, ImageLayer, ShapeLayer, TemplateDefinition, TemplateLayer, TextLayer } from "./types";
import { GOOGLE_FONTS } from "./google-fonts";
import { isValidIconName } from "./icon-catalog";
import { CANONICAL_SIZES, type AspectKey } from "./layout-templates";
import { LOGO_SLOT_ID } from "./layout-plan";
import { formatChileanPrices } from "./layout-plan";

export const REFERENCE_ROLES = [
  "headline",
  "subtitle",
  "price",
  "cta",
  "badge",
  "legal",
  "text",
  "logo",
  "image",
  "shape",
  "icon",
] as const;
export type ReferenceRole = (typeof REFERENCE_ROLES)[number];
export const REFERENCE_SHAPES = ["rect", "rounded", "pill", "circle"] as const;

export interface ReferenceBlock {
  role: ReferenceRole;
  // Caja en % del formato (0-100).
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  color?: string;
  background_color?: string;
  shape?: (typeof REFERENCE_SHAPES)[number];
  align?: "left" | "center" | "right";
  weight?: number;
  uppercase?: boolean;
  image_prompt?: string;
  // Familia de Google Fonts más parecida a la de la referencia (lista del
  // editor, google-fonts.ts).
  font_family?: string;
  // Degradado de un shape: 2-3 colores y ángulo CSS (180 = de arriba abajo).
  gradient_colors?: string[];
  gradient_angle?: number;
  // Ícono del catálogo (role icon).
  icon_name?: string;
}

const FONT_BY_NAME = new Map(GOOGLE_FONTS.map((f) => [f.family.toLowerCase(), f]));
const FONT_FALLBACK: Record<string, string> = {
  "sans-serif": "system-ui, sans-serif",
  serif: "Georgia, serif",
  display: "system-ui, sans-serif",
  handwriting: "cursive",
  monospace: "monospace",
};

export function fontStack(family: string | undefined): string | undefined {
  const f = family ? FONT_BY_NAME.get(family.trim().toLowerCase()) : undefined;
  return f ? `${f.family}, ${FONT_FALLBACK[f.category] ?? "sans-serif"}` : undefined;
}

export interface ReferenceLayout {
  aspect: AspectKey;
  background: string;
  blocks: ReferenceBlock[];
}

// Colores del modelo: #RRGGBB, pero también #RGB, rgb()/rgba() y nombres
// básicos (a veces responde "white" o "#FFF"; descartarlos dejaba los textos
// en el gris oscuro por defecto).
const NAMED: Record<string, string> = {
  white: "#FFFFFF",
  black: "#000000",
  red: "#FF0000",
  blue: "#0000FF",
  yellow: "#FFFF00",
  green: "#008000",
  gray: "#808080",
  grey: "#808080",
  orange: "#FFA500",
};
// `alpha`: conserva la transparencia (#RRGGBBAA): en un degradado, un tramo
// transparente es el velo que funde con la foto.
export function normalizeHex(v: unknown, alpha = false): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  if (NAMED[t]) return NAMED[t];
  if (alpha && t === "transparent") return "#00000000";
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(t);
  if (m) return `#${m[1]}${alpha && m[2] ? m[2] : ""}`.toUpperCase();
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(t);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase();
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?/.exec(t);
  if (m) {
    const h = (n: number) => Math.round(Math.min(255, n)).toString(16).padStart(2, "0");
    const a = alpha && m[4] != null ? h(Number(m[4]) * 255) : "";
    return `#${h(Number(m[1]))}${h(Number(m[2]))}${h(Number(m[3]))}${a}`.toUpperCase();
  }
  return undefined;
}
const hex = normalizeHex;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const MAX_BLOCKS = 16;

export function sanitizeReferenceLayout(raw: unknown): ReferenceLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const aspect: AspectKey = r.aspect === "square" || r.aspect === "vertical" ? r.aspect : "horizontal";
  const blocks: ReferenceBlock[] = [];
  for (const b of Array.isArray(r.blocks) ? r.blocks : []) {
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    if (!(REFERENCE_ROLES as readonly string[]).includes(o.role as string)) continue;
    const [x, y, w, h] = [num(o.x), num(o.y), num(o.w), num(o.h)];
    if (x == null || y == null || w == null || h == null || w <= 0.5 || h <= 0.5) continue;
    blocks.push({
      role: o.role as ReferenceRole,
      x: Math.max(-5, Math.min(100, x)),
      y: Math.max(-5, Math.min(100, y)),
      w: Math.min(110, w),
      h: Math.min(110, h),
      text: typeof o.text === "string" ? o.text.trim().slice(0, 300) : undefined,
      color: hex(o.color),
      background_color: hex(o.background_color),
      shape: (REFERENCE_SHAPES as readonly string[]).includes(o.shape as string)
        ? (o.shape as ReferenceBlock["shape"])
        : undefined,
      align: o.align === "center" || o.align === "right" ? o.align : o.align === "left" ? "left" : undefined,
      weight: num(o.weight) ?? undefined,
      uppercase: o.uppercase === true,
      image_prompt: typeof o.image_prompt === "string" ? o.image_prompt.trim().slice(0, 800) : undefined,
      font_family: typeof o.font_family === "string" && FONT_BY_NAME.has(o.font_family.trim().toLowerCase()) ? o.font_family.trim() : undefined,
      gradient_colors: Array.isArray(o.gradient_colors)
        ? o.gradient_colors.map((c) => normalizeHex(c, true)).filter((c): c is string => !!c).slice(0, 3)
        : undefined,
      gradient_angle: num(o.gradient_angle) ?? undefined,
      icon_name: typeof o.icon_name === "string" && isValidIconName(o.icon_name) ? o.icon_name : undefined,
    });
    if (blocks.length >= MAX_BLOCKS) break;
  }
  if (!blocks.some((b) => b.role !== "shape" && b.role !== "image" && b.role !== "icon")) return null;
  return { aspect, background: hex(r.background) ?? "#FFFFFF", blocks };
}

const ROLE_NAME: Record<ReferenceRole, string> = {
  headline: "Titular",
  subtitle: "Bajada",
  price: "Precio",
  cta: "CTA",
  badge: "Badge",
  legal: "Legal",
  text: "Texto",
  logo: "Logo",
  image: "Imagen",
  shape: "Forma",
  icon: "Ícono",
};

const DEFAULT_WEIGHT: Partial<Record<ReferenceRole, number>> = {
  headline: 800,
  price: 800,
  cta: 700,
  badge: 800,
  subtitle: 500,
  legal: 400,
  text: 500,
};

function radiusFor(shape: ReferenceBlock["shape"], w: number, h: number): number {
  if (shape === "pill") return Math.round(h / 2);
  if (shape === "circle") return Math.round(Math.min(w, h) / 2);
  if (shape === "rounded") return Math.round(Math.min(w, h) * 0.18);
  return 0;
}

// Letra que cabe en la caja: alto por líneas y ancho por la línea más larga
// (mismo ancho de glifo estimado que layout-lint).
function fitFont(text: string, w: number, h: number, uppercase: boolean, padded: boolean): number {
  const lines = Math.max(1, text.split("\n").length);
  const longest = Math.max(1, ...text.split("\n").map((l) => l.length));
  const glyph = uppercase ? 0.66 : 0.58;
  const innerW = padded ? w * 0.8 : w;
  const innerH = padded ? h * 0.7 : h;
  return Math.max(8, Math.floor(Math.min(innerH / (lines * 1.15), innerW / (longest * glyph))));
}

// Fuente del texto: en copia íntegra, la que se ve en la referencia; si no,
// la de la marca (titular/precio/CTA con la de títulos) y, sin marca, la de
// la referencia.
function fontFor(b: ReferenceBlock, opts: BuildReferenceOptions): string {
  const fromRef = fontStack(b.font_family);
  if (!opts.integral && opts.fonts) {
    const bold = (b.weight ?? DEFAULT_WEIGHT[b.role] ?? 500) >= 700;
    const brand = bold ? (opts.fonts.heading ?? opts.fonts.body) : (opts.fonts.body ?? opts.fonts.heading);
    if (brand) return brand;
  }
  return fromRef ?? "Inter, system-ui, sans-serif";
}

function isLight(c: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 160;
}

export interface BuiltReference {
  definition: TemplateDefinition;
  imagePrompts: { id: string; prompt: string }[];
}

const pct = (b: ReferenceBlock, W: number, H: number) => ({
  x: (b.x / 100) * W,
  y: (b.y / 100) * H,
  w: (b.w / 100) * W,
  h: (b.h / 100) * H,
});

// Forma que contiene al bloque del logo (la referencia suele tener el logo
// sobre un recuadro de color).
function containingShape(blocks: ReferenceBlock[], logo: ReferenceBlock): number {
  const c = { x: logo.x + logo.w / 2, y: logo.y + logo.h / 2 };
  return blocks.findIndex(
    (b) => b.role === "shape" && c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= b.y + b.h && b.w * b.h > logo.w * logo.h,
  );
}

export interface BuildReferenceOptions {
  // Copia íntegra: textos, fuentes y colores tal cual; las fotos y el logo
  // son recortes de la propia referencia (crops, por índice de bloque).
  integral?: boolean;
  crops?: Map<number, string>;
  // Fuentes de la marca (tokens o familias): en modo normal mandan sobre la
  // fuente que se ve en la referencia.
  fonts?: { heading?: string; body?: string };
}

export function buildReferenceDefinition(
  layout: ReferenceLayout,
  logo: { src: string; aspect: number } | null,
  opts: BuildReferenceOptions = {},
): BuiltReference {
  const { w: W, h: H } = CANONICAL_SIZES[layout.aspect];
  const children: TemplateLayer[] = [];
  const imagePrompts: { id: string; prompt: string }[] = [];
  let images = 0;
  // Caja final del logo, con su proporción real. Si está sobre un recuadro y
  // tiene la proporción del recuadro (el logo de Enaco ya es el cuadrado
  // azul), ocupa el recuadro y la forma sobra; si no, va centrado con aire.
  const skip = new Set<number>();
  const logoBoxes = new Map<number, { x: number; y: number; w: number; h: number }>();
  layout.blocks.forEach((b, i) => {
    if (b.role !== "logo" || !logo || opts.crops?.has(i)) return;
    const aspect = logo.aspect > 0 ? logo.aspect : 1;
    const si = containingShape(layout.blocks, b);
    let area = pct(b, W, H);
    if (si >= 0) {
      const s = pct(layout.blocks[si], W, H);
      const matches = Math.abs(Math.log(s.w / s.h / aspect)) < Math.log(1.3);
      if (matches) skip.add(si);
      const inset = matches ? 0 : 0.15;
      area = { x: s.x + s.w * inset, y: s.y + s.h * inset, w: s.w * (1 - 2 * inset), h: s.h * (1 - 2 * inset) };
    }
    const w = Math.min(area.w, area.h * aspect);
    const h = w / aspect;
    logoBoxes.set(i, { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h });
  });
  layout.blocks.forEach((b, i) => {
    if (skip.has(i)) return;
    const box = {
      position: { x: Math.round((b.x / 100) * W), y: Math.round((b.y / 100) * H) },
      size: { w: Math.max(4, Math.round((b.w / 100) * W)), h: Math.max(4, Math.round((b.h / 100) * H)) },
    };
    const crop = opts.crops?.get(i);
    if ((b.role === "logo" || b.role === "image") && crop) {
      // Recorte de la referencia: la foto o el logo exactos.
      const isLogo = b.role === "logo";
      if (isLogo && children.some((c) => c.id === LOGO_SLOT_ID)) return;
      const id = isLogo ? LOGO_SLOT_ID : images === 0 ? "hero" : `img-${images + 1}`;
      if (!isLogo) images++;
      children.push({ id, type: "image", name: isLogo ? "Logo" : images === 1 ? "Imagen" : `Imagen ${images}`, ...box, src: crop, fit: "cover" });
      return;
    }
    if (b.role === "icon") {
      if (!b.icon_name) return;
      const side = Math.min(box.size.w, box.size.h);
      const icon: IconLayer = {
        id: `icon-${i + 1}`,
        type: "icon",
        name: `Ícono ${b.icon_name}`,
        position: { x: box.position.x + (box.size.w - side) / 2, y: box.position.y + (box.size.h - side) / 2 },
        size: { w: side, h: side },
        iconName: b.icon_name,
        color: b.color ?? "#111111",
        strokeWidth: 2,
      };
      children.push(icon);
      return;
    }
    if (b.role === "logo") {
      const lb = logoBoxes.get(i);
      if (!logo || !lb || children.some((c) => c.id === LOGO_SLOT_ID)) return;
      const layer: ImageLayer = {
        id: LOGO_SLOT_ID,
        type: "image",
        name: "Logo",
        position: { x: Math.round(lb.x), y: Math.round(lb.y) },
        size: { w: Math.round(lb.w), h: Math.round(lb.h) },
        src: logo.src,
        fit: "contain",
      };
      children.push(layer);
      return;
    }
    if (b.role === "image") {
      const id = images === 0 ? "hero" : `img-${images + 1}`;
      images++;
      const img: ImageLayer = { id, type: "image", name: images === 1 ? "Imagen" : `Imagen ${images}`, ...box, src: null, fit: "cover" };
      children.push(img);
      if (b.image_prompt) imagePrompts.push({ id, prompt: b.image_prompt });
      return;
    }
    if (b.role === "shape") {
      const shape: ShapeLayer = {
        id: `shape-${i + 1}`,
        type: "shape",
        name: "Forma",
        ...box,
        shape: b.shape === "circle" ? "ellipse" : "rect",
        fill:
          (b.gradient_colors?.length ?? 0) >= 2
            ? `linear-gradient(${Math.round(b.gradient_angle ?? 180)}deg, ${b.gradient_colors!.join(", ")})`
            : b.background_color ?? b.color ?? "#E5E7EB",
        cornerRadius: radiusFor(b.shape, box.size.w, box.size.h),
      };
      children.push(shape);
      return;
    }
    const content = formatChileanPrices(b.text?.trim() || ROLE_NAME[b.role]);
    const withBg = !!b.background_color && (b.role === "cta" || b.role === "badge" || b.role === "price" || b.role === "text");
    const fs = fitFont(content, box.size.w, box.size.h, !!b.uppercase, withBg);
    const text: TextLayer = {
      id: `${b.role}-${i + 1}`,
      type: "text",
      name: ROLE_NAME[b.role],
      ...box,
      content,
      style: {
        fontFamily: fontFor(b, opts),
        fontSize: { min: Math.max(8, Math.round(fs * 0.45)), max: fs },
        fontWeight: Math.max(300, Math.min(900, Math.round((b.weight ?? DEFAULT_WEIGHT[b.role] ?? 500) / 100) * 100)),
        color: b.color ?? "#111111",
        lineHeight: b.role === "headline" ? 1.02 : 1.15,
        align: b.align ?? (withBg ? "center" : "left"),
        verticalAlign: withBg ? "middle" : "top",
        ...(b.uppercase ? { textTransform: "uppercase" as const } : {}),
        ...(withBg
          ? { backgroundColor: b.background_color, backgroundCornerRadius: radiusFor(b.shape ?? "rounded", box.size.w, box.size.h) }
          : {}),
      },
    };
    // Texto claro sin fondo sobre una foto: sombra suave para que se lea
    // sobre cielos y zonas claras (la referencia lo resuelve con la foto que
    // tiene; la generada puede ser más clara).
    const overPhoto = children.some(
      (c) =>
        c.type === "image" &&
        c.id !== LOGO_SLOT_ID &&
        box.position.x < c.position.x + c.size.w &&
        c.position.x < box.position.x + box.size.w &&
        box.position.y < c.position.y + c.size.h &&
        c.position.y < box.position.y + box.size.h,
    );
    if (!opts.integral && !withBg && overPhoto && isLight(text.style.color)) {
      text.shadow = { x: 0, y: Math.max(1, Math.round(fs * 0.04)), blur: Math.round(fs * 0.35), color: "rgba(0,0,0,0.55)" };
    }
    children.push(text);
  });
  return {
    definition: {
      id: "tpl_root",
      type: "frame",
      position: { x: 0, y: 0 },
      size: { w: W, h: H },
      background: { type: "color", value: layout.background },
      layout: { mode: "free" },
      children,
    },
    imagePrompts,
  };
}
