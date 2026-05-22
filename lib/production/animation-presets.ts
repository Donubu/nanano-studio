// Animation presets. Curated set of "one-click" animations que cubren los
// patrones más usados en banners (entradas, énfasis del CTA, jerarquía
// secuencial). Cada preset es una función pura que toma la
// TemplateDefinition y devuelve un AnimationConfig listo para asignar al
// root del template.
//
// Las heurísticas para detectar "hero text" o "CTA" son intencionalmente
// laxas: si fallan en algún master atípico, el productor puede aplicar el
// preset y reasignar tracks a mano desde el editor. El costo del preset es
// trivial vs explicar al productor cómo construir cada uno desde cero.

import {
  AnimationConfig,
  AnimationTrack,
  Keyframe,
} from "./animation";
import type { TemplateDefinition, TemplateLayer, TextLayer } from "./types";
import { isFontSizeRange } from "./types";

export interface AnimationPreset {
  id: string;
  label: string;
  description: string;
  build: (def: TemplateDefinition) => AnimationConfig;
}

// ---------- Helpers de detección ----------

// Layers de primer nivel (no anidados en frames). Los presets operan sobre
// estos porque son la unidad lógica del banner — bullets dentro de un
// frame raramente quieren animación individual.
function topLevelChildren(def: TemplateDefinition): TemplateLayer[] {
  return def.children.filter((c) => c.id !== "tpl_root");
}

// Heurística "CTA": text layer con backgroundColor seteado (= preset
// botón/badge/ribbon del editor). Fallback: último child top-level si
// ninguno califica.
function findCtaLayer(def: TemplateDefinition): TemplateLayer | null {
  const top = topLevelChildren(def);
  for (const c of top) {
    if (c.type === "text" && (c as TextLayer).style.backgroundColor) return c;
  }
  return top.length > 0 ? top[top.length - 1] : null;
}

// Heurística "hero text": text layer con el fontSize más grande del top
// level. Para FontSizeRange (smart-text), usamos el max del rango. Si no
// hay text layer, devuelve null.
function findHeroTextLayer(def: TemplateDefinition): TemplateLayer | null {
  let best: { layer: TemplateLayer; fs: number } | null = null;
  for (const c of topLevelChildren(def)) {
    if (c.type !== "text") continue;
    const t = c as TextLayer;
    const fs = isFontSizeRange(t.style.fontSize)
      ? t.style.fontSize.max
      : (t.style.fontSize as number);
    if (!best || fs > best.fs) best = { layer: c, fs };
  }
  return best?.layer ?? null;
}

// ---------- Builders ----------

// Fade in: todas las capas opacidad 0→1 simultáneamente. La entrada más
// universal — un default sensato cuando el productor solo quiere "que no
// sea estático".
function buildFadeIn(def: TemplateDefinition): AnimationConfig {
  const layers = topLevelChildren(def);
  const duration = 800;
  return {
    duration,
    loop: 1,
    tracks: layers.map((l) =>
      track(l.id, "opacity", [
        kf(0, 0, "ease-out"),
        kf(duration, 1, "linear"),
      ]),
    ),
  };
}

// Slide desde abajo: posición.y arranca offset y se desliza al base. Pide
// la base position de cada layer para calcular el offset (cae 80px desde
// su lugar final). 80px porque es visible sin sacar el layer del canvas
// en banners chicos.
function buildSlideFromBottom(def: TemplateDefinition): AnimationConfig {
  const layers = topLevelChildren(def);
  const duration = 700;
  const offset = 80;
  return {
    duration,
    loop: 1,
    tracks: layers.flatMap((l) => [
      track(l.id, "position.y", [
        kf(0, l.position.y + offset, "ease-out"),
        kf(duration, l.position.y, "linear"),
      ]),
      track(l.id, "opacity", [
        kf(0, 0, "ease-out"),
        kf(duration, 1, "linear"),
      ]),
    ]),
  };
}

// Slide desde izquierda: análogo en X. Los layers entran "from the left".
function buildSlideFromLeft(def: TemplateDefinition): AnimationConfig {
  const layers = topLevelChildren(def);
  const duration = 700;
  const offset = 120;
  return {
    duration,
    loop: 1,
    tracks: layers.flatMap((l) => [
      track(l.id, "position.x", [
        kf(0, l.position.x - offset, "ease-out"),
        kf(duration, l.position.x, "linear"),
      ]),
      track(l.id, "opacity", [
        kf(0, 0, "ease-out"),
        kf(duration, 1, "linear"),
      ]),
    ]),
  };
}

// Aparición secuencial (stagger): cada layer aparece uno tras otro con un
// delay. Útil para banners con jerarquía clara (logo → headline → CTA).
// El orden sigue el de los top-level children — el productor controla via
// reorder en el LayersPanel.
function buildSequentialReveal(def: TemplateDefinition): AnimationConfig {
  const layers = topLevelChildren(def);
  const stagger = 250;
  const fadeMs = 600;
  const totalDuration = stagger * Math.max(0, layers.length - 1) + fadeMs;
  return {
    duration: totalDuration,
    loop: 1,
    tracks: layers.map((l, i) => {
      const startT = i * stagger;
      return track(l.id, "opacity", [
        kf(startT, 0, "ease-out"),
        kf(startT + fadeMs, 1, "linear"),
      ]);
    }),
  };
}

// Hero pop-in: la capa principal (text más grande) escala 0.8→1 con
// opacity 0→1 en ease-out → sensación de "pop" como un menú emergente.
// Las demás capas hacen fade in normal (sin scale) para no robar atención.
function buildHeroPop(def: TemplateDefinition): AnimationConfig {
  const hero = findHeroTextLayer(def);
  const layers = topLevelChildren(def);
  const duration = 900;
  const tracks: AnimationTrack[] = [];
  for (const l of layers) {
    if (hero && l.id === hero.id) {
      tracks.push(
        track(l.id, "scale", [
          kf(0, 0.8, "ease-out"),
          kf(duration, 1, "linear"),
        ]),
        track(l.id, "opacity", [
          kf(0, 0, "ease-out"),
          kf(duration, 1, "linear"),
        ]),
      );
    } else {
      tracks.push(
        track(l.id, "opacity", [
          kf(200, 0, "ease-out"),
          kf(duration, 1, "linear"),
        ]),
      );
    }
  }
  return { duration, loop: 1, tracks };
}

// CTA latido: el botón hace un "breathe" continuo (scale 1→1.06→1). Loop
// infinito porque la idea es atraer la mirada al CTA mientras el banner
// está en pantalla. NO toca el resto de los layers — solo el CTA.
function buildCtaPulse(def: TemplateDefinition): AnimationConfig {
  const cta = findCtaLayer(def);
  const duration = 1400;
  if (!cta) {
    // Sin CTA detectado — devolvemos un timeline vacío con la duration
    // correcta. El productor entiende que el preset no aplicó y puede
    // elegir otro o agregar tracks a mano.
    return { duration, loop: "infinite", tracks: [] };
  }
  return {
    duration,
    loop: "infinite",
    tracks: [
      track(cta.id, "scale", [
        kf(0, 1, "ease-in-out"),
        kf(duration / 2, 1.06, "ease-in-out"),
        kf(duration, 1, "linear"),
      ]),
    ],
  };
}

// Fade + scale combinado: cada layer escala 0.92→1 con fade in. Más sutil
// que hero-pop (que solo afecta al hero), aplica el efecto en cascada
// suave a TODO el banner. "Spring entrance" estilo Bannerflow.
function buildSpringEntrance(def: TemplateDefinition): AnimationConfig {
  const layers = topLevelChildren(def);
  const duration = 800;
  return {
    duration,
    loop: 1,
    tracks: layers.flatMap((l) => [
      track(l.id, "scale", [
        kf(0, 0.92, "ease-out"),
        kf(duration, 1, "linear"),
      ]),
      track(l.id, "opacity", [
        kf(0, 0, "ease-out"),
        kf(duration, 1, "linear"),
      ]),
    ]),
  };
}

// ---------- Helpers internos ----------

function track(
  layerId: string,
  property: AnimationTrack["property"],
  keyframes: Keyframe[],
): AnimationTrack {
  return { layerId, property, keyframes };
}

function kf(t: number, value: number | string, easing: Keyframe["easing"]): Keyframe {
  return { t, value, easing };
}

// ---------- Registry ----------

export const ANIMATION_PRESETS: AnimationPreset[] = [
  {
    id: "fade-in",
    label: "Fade in",
    description: "Todas las capas aparecen con un fade simultáneo",
    build: buildFadeIn,
  },
  {
    id: "spring-entrance",
    label: "Spring entrance",
    description: "Fade + scale sutil en cascada (estilo Bannerflow)",
    build: buildSpringEntrance,
  },
  {
    id: "slide-bottom",
    label: "Slide desde abajo",
    description: "Las capas se deslizan hacia arriba desde abajo",
    build: buildSlideFromBottom,
  },
  {
    id: "slide-left",
    label: "Slide desde izquierda",
    description: "Las capas entran deslizándose desde la izquierda",
    build: buildSlideFromLeft,
  },
  {
    id: "sequential-reveal",
    label: "Aparición secuencial",
    description: "Cada capa aparece con un delay (logo → headline → CTA)",
    build: buildSequentialReveal,
  },
  {
    id: "hero-pop",
    label: "Hero pop-in",
    description: "El texto más grande escala 0.8→1, el resto fade",
    build: buildHeroPop,
  },
  {
    id: "cta-pulse",
    label: "CTA latido",
    description: "El botón hace un breathe continuo (loop infinito)",
    build: buildCtaPulse,
  },
];

export function findPresetById(id: string): AnimationPreset | null {
  return ANIMATION_PRESETS.find((p) => p.id === id) ?? null;
}
