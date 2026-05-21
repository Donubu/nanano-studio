// Animation timeline for templates. Keyframe-based, igual al modelo de
// After Effects / Cape / Bannerflow: cada layer puede tener N tracks (uno
// por propiedad animada) y cada track una serie de keyframes con
// { tiempo, valor, easing-hacia-el-siguiente }.
//
// El timeline vive en TemplateDefinition.animation (al nivel del root frame)
// y se aplica recursivamente a los layers por id. No se persiste en una
// columna nueva — ya se serializa con la definition entera.
//
// Runtime: applyAnimationAtTime(def, t) clona el árbol y deja los valores
// interpolados en cada layer. El renderer no necesita saber nada de
// animaciones — solo recibe un árbol con las propiedades estándar mutadas
// al instante deseado.
//
// Reflow: cuando una orientación linked recibe el reflow del master, los
// keyframes de position.x/y, size.w/h y blur se reescalan junto con el
// layout. opacity, scale, rotation y color son adimensionales y pasan
// inalterados. Eso permite diseñar la animación una vez en el master y
// propagarla a variantes y adapts.

import type { TemplateDefinition, TemplateLayer } from "./types";

// ---------- Tipos ----------

export type AnimatableProperty =
  | "position.x"
  | "position.y"
  | "size.w"
  | "size.h"
  | "opacity"
  | "rotation"
  | "scale"      // uniforme; multiplica scaleX y scaleY si no están set
  | "scale.x"
  | "scale.y"
  | "blur"       // radio en px (filter: blur)
  | "color";     // text.style.color / shape.fill / icon.color

export type EasingPreset =
  | "linear"
  | "ease"
  | "ease-in"
  | "ease-out"
  | "ease-in-out";

export type Easing =
  | EasingPreset
  | { type: "cubic-bezier"; values: [number, number, number, number] };

export interface Keyframe {
  // ms desde el inicio del loop. >= 0. Dentro de un track no puede haber
  // dos keyframes con el mismo t — los helpers de mutación dedupean.
  t: number;
  // number para todas las props excepto color, que usa string (hex/rgba/token).
  value: number | string;
  // Easing HACIA EL SIGUIENTE keyframe. El del último keyframe se ignora.
  easing: Easing;
}

export interface AnimationTrack {
  layerId: string;
  property: AnimatableProperty;
  // Ordenados por t asc, sin duplicados de t.
  keyframes: Keyframe[];
}

export interface AnimationConfig {
  // Duración total del loop en ms.
  duration: number;
  // Iteraciones. IAB Display ad spec cap = 3. "infinite" deja que el
  // placement decida cuándo cortar.
  loop: number | "infinite";
  tracks: AnimationTrack[];
}

// ---------- Constructors ----------

export function newAnimationConfig(): AnimationConfig {
  return { duration: 3000, loop: 3, tracks: [] };
}

// ---------- Easing ----------

const EASING_PRESETS: Record<EasingPreset, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

export function easingToBezier(
  easing: Easing,
): [number, number, number, number] {
  if (typeof easing === "string") return EASING_PRESETS[easing];
  return easing.values;
}

// Convierte un easing al string CSS equivalente para emitir en WAAPI o CSS
// animation. linear se mapea directamente; los preset names tienen el mismo
// nombre en CSS; cubic-bezier custom se serializa.
export function easingToCss(easing: Easing): string {
  if (typeof easing === "string") return easing;
  const [a, b, c, d] = easing.values;
  return `cubic-bezier(${a}, ${b}, ${c}, ${d})`;
}

// Evalúa una curva de bezier para easing dado u in [0, 1].
//
// Para easing curves la convención es: P0=(0,0), P3=(1,1), P1=(x1,y1),
// P2=(x2,y2). Queremos resolver: dado X = u, encontrar el parámetro T tal
// que xBezier(T) = u, y devolver yBezier(T). Newton's method converge
// rápido en este rango.
export function evalEasing(easing: Easing, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const [x1, y1, x2, y2] = easingToBezier(easing);
  // Atajo lineal: si la curva es lineal exacta, return u.
  if (x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1) return u;
  let T = u;
  for (let i = 0; i < 8; i++) {
    const x = bezierAt(x1, x2, T);
    const dx = bezierDeriv(x1, x2, T);
    if (Math.abs(dx) < 1e-6) break;
    T = T - (x - u) / dx;
    if (T < 0) T = 0;
    else if (T > 1) T = 1;
  }
  return bezierAt(y1, y2, T);
}

function bezierAt(p1: number, p2: number, t: number): number {
  // B(t) = 3(1-t)²t·P1 + 3(1-t)t²·P2 + t³ (con P0=0, P3=1).
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function bezierDeriv(p1: number, p2: number, t: number): number {
  // dB/dt = 3(1-t)²·P1 + 6(1-t)t·(P2-P1) + 3t²·(1-P2).
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

// ---------- Interpolación de color ----------
//
// Soporta hex (#RGB / #RRGGBB / #RRGGBBAA) y rgb(a). Para tokens del brand
// kit ("{color.x}") no podemos interpolar sin resolver el token primero;
// devolvemos el más cercano al u dado (step a 0.5). El editor puede
// llamarse antes con tokens resueltos si necesita transición fluida.

export function interpolateColor(a: string, b: string, u: number): string {
  if (a.startsWith("{") || b.startsWith("{")) return u < 0.5 ? a : b;
  const ca = parseCssColor(a);
  const cb = parseCssColor(b);
  if (!ca || !cb) return u < 0.5 ? a : b;
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * u);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * u);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * u);
  const al = ca[3] + (cb[3] - ca[3]) * u;
  if (al < 1) return `rgba(${r}, ${g}, ${bl}, ${al.toFixed(3)})`;
  return rgbToHex(r, g, bl);
}

function parseCssColor(s: string): [number, number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (hex) {
    const v = hex[1];
    if (v.length === 3) {
      return [
        parseInt(v[0] + v[0], 16),
        parseInt(v[1] + v[1], 16),
        parseInt(v[2] + v[2], 16),
        1,
      ];
    }
    if (v.length === 6) {
      return [
        parseInt(v.slice(0, 2), 16),
        parseInt(v.slice(2, 4), 16),
        parseInt(v.slice(4, 6), 16),
        1,
      ];
    }
    return [
      parseInt(v.slice(0, 2), 16),
      parseInt(v.slice(2, 4), 16),
      parseInt(v.slice(4, 6), 16),
      parseInt(v.slice(6, 8), 16) / 255,
    ];
  }
  const rgba = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/i.exec(s);
  if (rgba) {
    return [
      Number(rgba[1]),
      Number(rgba[2]),
      Number(rgba[3]),
      rgba[4] != null ? Number(rgba[4]) : 1,
    ];
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// ---------- Sampling ----------
//
// sampleTrack devuelve el valor interpolado del track en el tiempo t. Si
// no hay keyframes, devuelve el fallback (típicamente el valor base del
// layer). Si t cae antes del primer / después del último, clampea al
// extremo correspondiente — sin extrapolación.

export function sampleTrack(
  track: AnimationTrack,
  t: number,
  fallback: number | string,
): number | string {
  const kf = track.keyframes;
  if (kf.length === 0) return fallback;
  if (t <= kf[0].t) return kf[0].value;
  if (t >= kf[kf.length - 1].t) return kf[kf.length - 1].value;
  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i];
    const b = kf[i + 1];
    if (t >= a.t && t < b.t) {
      const seg = b.t - a.t;
      if (seg <= 0) return b.value;
      const u = (t - a.t) / seg;
      const eased = evalEasing(a.easing, u);
      if (typeof a.value === "number" && typeof b.value === "number") {
        return a.value + (b.value - a.value) * eased;
      }
      if (typeof a.value === "string" && typeof b.value === "string") {
        return interpolateColor(a.value, b.value, eased);
      }
      // Type mismatch entre keyframes — no interpolamos, holdeamos al a.
      return a.value;
    }
  }
  return fallback;
}

// ---------- Apply ----------
//
// applyAnimationAtTime clona el árbol y deja cada layer con sus
// propiedades animadas evaluadas en el instante t. El renderer no necesita
// saber nada de animaciones; recibe un árbol "snapshot" con campos
// estándar mutados.
//
// t fuera del rango [0, duration] se clampea (no hay extrapolación).
// Si la def no tiene animation o tracks, devuelve la def original (misma
// referencia — no clonamos para no romper memos del renderer).

export function applyAnimationAtTime(
  def: TemplateDefinition,
  t: number,
): TemplateDefinition {
  if (!def.animation || def.animation.tracks.length === 0) return def;
  const animation = def.animation;
  const byLayer = new Map<string, AnimationTrack[]>();
  for (const tr of animation.tracks) {
    let list = byLayer.get(tr.layerId);
    if (!list) {
      list = [];
      byLayer.set(tr.layerId, list);
    }
    list.push(tr);
  }
  const tClamped = Math.max(0, Math.min(animation.duration, t));
  return applyToLayerTree(def, tClamped, byLayer) as TemplateDefinition;
}

function applyToLayerTree(
  layer: TemplateLayer,
  t: number,
  byLayer: Map<string, AnimationTrack[]>,
): TemplateLayer {
  const tracks = byLayer.get(layer.id);
  let next: TemplateLayer = layer;
  if (tracks && tracks.length > 0) {
    next = cloneLayerShallow(layer);
    for (const track of tracks) {
      const base = getBaseValue(next, track.property);
      const value = sampleTrack(track, t, base);
      applyPropertyToLayer(next, track.property, value);
    }
  }
  if (next.type === "frame") {
    return {
      ...next,
      children: next.children.map((c) => applyToLayerTree(c, t, byLayer)),
    };
  }
  return next;
}

function cloneLayerShallow(layer: TemplateLayer): TemplateLayer {
  // Clonamos las propiedades planas que applyPropertyToLayer puede mutar
  // sin afectar al original. style/fill objects se clonan solo cuando
  // color track existe en este layer; para keep simple los clonamos
  // siempre que el layer tenga tracks.
  const base = {
    ...layer,
    position: { ...layer.position },
    size: { ...layer.size },
  };
  if (layer.type === "text") {
    return { ...base, style: { ...layer.style } } as TemplateLayer;
  }
  return base;
}

function getBaseValue(
  layer: TemplateLayer,
  property: AnimatableProperty,
): number | string {
  switch (property) {
    case "position.x":
      return layer.position.x;
    case "position.y":
      return layer.position.y;
    case "size.w":
      return layer.size.w;
    case "size.h":
      return layer.size.h;
    case "opacity":
      return layer.opacity ?? 1;
    case "rotation":
      return layer.rotation ?? 0;
    case "scale":
      return layer.scale ?? 1;
    case "scale.x":
      return layer.scaleX ?? 1;
    case "scale.y":
      return layer.scaleY ?? 1;
    case "blur":
      return layer.blur ?? 0;
    case "color": {
      if (layer.type === "text") return layer.style.color;
      if (layer.type === "shape" && typeof layer.fill === "string") {
        return layer.fill;
      }
      if (layer.type === "icon") return layer.color;
      return "#000000";
    }
  }
}

function applyPropertyToLayer(
  layer: TemplateLayer,
  property: AnimatableProperty,
  value: number | string,
): void {
  switch (property) {
    case "position.x":
      layer.position.x = value as number;
      break;
    case "position.y":
      layer.position.y = value as number;
      break;
    case "size.w":
      layer.size.w = value as number;
      break;
    case "size.h":
      layer.size.h = value as number;
      break;
    case "opacity":
      layer.opacity = value as number;
      break;
    case "rotation":
      layer.rotation = value as number;
      break;
    case "scale":
      layer.scale = value as number;
      break;
    case "scale.x":
      layer.scaleX = value as number;
      break;
    case "scale.y":
      layer.scaleY = value as number;
      break;
    case "blur":
      layer.blur = value as number;
      break;
    case "color":
      if (layer.type === "text") {
        layer.style.color = value as string;
      } else if (layer.type === "shape" && typeof layer.fill === "string") {
        layer.fill = value as string;
      } else if (layer.type === "icon") {
        layer.color = value as string;
      }
      break;
  }
}

// ---------- Mutación (CRUD para el editor) ----------
//
// Las funciones devuelven un AnimationConfig nuevo (inmutable). Mantienen
// el invariante de keyframes ordenados por t y sin duplicados de t por
// (layerId, property).

export function addKeyframe(
  config: AnimationConfig,
  layerId: string,
  property: AnimatableProperty,
  keyframe: Keyframe,
): AnimationConfig {
  const trackIdx = config.tracks.findIndex(
    (tr) => tr.layerId === layerId && tr.property === property,
  );
  if (trackIdx === -1) {
    return {
      ...config,
      tracks: [...config.tracks, { layerId, property, keyframes: [keyframe] }],
    };
  }
  const existing = config.tracks[trackIdx];
  // Si ya hay un keyframe en este t, reemplazamos.
  const sameTIdx = existing.keyframes.findIndex((k) => k.t === keyframe.t);
  const nextKfs =
    sameTIdx !== -1
      ? existing.keyframes.map((k, i) => (i === sameTIdx ? keyframe : k))
      : [...existing.keyframes, keyframe].sort((a, b) => a.t - b.t);
  const nextTrack: AnimationTrack = { ...existing, keyframes: nextKfs };
  return {
    ...config,
    tracks: config.tracks.map((tr, i) => (i === trackIdx ? nextTrack : tr)),
  };
}

export function removeKeyframe(
  config: AnimationConfig,
  layerId: string,
  property: AnimatableProperty,
  t: number,
): AnimationConfig {
  const trackIdx = config.tracks.findIndex(
    (tr) => tr.layerId === layerId && tr.property === property,
  );
  if (trackIdx === -1) return config;
  const existing = config.tracks[trackIdx];
  const nextKfs = existing.keyframes.filter((k) => k.t !== t);
  if (nextKfs.length === 0) {
    // Track sin keyframes — descartar el track entero.
    return {
      ...config,
      tracks: config.tracks.filter((_, i) => i !== trackIdx),
    };
  }
  const nextTrack: AnimationTrack = { ...existing, keyframes: nextKfs };
  return {
    ...config,
    tracks: config.tracks.map((tr, i) => (i === trackIdx ? nextTrack : tr)),
  };
}

// Mueve un keyframe a un nuevo t dentro del mismo track. Si el nuevo t
// colisiona con otro keyframe existente, ese otro se sobreescribe (último
// gana). El editor debería avisar visualmente antes de llamar a esta
// función si va a sobreescribir.
export function moveKeyframe(
  config: AnimationConfig,
  layerId: string,
  property: AnimatableProperty,
  fromT: number,
  toT: number,
): AnimationConfig {
  const trackIdx = config.tracks.findIndex(
    (tr) => tr.layerId === layerId && tr.property === property,
  );
  if (trackIdx === -1) return config;
  const existing = config.tracks[trackIdx];
  const target = existing.keyframes.find((k) => k.t === fromT);
  if (!target) return config;
  const without = existing.keyframes.filter((k) => k.t !== fromT && k.t !== toT);
  const moved: Keyframe = { ...target, t: toT };
  const nextKfs = [...without, moved].sort((a, b) => a.t - b.t);
  const nextTrack: AnimationTrack = { ...existing, keyframes: nextKfs };
  return {
    ...config,
    tracks: config.tracks.map((tr, i) => (i === trackIdx ? nextTrack : tr)),
  };
}

// Actualiza el value/easing de un keyframe sin moverlo en el tiempo.
export function updateKeyframe(
  config: AnimationConfig,
  layerId: string,
  property: AnimatableProperty,
  t: number,
  patch: Partial<Pick<Keyframe, "value" | "easing">>,
): AnimationConfig {
  const trackIdx = config.tracks.findIndex(
    (tr) => tr.layerId === layerId && tr.property === property,
  );
  if (trackIdx === -1) return config;
  const existing = config.tracks[trackIdx];
  const nextKfs = existing.keyframes.map((k) =>
    k.t === t ? { ...k, ...patch } : k,
  );
  const nextTrack: AnimationTrack = { ...existing, keyframes: nextKfs };
  return {
    ...config,
    tracks: config.tracks.map((tr, i) => (i === trackIdx ? nextTrack : tr)),
  };
}

// Elimina todos los tracks de un layer. Se llama cuando el productor borra
// el layer en el canvas — no queremos dejar tracks huérfanos.
export function removeTracksForLayer(
  config: AnimationConfig,
  layerId: string,
): AnimationConfig {
  const next = config.tracks.filter((tr) => tr.layerId !== layerId);
  if (next.length === config.tracks.length) return config;
  return { ...config, tracks: next };
}
