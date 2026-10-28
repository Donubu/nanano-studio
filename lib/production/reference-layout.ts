// "Fiel a la referencia" (Crear con referencia): el modelo describe la
// composición de la imagen de referencia como una lista corta de bloques
// (rol, caja en % del formato, color, texto) y este módulo la arma como pieza
// real, con capas editables. Las plantillas del catálogo no alcanzan a
// parecerse a una referencia arbitraria; esto sí. Puro.

import type { ImageLayer, ShapeLayer, TemplateDefinition, TemplateLayer, TextLayer } from "./types";
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
}

export interface ReferenceLayout {
  aspect: AspectKey;
  background: string;
  blocks: ReferenceBlock[];
}

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toUpperCase() : undefined);
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
    });
    if (blocks.length >= MAX_BLOCKS) break;
  }
  if (!blocks.some((b) => b.role !== "shape" && b.role !== "image")) return null;
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

export interface BuiltReference {
  definition: TemplateDefinition;
  imagePrompts: { id: string; prompt: string }[];
}

export function buildReferenceDefinition(layout: ReferenceLayout, logoSrc: string | null): BuiltReference {
  const { w: W, h: H } = CANONICAL_SIZES[layout.aspect];
  const children: TemplateLayer[] = [];
  const imagePrompts: { id: string; prompt: string }[] = [];
  let images = 0;
  layout.blocks.forEach((b, i) => {
    const box = {
      position: { x: Math.round((b.x / 100) * W), y: Math.round((b.y / 100) * H) },
      size: { w: Math.max(4, Math.round((b.w / 100) * W)), h: Math.max(4, Math.round((b.h / 100) * H)) },
    };
    if (b.role === "logo") {
      if (!logoSrc) return;
      const logo: ImageLayer = { id: LOGO_SLOT_ID, type: "image", name: "Logo", ...box, src: logoSrc, fit: "contain", focalX: 0, focalY: 0 };
      children.push(logo);
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
        fill: b.background_color ?? b.color ?? "#E5E7EB",
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
        fontFamily: "Inter, system-ui, sans-serif",
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
