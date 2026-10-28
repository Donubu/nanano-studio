// Escalado uniforme de capas: posición, tamaño y todo lo que tiene unidad de
// píxel (tipografía, radios, bordes, sombras, padding/gap de stacks). Lo usan
// el fit scale-based de overrides.ts y el motor de adaptación (adapt.ts).

import {
  TemplateLayer,
  StackLayout,
  LayoutConfig,
  isFontSizeRange,
} from "./types";

export function scaleFontSize(
  fs: number | string | { min: number; max: number },
  scale: number,
): number | string | { min: number; max: number } {
  if (typeof fs === "number") return fs * scale;
  if (isFontSizeRange(fs)) return { min: fs.min * scale, max: fs.max * scale };
  // Token string (ej. "{scale.lg}") — sin info para escalar, se deja igual.
  return fs;
}

export function scaleLayoutConfig(layout: LayoutConfig, scale: number): LayoutConfig {
  if (layout.mode !== "stack") return layout;
  const stack = layout as StackLayout;
  return {
    ...stack,
    padding: stack.padding.map((p) => (typeof p === "number" ? p * scale : p)) as StackLayout["padding"],
    gap: typeof stack.gap === "number" ? stack.gap * scale : stack.gap,
  };
}

// Escala SOLO las propiedades de estilo con unidad de píxel (no posición ni
// tamaño). Es lo que hace que un texto de 140px en un master de 1920 quede
// legible en un banner de 300: la caja ya la decide el reflow, el estilo
// acompaña con este factor.
export function scaleLayerStyle(layer: TemplateLayer, scale: number): TemplateLayer {
  const shadow = layer.shadow
    ? { x: layer.shadow.x * scale, y: layer.shadow.y * scale, blur: layer.shadow.blur * scale, color: layer.shadow.color }
    : layer.shadow;
  if (layer.type === "text") {
    return {
      ...layer,
      shadow,
      style: {
        ...layer.style,
        fontSize: scaleFontSize(layer.style.fontSize, scale),
        letterSpacing:
          layer.style.letterSpacing != null ? layer.style.letterSpacing * scale : layer.style.letterSpacing,
        backgroundCornerRadius:
          layer.style.backgroundCornerRadius != null
            ? layer.style.backgroundCornerRadius * scale
            : layer.style.backgroundCornerRadius,
        outline: layer.style.outline
          ? { color: layer.style.outline.color, width: layer.style.outline.width * scale }
          : layer.style.outline,
      },
    };
  }
  if (layer.type === "image") {
    return {
      ...layer,
      shadow,
      cornerRadius: layer.cornerRadius != null ? layer.cornerRadius * scale : layer.cornerRadius,
    };
  }
  if (layer.type === "shape") {
    return {
      ...layer,
      shadow,
      cornerRadius: layer.cornerRadius != null ? layer.cornerRadius * scale : layer.cornerRadius,
      stroke: layer.stroke ? { color: layer.stroke.color, width: layer.stroke.width * scale } : layer.stroke,
    };
  }
  if (layer.type === "icon") {
    // strokeWidth de lucide va en unidades del viewBox (24), no en px: ya
    // escala con el tamaño del SVG. Multiplicarlo lo engrosa en cada
    // adaptación hasta que el ícono queda como un cuadrado relleno.
    return { ...layer, shadow };
  }
  if (layer.type === "frame") {
    return {
      ...layer,
      shadow,
      cornerRadius: layer.cornerRadius != null ? layer.cornerRadius * scale : layer.cornerRadius,
      layout: scaleLayoutConfig(layer.layout, scale),
    };
  }
  return layer;
}

// Escala posición + tamaño + estilo. Los hijos de un frame mantienen coords
// relativas al frame: se escalan con el mismo factor y sin offset.
export function scaleLayerUniform(
  layer: TemplateLayer,
  scale: number,
  offsetX: number,
  offsetY: number,
): TemplateLayer {
  const styled = scaleLayerStyle(layer, scale);
  const base = {
    position: { x: layer.position.x * scale + offsetX, y: layer.position.y * scale + offsetY },
    size: { w: layer.size.w * scale, h: layer.size.h * scale },
  };
  if (styled.type === "frame") {
    return {
      ...styled,
      ...base,
      children: styled.children.map((c) => scaleLayerUniform(c, scale, 0, 0)),
    };
  }
  return { ...styled, ...base };
}
