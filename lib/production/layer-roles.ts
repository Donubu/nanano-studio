// Rol de cada capa de primer nivel de una pieza, inferido de su tipo, estilo
// y nombre. El motor de adaptación lo usa para decidir qué sobrevive en
// formatos chicos (prioridad) y en qué orden se arma una tira.
//
// Heurísticas laxas a propósito: el productor puede ocultar/mostrar capas a
// mano en el editor de la adaptación si el motor se equivoca.

import type { TemplateDefinition, TemplateLayer, TextLayer } from "./types";
import { isFontSizeRange } from "./types";

export type LayerRole =
  | "background"
  | "headline"
  | "cta"
  | "badge"
  | "logo"
  | "product"
  | "secondary"
  | "icon"
  | "decoration";

// Menor número = más importante. Lo último que se oculta es el titular.
export const ROLE_PRIORITY: Record<LayerRole, number> = {
  background: 0,
  headline: 1,
  cta: 2,
  badge: 3,
  logo: 4,
  product: 5,
  secondary: 6,
  icon: 7,
  decoration: 8,
};

const BACKGROUND_COVER = 0.9;

export function coversFrame(l: TemplateLayer, frame: { w: number; h: number }): boolean {
  if (l.type !== "image" && l.type !== "shape") return false;
  // Sin tope superior: una foto agrandada para reencuadrar (sangra) sigue
  // siendo el fondo.
  return l.size.w >= frame.w * BACKGROUND_COVER && l.size.h >= frame.h * BACKGROUND_COVER;
}

function fontOf(t: TextLayer): number {
  const fs = t.style.fontSize;
  if (typeof fs === "number") return fs;
  if (isFontSizeRange(fs)) return fs.max;
  return 0;
}

const CTA_NAME = /\b(cta|bot[oó]n|button|comprar|compra|pide|pedir|reserva|ver m[aá]s)\b/i;
const BADGE_NAME = /\b(badge|sello|dcto|descuento|oferta|tag|etiqueta|precio)\b/i;
const LOGO_NAME = /\blogo/i;

export function inferRoles(def: TemplateDefinition): Map<string, LayerRole> {
  const roles = new Map<string, LayerRole>();
  const visible = def.children.filter((c) => c.visible !== false);
  let headline: { id: string; fs: number } | null = null;
  for (const l of visible) {
    if (l.type === "text" && !l.style.backgroundColor) {
      const fs = fontOf(l);
      if (!headline || fs > headline.fs) headline = { id: l.id, fs };
    }
  }
  for (const l of visible) {
    const name = `${l.name ?? ""} ${l.type === "text" ? l.content : ""}`;
    let role: LayerRole;
    if (coversFrame(l, def.size)) role = "background";
    else if (LOGO_NAME.test(l.name ?? "")) role = "logo";
    else if (l.type === "text") {
      if (l.skin?.mode === "fit") role = "badge";
      else if (l.style.backgroundColor) {
        const ratio = l.size.w / Math.max(1, l.size.h);
        const round = (l.style.backgroundCornerRadius ?? 0) >= Math.min(l.size.w, l.size.h) * 0.45;
        // Círculo/cuadrado con fondo = badge; pastilla ancha = CTA.
        if ((ratio < 1.6 && round) || (BADGE_NAME.test(name) && !CTA_NAME.test(name))) role = "badge";
        else role = "cta";
      } else role = l.id === headline?.id ? "headline" : "secondary";
    } else if (l.type === "icon") role = "icon";
    else if (l.type === "image") role = "product";
    else role = "decoration";
    roles.set(l.id, role);
  }
  return roles;
}

// Íconos que acompañan a un texto (ej. camión + "Envío gratis"): mismo
// renglón y a menos de 1.5× el tamaño del ícono. Si el texto se oculta, el
// ícono también.
export function companionIcons(def: TemplateDefinition, textId: string): string[] {
  const t = def.children.find((c) => c.id === textId);
  if (!t) return [];
  const tcy = t.position.y + t.size.h / 2;
  return def.children
    .filter((c) => c.type === "icon" && c.visible !== false)
    .filter((icon) => {
      const reach = Math.max(icon.size.w, icon.size.h) * 1.5;
      const gapX = Math.max(t.position.x - (icon.position.x + icon.size.w), icon.position.x - (t.position.x + t.size.w), 0);
      const cy = icon.position.y + icon.size.h / 2;
      return gapX <= reach && Math.abs(cy - tcy) <= Math.max(t.size.h, icon.size.h);
    })
    .map((c) => c.id);
}
