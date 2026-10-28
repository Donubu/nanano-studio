// Efectos gráficos del texto vivo: relleno con degradado o textura, contorno
// doble y volumen 3D (TextLayer.style.fill / outline2 / extrude, types.ts).
// Puro: arma el CSS que dibuja template-layer.tsx (editor, previews, export).
//
// El texto se dibuja como una pila de copias idénticas: la de adelante lleva
// el relleno; detrás van el contorno, el segundo contorno, el volumen y la
// sombra. Así el contorno queda POR FUERA de la letra (-webkit-text-stroke
// es centrado y se come la mitad del relleno) y la sombra no tapa un relleno
// con background-clip:text (con color transparente, text-shadow se ve a
// través de la letra). Todo es CSS estándar que html-to-image exporta.

import type { CSSProperties } from "react";
import type { DropShadow, TextLayer } from "./types";
import { TEXTURE_STYLE_DEFAULT } from "./art-direction";

type TextStyle = TextLayer["style"];

export function hasTextEffects(style: TextStyle): boolean {
  return !!(style.fill || (style.outline2 && style.outline2.width > 0) || (style.extrude && style.extrude.depth > 0));
}

export interface TextEffectRender {
  // Estilo del span de adelante (relleno).
  main: CSSProperties;
  // Copias de atrás hacia adelante.
  behind: CSSProperties[];
}

// text-shadow con muchas capas es caro: el volumen se arma con hasta 40
// pasos (en una letra de 100 px y 8 px de volumen, un paso por px).
const MAX_EXTRUDE_STEPS = 40;

function clipToText(backgroundImage: string, extra: CSSProperties = {}): CSSProperties {
  return {
    backgroundImage,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    WebkitTextFillColor: "transparent",
    // Cada línea lleva el relleno completo (si no, un degradado se reparte
    // entre las líneas de un titular de dos renglones).
    WebkitBoxDecorationBreak: "clone",
    boxDecorationBreak: "clone",
    ...extra,
  };
}

function solid(color: string, stroke: number): CSSProperties {
  return {
    color,
    WebkitTextFillColor: color,
    WebkitTextStroke: stroke > 0 ? `${stroke}px ${color}` : undefined,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

export function textEffectLayers(style: TextStyle, shadow?: DropShadow): TextEffectRender | null {
  if (!hasTextEffects(style)) return null;
  const w1 = style.outline && style.outline.width > 0 ? style.outline.width : 0;
  const w2 = style.outline2 && style.outline2.width > 0 ? style.outline2.width : 0;

  let main: CSSProperties;
  if (style.fill?.type === "gradient") main = clipToText(style.fill.value);
  else if (style.fill?.type === "texture")
    main = clipToText(`url("${style.fill.src}")`, { backgroundSize: "cover", backgroundPosition: "center" });
  else main = { color: style.color, WebkitTextFillColor: style.color };

  // De adelante hacia atrás; se invierte al final.
  const front: CSSProperties[] = [];
  // El stroke de una copia es el doble de lo que debe asomar fuera de la
  // letra (es centrado y la mitad de adentro la tapa la copia de adelante).
  if (w1 > 0) front.push(solid(style.outline!.color, 2 * w1));
  if (w2 > 0) front.push(solid(style.outline2!.color, 2 * (w1 + w2)));
  const outer = 2 * (w1 + w2);

  const shadows: string[] = [];
  let back: CSSProperties | null = null;
  const ex = style.extrude && style.extrude.depth > 0 ? style.extrude : null;
  if (ex) {
    const steps = Math.min(MAX_EXTRUDE_STEPS, Math.max(1, Math.ceil(ex.depth)));
    const rad = (ex.angle * Math.PI) / 180;
    const dx = (Math.cos(rad) * ex.depth) / steps;
    const dy = (Math.sin(rad) * ex.depth) / steps;
    for (let i = 1; i <= steps; i++) shadows.push(`${round(dx * i)}px ${round(dy * i)}px 0 ${ex.color}`);
    back = solid(ex.color, outer);
  }
  if (shadow) {
    // La sombra cae desde el fondo del volumen.
    const ox = ex ? (Math.cos((ex.angle * Math.PI) / 180) * ex.depth) : 0;
    const oy = ex ? (Math.sin((ex.angle * Math.PI) / 180) * ex.depth) : 0;
    shadows.push(`${round(shadow.x + ox)}px ${round(shadow.y + oy)}px ${round(shadow.blur)}px ${shadow.color}`);
    if (!back) {
      const c = style.outline2?.color ?? style.outline?.color ?? style.color;
      back = solid(c, outer);
    }
  }
  if (back) front.push({ ...back, textShadow: shadows.join(", ") });

  return { main, behind: front.reverse() };
}

// Prompt del generador para una textura que va dentro de las letras.
export function texturePrompt(description: string): string {
  return `Seamless full-frame texture or material: ${description}. Evenly lit, detail across the whole image, no single subject, no borders. ${TEXTURE_STYLE_DEFAULT}`;
}
