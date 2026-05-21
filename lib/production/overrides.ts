// Override layout per adaptation.
//
// Modelo: cada adaptación puede tener `overrides_json` con un manual_layout
// (un TemplateDefinition completo dimensionado al tamaño de la adaptación).
// Cuando existe, el renderer lo usa tal cual e ignora el fit_mode automático.
// Cuando no existe, se aplica fit_mode + reflow desde el master.
//
// Cape, Celtra y otras plataformas adoptan este modelo: el master sigue
// sincronizado para las adaptaciones que están en "auto"; las que el
// productor ajustó manualmente quedan desacopladas y persisten su propio
// layout. La contrapartida es que cambios al master no se propagan a las
// piezas manuales (es responsabilidad del productor refrescarlas si lo
// necesita).

import {
  TemplateDefinition,
  TemplateLayer,
  isFontSizeRange,
  StackLayout,
} from "./types";
import { reflowForPreview } from "./reflow";
import { FitMode } from "./fit-mode";

export interface AdaptationOverrides {
  manual_layout?: TemplateDefinition;
}

export function parseOverrides(json: string | null | undefined): AdaptationOverrides {
  if (!json) return {};
  try {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    return (parsed && typeof parsed === "object" ? parsed : {}) as AdaptationOverrides;
  } catch {
    return {};
  }
}

export function serializeOverrides(o: AdaptationOverrides): string {
  return JSON.stringify(o);
}

// Construye un layout inicial para el override editor a partir del master.
// Usa reflowForPreview (que ya aprovecha smart constraints) para que el
// productor reciba algo razonable de entrada y solo tenga que ajustar lo
// que no se vea bien.
export function deriveManualLayoutFromMaster(
  master: TemplateDefinition,
  adaptW: number,
  adaptH: number,
): TemplateDefinition {
  return reflowForPreview(master, { w: adaptW, h: adaptH });
}

// Cuando la adapt usa un fit_mode scale-based (contain/cover/width/height),
// la card preview NO usa reflow: renderea el master entero con su tamaño
// nativo y le aplica un CSS transform: scale() uniforme. Si el editor del
// adapt arrancara con reflowForPreview, los layers conservan sus sizes
// originales (smart-constraints inferidos como center/left/right no
// reescalan) y aparecen gigantes en un canvas pequeño (ej. 300×250 vs
// master 1080×1080).
//
// Esta función reproduce visualmente el preview construyendo un manual_layout
// con TODO escalado uniformemente: pos, size, fontSize, lineHeight,
// letterSpacing, cornerRadius, strokeWidth, padding/gap de stacks, shadow.
// El resultado es coherente con lo que el productor ve en la grilla, y al
// guardarse queda como manual_layout independiente.
//
// Para fit_mode === "responsive" devuelve el reflow estándar (caller debería
// chequear primero, pero por defensa lo cubrimos también acá).
export function buildInitialFromAdaptFit(
  master: TemplateDefinition,
  adaptW: number,
  adaptH: number,
  fitMode: FitMode,
): TemplateDefinition {
  if (fitMode === "responsive") {
    return reflowForPreview(master, { w: adaptW, h: adaptH });
  }
  const masterW = master.size.w;
  const masterH = master.size.h;
  if (masterW <= 0 || masterH <= 0) {
    return { ...master, size: { w: adaptW, h: adaptH } };
  }
  const ratioW = adaptW / masterW;
  const ratioH = adaptH / masterH;
  let fitScale = 1;
  let centerX = false;
  let centerY = false;
  switch (fitMode) {
    case "contain":
      fitScale = Math.min(ratioW, ratioH);
      centerX = true;
      centerY = true;
      break;
    case "cover":
      fitScale = Math.max(ratioW, ratioH);
      centerX = true;
      centerY = true;
      break;
    case "width":
      fitScale = ratioW;
      break;
    case "height":
      fitScale = ratioH;
      break;
  }
  const scaledMasterW = masterW * fitScale;
  const scaledMasterH = masterH * fitScale;
  const offsetX = centerX ? (adaptW - scaledMasterW) / 2 : 0;
  const offsetY = centerY ? (adaptH - scaledMasterH) / 2 : 0;
  return {
    ...master,
    size: { w: adaptW, h: adaptH },
    layout: scaleLayoutConfig(master.layout, fitScale),
    children: master.children.map((c) =>
      scaleLayerUniform(c, fitScale, offsetX, offsetY),
    ),
  };
}

function scaleLayerUniform(
  layer: TemplateLayer,
  scale: number,
  offsetX: number,
  offsetY: number,
): TemplateLayer {
  const baseScaled = {
    position: {
      x: layer.position.x * scale + offsetX,
      y: layer.position.y * scale + offsetY,
    },
    size: { w: layer.size.w * scale, h: layer.size.h * scale },
    shadow: layer.shadow
      ? {
          x: layer.shadow.x * scale,
          y: layer.shadow.y * scale,
          blur: layer.shadow.blur * scale,
          color: layer.shadow.color,
        }
      : layer.shadow,
  };
  if (layer.type === "frame") {
    return {
      ...layer,
      ...baseScaled,
      cornerRadius:
        layer.cornerRadius != null ? layer.cornerRadius * scale : layer.cornerRadius,
      layout: scaleLayoutConfig(layer.layout, scale),
      // Children dentro de un frame mantienen sus coords RELATIVAS al frame.
      // Solo escalamos sus pos/size con el mismo factor; el offset (X,Y) del
      // root NO se propaga adentro porque el frame ya está en su posición
      // global escalada.
      children: layer.children.map((c) => scaleLayerUniform(c, scale, 0, 0)),
    };
  }
  if (layer.type === "text") {
    return {
      ...layer,
      ...baseScaled,
      style: {
        ...layer.style,
        fontSize: scaleFontSize(layer.style.fontSize, scale),
        lineHeight: layer.style.lineHeight, // unitless multiplier, NO escalar
        letterSpacing:
          layer.style.letterSpacing != null
            ? layer.style.letterSpacing * scale
            : layer.style.letterSpacing,
        backgroundCornerRadius:
          layer.style.backgroundCornerRadius != null
            ? layer.style.backgroundCornerRadius * scale
            : layer.style.backgroundCornerRadius,
        outline: layer.style.outline
          ? {
              color: layer.style.outline.color,
              width: layer.style.outline.width * scale,
            }
          : layer.style.outline,
      },
    };
  }
  if (layer.type === "image") {
    return {
      ...layer,
      ...baseScaled,
      cornerRadius:
        layer.cornerRadius != null ? layer.cornerRadius * scale : layer.cornerRadius,
    };
  }
  if (layer.type === "shape") {
    return {
      ...layer,
      ...baseScaled,
      cornerRadius:
        layer.cornerRadius != null ? layer.cornerRadius * scale : layer.cornerRadius,
      stroke: layer.stroke
        ? { color: layer.stroke.color, width: layer.stroke.width * scale }
        : layer.stroke,
    };
  }
  if (layer.type === "icon") {
    return {
      ...layer,
      ...baseScaled,
      strokeWidth:
        layer.strokeWidth != null ? layer.strokeWidth * scale : layer.strokeWidth,
    };
  }
  // TS estrecha a never acá — todos los tipos del union están cubiertos.
  // Si se agrega un nuevo LayerType, este path se vuelve alcanzable y TS
  // forzará a manejarlo arriba.
  return layer;
}

function scaleFontSize(
  fs: number | string | { min: number; max: number },
  scale: number,
): number | string | { min: number; max: number } {
  if (typeof fs === "number") return fs * scale;
  if (isFontSizeRange(fs)) return { min: fs.min * scale, max: fs.max * scale };
  // string token (e.g. "{scale.lg}") — sin info para escalar, dejar igual.
  // En la práctica, los layers escalados pixel-perfect deberían tener
  // fontSize numérico. Tokens dejan el comportamiento al brand-kit.
  return fs;
}

function scaleLayoutConfig(layout: { mode: string }, scale: number) {
  if (layout.mode !== "stack") return layout as never;
  const stack = layout as unknown as StackLayout;
  return {
    ...stack,
    padding: stack.padding.map((p) => (typeof p === "number" ? p * scale : p)) as StackLayout["padding"],
    gap: typeof stack.gap === "number" ? stack.gap * scale : stack.gap,
  };
}
