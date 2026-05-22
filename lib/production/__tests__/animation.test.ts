import { describe, it, expect } from "vitest";
import {
  AnimationConfig,
  AnimationTrack,
  addKeyframe,
  applyAnimationAtTime,
  easingToCss,
  evalEasing,
  interpolateColor,
  moveKeyframe,
  newAnimationConfig,
  removeKeyframe,
  removeTracksForLayer,
  sampleTrack,
  updateKeyframe,
} from "../animation";
import { reflowAnimation, reflowForPreview } from "../reflow";
import { buildInitialFromAdaptFit } from "../overrides";
import type { TemplateDefinition, TemplateLayer } from "../types";

// Helper para armar un track rápido. easing default = linear.
function trackOf(
  layerId: string,
  property: AnimationTrack["property"],
  ...keyframes: { t: number; value: number | string }[]
): AnimationTrack {
  return {
    layerId,
    property,
    keyframes: keyframes.map((k) => ({ ...k, easing: "linear" as const })),
  };
}

describe("sampleTrack", () => {
  it("retorna fallback si no hay keyframes", () => {
    const tr: AnimationTrack = { layerId: "l1", property: "opacity", keyframes: [] };
    expect(sampleTrack(tr, 100, 0.5)).toBe(0.5);
  });

  it("clampea al primer keyframe si t < first.t", () => {
    const tr = trackOf("l1", "opacity", { t: 100, value: 0.3 }, { t: 500, value: 1 });
    expect(sampleTrack(tr, 0, 999)).toBe(0.3);
  });

  it("clampea al último keyframe si t > last.t", () => {
    const tr = trackOf("l1", "opacity", { t: 100, value: 0.3 }, { t: 500, value: 1 });
    expect(sampleTrack(tr, 9999, 999)).toBe(1);
  });

  it("interpola linealmente entre dos keyframes numéricos", () => {
    const tr = trackOf("l1", "position.x", { t: 0, value: 0 }, { t: 1000, value: 100 });
    expect(sampleTrack(tr, 500, -1)).toBe(50);
    expect(sampleTrack(tr, 250, -1)).toBe(25);
  });

  it("interpola colores hex", () => {
    const tr = trackOf("l1", "color", { t: 0, value: "#000000" }, { t: 1000, value: "#ffffff" });
    const mid = sampleTrack(tr, 500, "#888888");
    expect(typeof mid).toBe("string");
    // Midpoint: rgb(128, 128, 128) → #808080.
    expect((mid as string).toLowerCase()).toBe("#808080");
  });
});

describe("evalEasing", () => {
  it("linear es identidad en u=0..1", () => {
    expect(evalEasing("linear", 0)).toBe(0);
    expect(evalEasing("linear", 0.5)).toBeCloseTo(0.5, 5);
    expect(evalEasing("linear", 1)).toBe(1);
  });

  it("ease-out arranca rápido y termina lento (output > input en u=0.5)", () => {
    // ease-out: cubic-bezier(0, 0, 0.58, 1) → la salida en 0.5 está adelantada.
    expect(evalEasing("ease-out", 0.5)).toBeGreaterThan(0.5);
  });

  it("ease-in arranca lento y termina rápido (output < input en u=0.5)", () => {
    expect(evalEasing("ease-in", 0.5)).toBeLessThan(0.5);
  });

  it("cubic-bezier custom respeta endpoints", () => {
    const e: { type: "cubic-bezier"; values: [number, number, number, number] } = {
      type: "cubic-bezier",
      values: [0.1, 0.9, 0.2, 0.8],
    };
    expect(evalEasing(e, 0)).toBe(0);
    expect(evalEasing(e, 1)).toBe(1);
  });
});

describe("easingToCss", () => {
  it("preserva preset names", () => {
    expect(easingToCss("ease-in")).toBe("ease-in");
    expect(easingToCss("linear")).toBe("linear");
  });

  it("serializa cubic-bezier", () => {
    const css = easingToCss({ type: "cubic-bezier", values: [0.25, 0.1, 0.25, 1] });
    expect(css).toBe("cubic-bezier(0.25, 0.1, 0.25, 1)");
  });
});

describe("interpolateColor", () => {
  it("u=0 devuelve a, u=1 devuelve b", () => {
    expect(interpolateColor("#ff0000", "#00ff00", 0).toLowerCase()).toBe("#ff0000");
    expect(interpolateColor("#ff0000", "#00ff00", 1).toLowerCase()).toBe("#00ff00");
  });

  it("rgba con alpha lerpea correctamente", () => {
    const mid = interpolateColor("rgba(255, 0, 0, 0)", "rgba(0, 255, 0, 1)", 0.5);
    expect(mid).toMatch(/rgba\(128, 128, 0, 0\.500\)/);
  });

  it("falla gracefully con tokens — devuelve uno de los dos", () => {
    const r = interpolateColor("{color.brand}", "#ffffff", 0.3);
    expect([r, "{color.brand}", "#ffffff"]).toContain(r);
  });
});

describe("applyAnimationAtTime", () => {
  const baseDef = (): TemplateDefinition => ({
    id: "tpl_root",
    type: "frame",
    position: { x: 0, y: 0 },
    size: { w: 1080, h: 1080 },
    layout: { mode: "free" },
    children: [
      {
        id: "logo",
        type: "shape",
        shape: "rect",
        position: { x: 100, y: 100 },
        size: { w: 200, h: 50 },
        fill: "#ff0000",
      },
    ],
  });

  it("devuelve la misma def si no hay animation (sin clonar)", () => {
    const def = baseDef();
    const result = applyAnimationAtTime(def, 100);
    expect(result).toBe(def);
  });

  it("aplica position.x sampleado a la mitad del timeline", () => {
    const def: TemplateDefinition = {
      ...baseDef(),
      animation: {
        duration: 1000,
        loop: 1,
        tracks: [trackOf("logo", "position.x", { t: 0, value: 100 }, { t: 1000, value: 500 })],
      },
    };
    const snap = applyAnimationAtTime(def, 500);
    const logo = snap.children[0];
    expect(logo.position.x).toBe(300); // 100 + (500-100)*0.5
    // Y no debería cambiar.
    expect(logo.position.y).toBe(100);
    // El base def no se mutó.
    expect(def.children[0].position.x).toBe(100);
  });

  it("aplica opacity sampleado", () => {
    const def: TemplateDefinition = {
      ...baseDef(),
      animation: {
        duration: 1000,
        loop: 1,
        tracks: [trackOf("logo", "opacity", { t: 0, value: 0 }, { t: 1000, value: 1 })],
      },
    };
    const snap = applyAnimationAtTime(def, 250);
    expect(snap.children[0].opacity).toBeCloseTo(0.25, 5);
  });

  it("clampea t fuera del rango [0, duration]", () => {
    const def: TemplateDefinition = {
      ...baseDef(),
      animation: {
        duration: 1000,
        loop: 1,
        tracks: [trackOf("logo", "opacity", { t: 0, value: 0.2 }, { t: 1000, value: 0.8 })],
      },
    };
    expect(applyAnimationAtTime(def, -500).children[0].opacity).toBe(0.2);
    expect(applyAnimationAtTime(def, 9999).children[0].opacity).toBe(0.8);
  });
});

describe("addKeyframe / removeKeyframe / moveKeyframe", () => {
  it("addKeyframe crea track si no existía", () => {
    const cfg = newAnimationConfig();
    const next = addKeyframe(cfg, "l1", "opacity", { t: 100, value: 0.5, easing: "linear" });
    expect(next.tracks).toHaveLength(1);
    expect(next.tracks[0].keyframes).toEqual([{ t: 100, value: 0.5, easing: "linear" }]);
  });

  it("addKeyframe mantiene orden por t", () => {
    let cfg = newAnimationConfig();
    cfg = addKeyframe(cfg, "l1", "opacity", { t: 500, value: 1, easing: "linear" });
    cfg = addKeyframe(cfg, "l1", "opacity", { t: 100, value: 0, easing: "linear" });
    cfg = addKeyframe(cfg, "l1", "opacity", { t: 300, value: 0.5, easing: "linear" });
    expect(cfg.tracks[0].keyframes.map((k) => k.t)).toEqual([100, 300, 500]);
  });

  it("addKeyframe sobreescribe si ya existe un keyframe en el mismo t", () => {
    let cfg = newAnimationConfig();
    cfg = addKeyframe(cfg, "l1", "opacity", { t: 100, value: 0.5, easing: "linear" });
    cfg = addKeyframe(cfg, "l1", "opacity", { t: 100, value: 0.9, easing: "ease-out" });
    expect(cfg.tracks[0].keyframes).toHaveLength(1);
    expect(cfg.tracks[0].keyframes[0].value).toBe(0.9);
    expect(cfg.tracks[0].keyframes[0].easing).toBe("ease-out");
  });

  it("removeKeyframe elimina; si queda vacío, descarta el track", () => {
    let cfg = newAnimationConfig();
    cfg = addKeyframe(cfg, "l1", "opacity", { t: 100, value: 0, easing: "linear" });
    cfg = addKeyframe(cfg, "l1", "opacity", { t: 500, value: 1, easing: "linear" });
    cfg = removeKeyframe(cfg, "l1", "opacity", 100);
    expect(cfg.tracks[0].keyframes).toHaveLength(1);
    cfg = removeKeyframe(cfg, "l1", "opacity", 500);
    expect(cfg.tracks).toHaveLength(0);
  });

  it("moveKeyframe reubica preservando orden", () => {
    let cfg = newAnimationConfig();
    cfg = addKeyframe(cfg, "l1", "opacity", { t: 100, value: 0, easing: "linear" });
    cfg = addKeyframe(cfg, "l1", "opacity", { t: 500, value: 1, easing: "linear" });
    cfg = moveKeyframe(cfg, "l1", "opacity", 100, 800);
    expect(cfg.tracks[0].keyframes.map((k) => k.t)).toEqual([500, 800]);
  });

  it("updateKeyframe cambia value sin mover", () => {
    let cfg = newAnimationConfig();
    cfg = addKeyframe(cfg, "l1", "opacity", { t: 100, value: 0, easing: "linear" });
    cfg = updateKeyframe(cfg, "l1", "opacity", 100, { value: 0.7 });
    expect(cfg.tracks[0].keyframes[0].value).toBe(0.7);
    expect(cfg.tracks[0].keyframes[0].t).toBe(100);
  });

  it("removeTracksForLayer limpia todos los tracks del layer", () => {
    let cfg = newAnimationConfig();
    cfg = addKeyframe(cfg, "logo", "opacity", { t: 0, value: 0, easing: "linear" });
    cfg = addKeyframe(cfg, "logo", "position.x", { t: 0, value: 0, easing: "linear" });
    cfg = addKeyframe(cfg, "cta", "opacity", { t: 0, value: 0, easing: "linear" });
    const next = removeTracksForLayer(cfg, "logo");
    expect(next.tracks).toHaveLength(1);
    expect(next.tracks[0].layerId).toBe("cta");
  });
});

describe("reflowAnimation (delta-anchor)", () => {
  // Helper para construir un root con UN layer "logo" en (x,y) y tamaño (w,h).
  // Sin constraints: por default los smart-constraints inferidos respetan la
  // posición original (la mayoría de tests usan layers centrados, etc.).
  const makeRoot = (
    rootW: number,
    rootH: number,
    layer: { x: number; y: number; w: number; h: number },
  ): TemplateDefinition => ({
    id: "tpl_root",
    type: "frame",
    position: { x: 0, y: 0 },
    size: { w: rootW, h: rootH },
    layout: { mode: "free" },
    children: [
      {
        id: "logo",
        type: "shape",
        shape: "rect",
        fill: "#000",
        position: { x: layer.x, y: layer.y },
        size: { w: layer.w, h: layer.h },
      },
    ],
  });

  const baseCfg: AnimationConfig = {
    duration: 1000,
    loop: 1,
    tracks: [
      // position.x: layer base = 100. kfs en 100 y 500 → delta 0 y +400.
      trackOf("logo", "position.x", { t: 0, value: 100 }, { t: 1000, value: 500 }),
      trackOf("logo", "position.y", { t: 0, value: 200 }),
      trackOf("logo", "size.w", { t: 0, value: 300 }),
      trackOf("logo", "size.h", { t: 0, value: 80 }),
      trackOf("logo", "opacity", { t: 0, value: 0 }, { t: 1000, value: 1 }),
      trackOf("logo", "rotation", { t: 0, value: 45 }),
      trackOf("logo", "scale", { t: 0, value: 1.5 }),
      trackOf("logo", "blur", { t: 0, value: 10 }),
      trackOf("logo", "color", { t: 0, value: "#ff0000" }),
    ],
  };

  // Helper: makeRoot + animation. reflowForPreview solo propaga la
  // animation si el root la tiene, así que la attach acá para evitar
  // boilerplate en cada test.
  const makeRootWithAnim = (
    rootW: number,
    rootH: number,
    layer: { x: number; y: number; w: number; h: number },
    anim: AnimationConfig = baseCfg,
  ): TemplateDefinition => ({
    ...makeRoot(rootW, rootH, layer),
    animation: anim,
  });

  it("re-ancla position.x al newBase: kf que coincidía con el base sigue coincidiendo", () => {
    const orig = makeRootWithAnim(1000, 1000, { x: 100, y: 200, w: 300, h: 80 });
    const newRoot = reflowForPreview(orig, { w: 500, h: 1000 });
    const newLayer = newRoot.children[0] as TemplateLayer;
    const out = newRoot.animation!;
    const posX = out.tracks.find((t) => t.property === "position.x")!;
    // El primer kf (value=100) coincidía con el base original (100), así
    // que el reflow lo deja coincidiendo con el newBase del layer reflowed.
    expect(posX.keyframes[0].value).toBe(newLayer.position.x);
    // El segundo kf (value=500, delta=+400) queda en newBase + 400*sx = newBase + 200.
    expect(posX.keyframes[1].value).toBe(newLayer.position.x + 400 * 0.5);
  });

  it("re-ancla position.y al newBase con sy", () => {
    const orig = makeRootWithAnim(1000, 1000, { x: 100, y: 200, w: 300, h: 80 });
    const newRoot = reflowForPreview(orig, { w: 1000, h: 500 });
    const newLayer = newRoot.children[0] as TemplateLayer;
    const out = newRoot.animation!;
    const posY = out.tracks.find((t) => t.property === "position.y")!;
    // kf value=200 coincidía con base.y=200 → sigue coincidiendo con newBase.y.
    expect(posY.keyframes[0].value).toBe(newLayer.position.y);
  });

  it("re-ancla size.w al newBase con sx", () => {
    const orig = makeRootWithAnim(1000, 1000, { x: 100, y: 200, w: 300, h: 80 });
    const newRoot = reflowForPreview(orig, { w: 500, h: 1000 });
    const newLayer = newRoot.children[0] as TemplateLayer;
    const out = newRoot.animation!;
    const sizeW = out.tracks.find((t) => t.property === "size.w")!;
    // kf value=300 coincidía con base.w=300 → sigue coincidiendo con newBase.w.
    expect(sizeW.keyframes[0].value).toBe(newLayer.size.w);
  });

  it("escala blur con el promedio de sx y sy (sin anchor: blur no es relativo a posición)", () => {
    const orig = makeRootWithAnim(1000, 1000, { x: 100, y: 200, w: 300, h: 80 });
    const newRoot = reflowForPreview(orig, { w: 500, h: 500 });
    const out = newRoot.animation!;
    const blur = out.tracks.find((t) => t.property === "blur")!;
    expect(blur.keyframes[0].value).toBe(5); // 10 * 0.5
  });

  it("NO toca opacity, rotation, scale, color", () => {
    const orig = makeRootWithAnim(1000, 1000, { x: 100, y: 200, w: 300, h: 80 });
    const newRoot = reflowForPreview(orig, { w: 200, h: 200 });
    const out = newRoot.animation!;
    expect(out.tracks.find((t) => t.property === "opacity")!.keyframes[0].value).toBe(0);
    expect(out.tracks.find((t) => t.property === "rotation")!.keyframes[0].value).toBe(45);
    expect(out.tracks.find((t) => t.property === "scale")!.keyframes[0].value).toBe(1.5);
    expect(out.tracks.find((t) => t.property === "color")!.keyframes[0].value).toBe("#ff0000");
  });

  it("track de un layer que ya no existe cae al escalado proporcional (fallback)", () => {
    const orig = makeRoot(1000, 1000, { x: 100, y: 200, w: 300, h: 80 });
    const newRoot: TemplateDefinition = { ...orig, size: { w: 500, h: 1000 }, children: [] };
    const out = reflowAnimation(baseCfg, orig, newRoot);
    const posX = out.tracks.find((t) => t.property === "position.x")!;
    // Sin layer en el árbol nuevo: cae al proporcional viejo.
    expect(posX.keyframes[0].value).toBe(50);  // 100 * 0.5
    expect(posX.keyframes[1].value).toBe(250); // 500 * 0.5
  });
});

describe("reflowForPreview con animation", () => {
  it("propaga el reflow de keyframes junto con el layout (fallback proporcional sin layer)", () => {
    const def: TemplateDefinition = {
      id: "tpl_root",
      type: "frame",
      position: { x: 0, y: 0 },
      size: { w: 1000, h: 1000 },
      layout: { mode: "free" },
      children: [],
      animation: {
        duration: 1000,
        loop: 1,
        tracks: [trackOf("logo", "position.x", { t: 0, value: 200 })],
      },
    };
    const out = reflowForPreview(def, { w: 500, h: 1000 });
    expect(out.size).toEqual({ w: 500, h: 1000 });
    // Sin layer "logo" en el árbol, cae al fallback proporcional: 200 * 0.5.
    expect(out.animation?.tracks[0].keyframes[0].value).toBe(100);
  });
});

describe("buildInitialFromAdaptFit con animation", () => {
  it("contain: aplica scale uniforme + offset a position.x", () => {
    const master: TemplateDefinition = {
      id: "tpl_root",
      type: "frame",
      position: { x: 0, y: 0 },
      size: { w: 1000, h: 1000 },
      layout: { mode: "free" },
      children: [],
      animation: {
        duration: 1000,
        loop: 1,
        tracks: [trackOf("logo", "position.x", { t: 0, value: 100 })],
      },
    };
    // 500×250 contain: scale = min(0.5, 0.25) = 0.25. master scaled = 250×250.
    // offsetX = (500 - 250) / 2 = 125.
    const out = buildInitialFromAdaptFit(master, 500, 250, "contain");
    const posX = out.animation!.tracks[0].keyframes[0].value;
    expect(posX).toBe(150); // 100 * 0.25 + 125
  });

  it("responsive cae al reflow estándar (sin offset)", () => {
    const master: TemplateDefinition = {
      id: "tpl_root",
      type: "frame",
      position: { x: 0, y: 0 },
      size: { w: 1000, h: 1000 },
      layout: { mode: "free" },
      children: [],
      animation: {
        duration: 1000,
        loop: 1,
        tracks: [trackOf("logo", "position.x", { t: 0, value: 200 })],
      },
    };
    const out = buildInitialFromAdaptFit(master, 500, 1000, "responsive");
    expect(out.animation!.tracks[0].keyframes[0].value).toBe(100); // 200 * 0.5
  });
});
