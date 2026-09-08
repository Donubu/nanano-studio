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
} from "./types";
import { adaptTree } from "./adapt";
import { scaleLayerUniform, scaleLayoutConfig } from "./scale";
import { FitMode } from "./fit-mode";
import {
  AnimationConfig,
  AnimationTrack,
  AnimatableProperty,
} from "./animation";

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
  return adaptTree(master, { w: adaptW, h: adaptH });
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
    return adaptTree(master, { w: adaptW, h: adaptH });
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
    animation: master.animation
      ? scaleAnimationUniform(master.animation, fitScale, offsetX, offsetY)
      : master.animation,
  };
}

// Aplica el mismo scale-uniform que scaleLayerUniform a los keyframes del
// timeline. Diferencia con reflowAnimation (en reflow.ts): el reflow usa
// dos factores (sx, sy) porque el aspect ratio cambia entre orientaciones;
// acá usamos UN solo factor (fitScale) porque la idea del fit scale-based
// es preservar el aspecto del master entero — los layers no se deforman
// individualmente. Las posiciones suman offsetX/Y para mantener el master
// centrado dentro del adapt.
function scaleAnimationUniform(
  animation: AnimationConfig,
  scale: number,
  offsetX: number,
  offsetY: number,
): AnimationConfig {
  return {
    ...animation,
    tracks: animation.tracks.map((track) =>
      scaleTrackUniform(track, track.property, scale, offsetX, offsetY),
    ),
  };
}

function scaleTrackUniform(
  track: AnimationTrack,
  property: AnimatableProperty,
  scale: number,
  offsetX: number,
  offsetY: number,
): AnimationTrack {
  switch (property) {
    case "position.x":
      return {
        ...track,
        keyframes: track.keyframes.map((k) => ({
          ...k,
          value:
            typeof k.value === "number" ? k.value * scale + offsetX : k.value,
        })),
      };
    case "position.y":
      return {
        ...track,
        keyframes: track.keyframes.map((k) => ({
          ...k,
          value:
            typeof k.value === "number" ? k.value * scale + offsetY : k.value,
        })),
      };
    case "size.w":
    case "size.h":
    case "blur":
      return {
        ...track,
        keyframes: track.keyframes.map((k) => ({
          ...k,
          value: typeof k.value === "number" ? k.value * scale : k.value,
        })),
      };
    default:
      // opacity, scale, scale.x/y, rotation, color → adimensionales, sin cambio.
      return track;
  }
}
