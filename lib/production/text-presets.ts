// Estilos rápidos de texto gráfico (panel de propiedades y "Pídele a la
// IA"): combinaciones de los efectos de text-effects.ts con medidas
// proporcionales a la letra. Puro.

import type { TextLayer } from "./types";
import { effectiveFontSize } from "./layout-lint";

export const TEXT_PRESETS = [
  { id: "none", label: "Plano" },
  { id: "volume", label: "Volumen 3D" },
  { id: "sticker", label: "Sticker" },
  { id: "gradient", label: "Degradado" },
  { id: "gold", label: "Dorado" },
  { id: "glow", label: "Brillo" },
] as const;
export type TextPresetId = (typeof TEXT_PRESETS)[number]["id"];

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Mezcla un color con otro (t = 0 → a, 1 → b). Si no es hex, devuelve b.
export function mixColor(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return b;
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${ca.map((v, i) => hex(v + (cb[i] - v) * t)).join("")}`.toUpperCase();
}

const r1 = (n: number) => Math.round(n * 10) / 10;

// Luminancia relativa 0-1 (sin hex, se asume clara).
function luminance(c: string): number {
  const rgb = hexToRgb(c);
  if (!rgb) return 1;
  const [r, g, b] = rgb.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// `resolvedColor`: el color del texto ya resuelto (los tokens no se pueden
// aclarar ni oscurecer); `accent`: color de marca para el brillo.
export function applyTextPreset(
  layer: TextLayer,
  id: TextPresetId,
  resolvedColor: string,
  accent?: string,
): TextLayer {
  const fs = effectiveFontSize(layer) ?? 48;
  const base: TextLayer["style"] = { ...layer.style, fill: null, outline: null, outline2: null, extrude: null };
  let style = base;
  let shadow = layer.shadow;
  switch (id) {
    case "none":
      shadow = undefined;
      break;
    case "volume":
      style = { ...base, extrude: { color: mixColor(resolvedColor, "#000000", 0.55), depth: r1(fs * 0.07), angle: 60 } };
      shadow = { x: 0, y: r1(fs * 0.03), blur: r1(fs * 0.08), color: "rgba(0,0,0,0.35)" };
      break;
    case "sticker": {
      // El contorno interior contrasta con la letra: letra clara → contorno
      // de marca (u oscuro) y borde exterior blanco; letra oscura → al revés.
      const light = luminance(resolvedColor) > 0.6;
      const inner = light ? (accent && luminance(accent) < 0.5 ? accent : "#111111") : "#FFFFFF";
      style = {
        ...base,
        outline: { color: inner, width: r1(Math.max(1, fs * 0.06)) },
        outline2: { color: light ? "#FFFFFF" : "#111111", width: r1(Math.max(1, fs * 0.035)) },
      };
      shadow = { x: 0, y: r1(fs * 0.05), blur: r1(fs * 0.06), color: "rgba(0,0,0,0.35)" };
      break;
    }
    case "gradient":
      style = {
        ...base,
        fill: { type: "gradient", value: `linear-gradient(180deg, ${mixColor(resolvedColor, "#FFFFFF", 0.55)}, ${resolvedColor})` },
      };
      break;
    case "gold":
      style = {
        ...base,
        color: "#E0A526",
        fill: { type: "gradient", value: "linear-gradient(180deg, #FFF0A8, #C98A0B)" },
        extrude: { color: "#6B4000", depth: r1(fs * 0.05), angle: 70 },
      };
      shadow = { x: 0, y: r1(fs * 0.03), blur: r1(fs * 0.08), color: "rgba(0,0,0,0.4)" };
      break;
    case "glow":
      style = { ...base, color: "#FFFFFF" };
      shadow = { x: 0, y: 0, blur: r1(fs * 0.35), color: accent ?? resolvedColor };
      break;
  }
  return { ...layer, style, shadow };
}
