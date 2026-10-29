// Zonas seguras por plataforma.
//
// Cada placement tapa parte de la pieza con su interfaz (stories y reels:
// perfil arriba y respuesta abajo; TikTok: botones a la derecha y caption
// abajo; portada de X: el avatar; miniatura de YouTube: la duración) o la
// recorta (feed 4:5 → 1:1 en la grilla). Lo importante (textos, logo, CTA)
// tiene que quedar fuera de esas franjas.
//
// Fuente de verdad: `production_format_presets.safe_zone_json` si el preset
// lo tiene; si no, los valores por defecto de acá según canal y proporción
// (sirven también para tamaños a medida). Se expresan en px de la pieza.
// El margen mínimo de 3% (layout-lint.ts safeMargin) aplica siempre.

export interface SafeZone {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

export function parseSafeZone(raw: unknown): SafeZone | null {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const z = { top: num(o.top), right: num(o.right), bottom: num(o.bottom), left: num(o.left) };
  if (z.top == null && z.right == null && z.bottom == null && z.left == null) return null;
  return { top: z.top ?? 0, right: z.right ?? 0, bottom: z.bottom ?? 0, left: z.left ?? 0 };
}

// Fracciones por canal y familia de proporción. `story` = 9:16 o más alto.
type Fractions = { top?: number; right?: number; bottom?: number; left?: number };
const STORY: Fractions = { top: 0.13, bottom: 0.18 };
const DEFAULTS: { channel: RegExp; aspect: "story" | "portrait" | "wide" | "any"; f: Fractions; label: string }[] = [
  { channel: /^(instagram|meta|facebook)$/, aspect: "story", f: STORY, label: "Stories / Reels: perfil arriba y respuesta abajo" },
  { channel: /^linkedin$/, aspect: "story", f: STORY, label: "Stories de LinkedIn" },
  { channel: /^tiktok$/, aspect: "story", f: { top: 0.07, right: 0.13, bottom: 0.23, left: 0.03 }, label: "TikTok: botones a la derecha y caption abajo" },
  { channel: /^youtube$/, aspect: "story", f: { top: 0.1, right: 0.11, bottom: 0.2 }, label: "Shorts: título abajo y botones a la derecha" },
  { channel: /^(instagram|meta|facebook)$/, aspect: "portrait", f: { top: 0.1, bottom: 0.1 }, label: "Feed 4:5: se recorta a 1:1 en la grilla" },
  { channel: /^x$/, aspect: "wide", f: { left: 0.17, bottom: 0.2 }, label: "Portada de X: el avatar tapa abajo a la izquierda" },
  { channel: /^youtube$/, aspect: "wide", f: { right: 0.12, bottom: 0.09 }, label: "Miniatura: la duración tapa abajo a la derecha" },
];

function aspectFamily(w: number, h: number): "story" | "portrait" | "wide" | "square" {
  const r = h / w;
  if (r >= 1.6) return "story";
  if (r > 1.05) return "portrait";
  if (r < 0.95) return "wide";
  return "square";
}

export function platformSafeZone(channel: string | null | undefined, w: number, h: number): SafeZone | null {
  if (!channel) return null;
  const fam = aspectFamily(w, h);
  const d = DEFAULTS.find((x) => x.channel.test(channel) && (x.aspect === "any" || x.aspect === fam));
  if (!d) return null;
  return {
    top: Math.round((d.f.top ?? 0) * h),
    right: Math.round((d.f.right ?? 0) * w),
    bottom: Math.round((d.f.bottom ?? 0) * h),
    left: Math.round((d.f.left ?? 0) * w),
  };
}

export function platformSafeZoneLabel(channel: string | null | undefined, w: number, h: number): string | null {
  if (!channel) return null;
  const fam = aspectFamily(w, h);
  return DEFAULTS.find((x) => x.channel.test(channel) && (x.aspect === "any" || x.aspect === fam))?.label ?? null;
}

// Zona de una adaptación: la del preset si la tiene, si no la de la
// plataforma. null = solo el margen mínimo.
export function adaptationSafeZone(a: {
  width: number;
  height: number;
  preset_channel?: string | null;
  preset_safe_zone?: unknown;
}): SafeZone | null {
  return parseSafeZone(a.preset_safe_zone) ?? platformSafeZone(a.preset_channel, a.width, a.height);
}

export function hasSafeZone(z: SafeZone | null | undefined): z is SafeZone {
  return !!z && (z.top > 0 || z.right > 0 || z.bottom > 0 || z.left > 0);
}
