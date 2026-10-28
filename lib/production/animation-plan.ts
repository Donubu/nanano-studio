// Coreografías de animación → AnimationConfig.
//
// "Animar con IA" no le pide al modelo keyframes: el modelo decide, por capa,
// qué entrada usar, cuándo empieza, cuánto dura y si tiene un énfasis después
// (latido, flotación). Este módulo traduce esa coreografía a tracks con los
// mismos patrones que los presets (animation-presets.ts), con offsets
// proporcionales al formato. Puro: corre en server y en tests.

import { AnimationConfig, AnimationTrack, AnimatableProperty, Easing, Keyframe } from "./animation";
import type { TemplateDefinition, TemplateLayer } from "./types";

export const ENTRANCES = [
  "none",
  "fade",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "scale-in",
  "pop",
  "blur-in",
] as const;
export type Entrance = (typeof ENTRANCES)[number];

export const EMPHASES = ["none", "pulse", "float"] as const;
export type Emphasis = (typeof EMPHASES)[number];

export interface LayerChoreography {
  id: string;
  entrance: Entrance;
  start_ms: number;
  duration_ms: number;
  emphasis: Emphasis;
}

export interface AnimationPlan {
  duration_ms: number;
  loop: number | "infinite";
  layers: LayerChoreography[];
  rationale: string;
}

const MIN_DURATION = 1000;
const MAX_DURATION = 30000;
// IAB: máximo 3 loops; "infinite" solo si la pieza lo pide (latido del CTA).
const MAX_LOOPS = 3;

function topLevel(def: TemplateDefinition): Map<string, TemplateLayer> {
  return new Map(def.children.map((c) => [c.id, c]));
}

// Normaliza lo que devuelve el modelo: capas inexistentes fuera, tiempos
// dentro de la duración, loop dentro del tope IAB.
export function sanitizeAnimationPlan(raw: unknown, def: TemplateDefinition): AnimationPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const layersById = topLevel(def);
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const duration = Math.round(Math.min(MAX_DURATION, Math.max(MIN_DURATION, num(p.duration_ms, 4000))));
  const loop =
    p.loop === "infinite" ? "infinite" : Math.round(Math.min(MAX_LOOPS, Math.max(1, num(p.loop, 1))));
  const seen = new Set<string>();
  const layers: LayerChoreography[] = [];
  for (const item of Array.isArray(p.layers) ? p.layers : []) {
    const l = (item ?? {}) as Record<string, unknown>;
    const id = typeof l.id === "string" ? l.id : "";
    if (!layersById.has(id) || seen.has(id)) continue;
    seen.add(id);
    const entrance = (ENTRANCES as readonly string[]).includes(l.entrance as string) ? (l.entrance as Entrance) : "fade";
    const emphasis = (EMPHASES as readonly string[]).includes(l.emphasis as string) ? (l.emphasis as Emphasis) : "none";
    const start = Math.round(Math.min(duration - 100, Math.max(0, num(l.start_ms, 0))));
    const dur = Math.round(Math.min(duration - start, Math.max(100, num(l.duration_ms, 600))));
    layers.push({ id, entrance, start_ms: start, duration_ms: dur, emphasis });
  }
  if (layers.length === 0) return null;
  return { duration_ms: duration, loop, layers, rationale: typeof p.rationale === "string" ? p.rationale : "" };
}

type KeyMap = Map<string, Keyframe[]>;

function push(map: KeyMap, layerId: string, prop: AnimatableProperty, t: number, value: number, easing: Easing) {
  const key = `${layerId}|${prop}`;
  const list = map.get(key) ?? [];
  list.push({ t: Math.round(t), value, easing });
  map.set(key, list);
}

// ---------------------------------------------------------------------------
// Grupos visuales
// ---------------------------------------------------------------------------
//
// Un texto sobre una franja, o el precio y el legal sobre su caja, son UNA
// pieza visual aunque sean capas distintas: si cada una entra por su lado,
// el texto queda fuera de la franja durante la entrada o palpita solo y se
// sale de su caja. Contenedor = forma (no un fondo a sangre); miembros = las
// capas que van encima y dentro de ella, y las pegadas a su borde (el logo
// junto a la caja de precio).

type Box = { x: number; y: number; w: number; h: number };
const boxOf = (l: TemplateLayer): Box => ({ x: l.position.x, y: l.position.y, w: l.size.w, h: l.size.h });
const overlap1d = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

export interface VisualGroupMember {
  anchor: string;
  // "inside": encima y dentro del contenedor; "beside": pegado a su borde.
  kind: "inside" | "beside";
}

export function visualGroups(def: TemplateDefinition): Map<string, VisualGroupMember> {
  const kids = def.children.filter((c) => c.visible !== false);
  const frameArea = def.size.w * def.size.h;
  // "Pegado": hasta ~3,5% del lado corto de separación (en un vertical el
  // logo suele quedar a 30 px de la caja de precio y sigue siendo un bloque).
  const touch = Math.max(2, Math.min(def.size.w, def.size.h) * 0.035);
  const containers = kids
    .map((c, i) => ({ c, i, b: boxOf(c) }))
    .filter(({ c, b }) => c.type === "shape" && b.w * b.h < frameArea * 0.6);
  const anchorOf = new Map<string, VisualGroupMember>();
  kids.forEach((m, i) => {
    const b = boxOf(m);
    const area = Math.max(1, b.w * b.h);
    let best: { id: string; area: number; kind: "inside" | "beside" } | null = null;
    for (const k of containers) {
      if (k.c.id === m.id) continue;
      const kb = k.b;
      const kArea = kb.w * kb.h;
      const inside = (overlap1d(b.x, b.x + b.w, kb.x, kb.x + kb.w) * overlap1d(b.y, b.y + b.h, kb.y, kb.y + kb.h)) / area;
      const contained = k.i < i && inside >= 0.9 && kArea > area * 1.2;
      // Pegado a un borde, con al menos 70% de solape en el otro eje.
      const gapX = Math.max(kb.x - (b.x + b.w), b.x - (kb.x + kb.w));
      const gapY = Math.max(kb.y - (b.y + b.h), b.y - (kb.y + kb.h));
      const vOverlap = overlap1d(b.y, b.y + b.h, kb.y, kb.y + kb.h) / Math.max(1, Math.min(b.h, kb.h));
      const hOverlap = overlap1d(b.x, b.x + b.w, kb.x, kb.x + kb.w) / Math.max(1, Math.min(b.w, kb.w));
      // Solo lo más chico que el contenedor (el logo junto a la caja), no la
      // foto que toca la franja de arriba.
      // Una forma solo es "vecina" de otra más grande (la placa del logo junto
      // a la caja de precio), nunca contenida por proximidad.
      const adjacent =
        inside < 0.9 &&
        area <= kArea * (m.type === "shape" ? 1 : 1.5) &&
        ((gapX <= touch && gapX >= -touch && vOverlap >= 0.7) || (gapY <= touch && gapY >= -touch && hOverlap >= 0.7));
      if (!contained && !adjacent) continue;
      const kind = contained ? "inside" : "beside";
      // Dentro gana a al lado; entre iguales, el contenedor más chico.
      const better =
        !best || (kind === "inside" && best.kind === "beside") || (kind === best.kind && kArea < best.area);
      if (better) best = { id: k.c.id, area: kArea, kind };
    }
    if (best) anchorOf.set(m.id, { anchor: best.id, kind: best.kind });
  });
  // Cadenas (logo → placa → caja de precio): todos al contenedor raíz. Basta
  // con que un eslabón sea "al lado" para que el miembro cuente como al lado.
  const resolved = new Map<string, VisualGroupMember>();
  for (const [id, g] of anchorOf) {
    let cur = g;
    let kind = g.kind;
    const seen = new Set([id]);
    while (anchorOf.has(cur.anchor) && !seen.has(cur.anchor)) {
      seen.add(cur.anchor);
      cur = anchorOf.get(cur.anchor)!;
      if (cur.kind === "beside") kind = "beside";
    }
    resolved.set(id, { anchor: cur.anchor, kind });
  }
  return resolved;
}

// Coreografía efectiva: cada miembro de un grupo entra con su contenedor; el
// énfasis que se pidió para cualquier capa del grupo lo hacen el contenedor y
// lo que va dentro. Cada capa escala desde su propio centro, así que en un
// grupo con capas al lado una entrada por escala las separa: se cambia por
// una subida, y el latido por una flotación del grupo entero.
const SCALE_ENTRANCES = new Set<Entrance>(["pop", "scale-in"]);

function effectiveLayers(def: TemplateDefinition, plan: AnimationPlan): LayerChoreography[] {
  const groups = visualGroups(def);
  const byId = new Map(plan.layers.map((c) => [c.id, c]));
  const groupEmphasis = new Map<string, Emphasis>();
  const hasBeside = new Set<string>();
  for (const [, g] of groups) if (g.kind === "beside") hasBeside.add(g.anchor);
  for (const c of plan.layers) {
    const anchor = groups.get(c.id)?.anchor ?? c.id;
    if (c.emphasis !== "none" && !groupEmphasis.has(anchor)) groupEmphasis.set(anchor, c.emphasis);
  }
  const out: LayerChoreography[] = [];
  for (const l of def.children) {
    const g = groups.get(l.id);
    const anchor = g ? byId.get(g.anchor) : undefined;
    const base = anchor ?? byId.get(l.id);
    if (!base) continue;
    const key = g?.anchor ?? l.id;
    const entrance = hasBeside.has(key) && SCALE_ENTRANCES.has(base.entrance) ? "slide-up" : base.entrance;
    let emphasis: Emphasis = groupEmphasis.get(key) ?? (anchor ? "none" : base.emphasis);
    // Con capas al lado, el latido haría que la caja crezca encima del logo:
    // el grupo entero flota (todas se mueven lo mismo).
    if (hasBeside.has(key) && emphasis === "pulse") emphasis = "float";
    out.push({ ...base, id: l.id, entrance, emphasis });
  }
  return out;
}

export function buildAnimationFromPlan(def: TemplateDefinition, plan: AnimationPlan): AnimationConfig {
  const layersById = topLevel(def);
  // Desplazamiento de los slides: 8% del lado corto, mínimo 12px. Así un
  // 300×250 y un 1920×1080 se sienten igual.
  const offset = Math.max(12, Math.round(Math.min(def.size.w, def.size.h) * 0.08));
  const map: KeyMap = new Map();

  for (const c of effectiveLayers(def, plan)) {
    const l = layersById.get(c.id);
    if (!l) continue;
    const t0 = c.start_ms;
    const t1 = c.start_ms + c.duration_ms;
    const { x, y } = l.position;
    const fade = () => {
      push(map, l.id, "opacity", t0, 0, "ease-out");
      push(map, l.id, "opacity", t1, 1, "linear");
    };
    switch (c.entrance) {
      case "none":
        break;
      case "fade":
        fade();
        break;
      case "slide-up":
      case "slide-down":
        push(map, l.id, "position.y", t0, c.entrance === "slide-up" ? y + offset : y - offset, "ease-out");
        push(map, l.id, "position.y", t1, y, "linear");
        fade();
        break;
      case "slide-left":
      case "slide-right":
        // slide-left = entra desde la izquierda (viaja hacia la derecha).
        push(map, l.id, "position.x", t0, c.entrance === "slide-left" ? x - offset : x + offset, "ease-out");
        push(map, l.id, "position.x", t1, x, "linear");
        fade();
        break;
      case "scale-in":
        push(map, l.id, "scale", t0, 0.85, "ease-out");
        push(map, l.id, "scale", t1, 1, "linear");
        fade();
        break;
      case "pop":
        push(map, l.id, "scale", t0, 0.6, "ease-out");
        push(map, l.id, "scale", t0 + c.duration_ms * 0.7, 1.08, "ease-in-out");
        push(map, l.id, "scale", t1, 1, "linear");
        fade();
        break;
      case "blur-in":
        push(map, l.id, "blur", t0, 12, "ease-out");
        push(map, l.id, "blur", t1, 0, "linear");
        fade();
        break;
    }

    // Énfasis: después de la entrada, hasta el final del loop, un ciclo
    // suave cada ~1.4 s (máx. 3 para no marear).
    if (c.emphasis !== "none") {
      const cycle = 1400;
      const from = t1 + 200;
      const cycles = Math.min(3, Math.floor((plan.duration_ms - from) / cycle));
      for (let i = 0; i < cycles; i++) {
        const a = from + i * cycle;
        if (c.emphasis === "pulse") {
          push(map, l.id, "scale", a, 1, "ease-in-out");
          push(map, l.id, "scale", a + cycle / 2, 1.06, "ease-in-out");
          push(map, l.id, "scale", a + cycle, 1, "linear");
        } else {
          push(map, l.id, "position.y", a, y, "ease-in-out");
          push(map, l.id, "position.y", a + cycle / 2, y - Math.max(3, Math.round(offset * 0.15)), "ease-in-out");
          push(map, l.id, "position.y", a + cycle, y, "linear");
        }
      }
    }
  }

  const tracks: AnimationTrack[] = [];
  for (const [key, kfs] of map) {
    const [layerId, property] = key.split("|") as [string, AnimatableProperty];
    // Orden por t y sin t repetidos (gana el último: el énfasis arranca
    // donde terminó la entrada con el mismo valor).
    const byT = new Map<number, Keyframe>();
    for (const k of kfs.sort((a, b) => a.t - b.t)) byT.set(k.t, k);
    tracks.push({ layerId, property, keyframes: [...byT.values()] });
  }
  return { duration: plan.duration_ms, loop: plan.loop, tracks };
}
