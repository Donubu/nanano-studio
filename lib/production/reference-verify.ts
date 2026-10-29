// Verificación visual de "Fiel a la referencia": después de armar la pieza
// con los bloques que describió Gemini, se renderiza, se compara con la
// referencia y el modelo devuelve correcciones chicas por capa (caja en %
// del formato, color, escala de letra, ocultar). Acá va la parte pura y
// compartida UI/backend: describir las capas para el modelo y aplicar las
// correcciones con topes. El pedido a Gemini está en reference-verifier.ts.

import type { TemplateDefinition, TemplateLayer, TextLayer } from "./types";
import { inferRoles } from "./layer-roles";
import { normalizeHex } from "./reference-layout";

export interface VerifyLayer {
  id: string;
  type: TemplateLayer["type"];
  role: string;
  // Caja en % del formato (0-100), como las describe el planificador.
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  color?: string;
  background_color?: string;
}

export interface ReferenceCorrection {
  id: string;
  // Caja objetivo en % del formato (la que se ve en la referencia).
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  color?: string;
  background_color?: string;
  // Multiplicador del tamaño de letra (textos).
  font_scale?: number;
  // La referencia no tiene este elemento.
  hidden?: boolean;
}

export interface ReferenceVerification {
  // 0-100: cuánto se parece el render a la referencia.
  fidelity: number;
  summary: string;
  corrections: ReferenceCorrection[];
}

// Topes: una corrección es un ajuste, no una recomposición.
const MAX_MOVE_PCT = 20;
const SIZE_FACTOR = { min: 0.5, max: 2 };
const FONT_SCALE = { min: 0.6, max: 1.6 };
// Se considera buena a partir de acá: no hace falta otra pasada.
export const FIDELITY_TARGET = 90;
export const MAX_VERIFY_PASSES = 2;

const pct = (v: number) => Math.round(v * 10) / 10;

export function describeLayersForVerify(def: TemplateDefinition): VerifyLayer[] {
  const roles = inferRoles(def);
  const W = def.size.w;
  const H = def.size.h;
  const out: VerifyLayer[] = [];
  for (const l of def.children) {
    if (l.visible === false) continue;
    const base: VerifyLayer = {
      id: l.id,
      type: l.type,
      role: roles.get(l.id) ?? (l.type === "image" ? "image" : l.type === "shape" ? "shape" : "text"),
      x: pct((l.position.x / W) * 100),
      y: pct((l.position.y / H) * 100),
      w: pct((l.size.w / W) * 100),
      h: pct((l.size.h / H) * 100),
    };
    if (l.type === "text") {
      base.text = l.content.slice(0, 80);
      base.color = l.style.color;
      if (l.style.backgroundColor) base.background_color = l.style.backgroundColor;
    } else if (l.type === "shape") {
      base.background_color = l.fill;
    }
    out.push(base);
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function sanitizeVerification(raw: unknown): ReferenceVerification | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const fidelity = typeof o.fidelity === "number" && Number.isFinite(o.fidelity) ? clamp(Math.round(o.fidelity), 0, 100) : 0;
  const summary = typeof o.summary === "string" ? o.summary.trim().slice(0, 300) : "";
  const corrections: ReferenceCorrection[] = [];
  for (const c of Array.isArray(o.corrections) ? o.corrections : []) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id) continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const out: ReferenceCorrection = { id: r.id };
    const x = num(r.x), y = num(r.y), w = num(r.w), h = num(r.h);
    if (x !== undefined) out.x = x;
    if (y !== undefined) out.y = y;
    if (w !== undefined && w > 0) out.w = w;
    if (h !== undefined && h > 0) out.h = h;
    const color = normalizeHex(r.color);
    if (color) out.color = color;
    const bg = normalizeHex(r.background_color);
    if (bg) out.background_color = bg;
    const fs = num(r.font_scale);
    if (fs !== undefined && fs > 0) out.font_scale = fs;
    if (r.hidden === true) out.hidden = true;
    if (Object.keys(out).length > 1) corrections.push(out);
  }
  return { fidelity, summary, corrections };
}

// Aplica las correcciones con topes y devuelve cuántas cambiaron algo.
export function applyReferenceCorrections(
  def: TemplateDefinition,
  corrections: ReferenceCorrection[],
): { definition: TemplateDefinition; applied: number } {
  const W = def.size.w;
  const H = def.size.h;
  const byId = new Map(corrections.map((c) => [c.id, c]));
  const roles = inferRoles(def);
  let applied = 0;
  const children = def.children.map((l): TemplateLayer => {
    const c = byId.get(l.id);
    if (!c) return l;
    let next: TemplateLayer = { ...l };
    let changed = false;
    // El logo de la marca se queda aunque la referencia no tenga uno.
    if (c.hidden && roles.get(l.id) !== "logo") {
      next = { ...next, visible: false };
      applied++;
      return next;
    }
    // Caja objetivo: se mueve hasta MAX_MOVE_PCT y se escala entre 0,5× y 2×.
    const target = {
      x: c.x !== undefined ? (c.x / 100) * W : l.position.x,
      y: c.y !== undefined ? (c.y / 100) * H : l.position.y,
      w: c.w !== undefined ? (c.w / 100) * W : l.size.w,
      h: c.h !== undefined ? (c.h / 100) * H : l.size.h,
    };
    const w = clamp(target.w, l.size.w * SIZE_FACTOR.min, l.size.w * SIZE_FACTOR.max);
    const h = clamp(target.h, l.size.h * SIZE_FACTOR.min, l.size.h * SIZE_FACTOR.max);
    const maxDx = (MAX_MOVE_PCT / 100) * W;
    const maxDy = (MAX_MOVE_PCT / 100) * H;
    const x = clamp(clamp(target.x, l.position.x - maxDx, l.position.x + maxDx), -w * 0.1, W - w * 0.9);
    const y = clamp(clamp(target.y, l.position.y - maxDy, l.position.y + maxDy), -h * 0.1, H - h * 0.9);
    if (Math.abs(x - l.position.x) > 0.5 || Math.abs(y - l.position.y) > 0.5) {
      next = { ...next, position: { x: Math.round(x), y: Math.round(y) } };
      changed = true;
    }
    if (Math.abs(w - l.size.w) > 0.5 || Math.abs(h - l.size.h) > 0.5) {
      next = { ...next, size: { w: Math.round(w), h: Math.round(h) } };
      changed = true;
    }
    if (next.type === "text") {
      const t = next as TextLayer;
      let style = t.style;
      if (c.color && c.color !== style.color) {
        style = { ...style, color: c.color };
        changed = true;
      }
      if (c.background_color && style.backgroundColor && c.background_color !== style.backgroundColor) {
        style = { ...style, backgroundColor: c.background_color };
        changed = true;
      }
      if (c.font_scale !== undefined) {
        const f = clamp(c.font_scale, FONT_SCALE.min, FONT_SCALE.max);
        const fs = style.fontSize;
        if (Math.abs(f - 1) > 0.02) {
          // Fijo o rango de auto-fit; un token de escala no se toca.
          if (typeof fs === "number") {
            style = { ...style, fontSize: Math.max(8, Math.round(fs * f)) };
            changed = true;
          } else if (typeof fs === "object" && fs) {
            style = { ...style, fontSize: { ...fs, min: Math.max(8, Math.round(fs.min * f)), max: Math.max(8, Math.round(fs.max * f)) } };
            changed = true;
          }
        }
      }
      next = { ...t, style };
    } else if (next.type === "shape" && c.background_color && c.background_color !== next.fill) {
      next = { ...next, fill: c.background_color };
      changed = true;
    }
    if (changed) applied++;
    return next;
  });
  return { definition: { ...def, children }, applied };
}
