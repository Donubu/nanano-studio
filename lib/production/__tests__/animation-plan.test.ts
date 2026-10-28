import { describe, it, expect } from "vitest";
import { sanitizeAnimationPlan, buildAnimationFromPlan } from "../animation-plan";
import { validateAnimationConfig } from "../template-schema";
import type { TemplateDefinition } from "../types";

const def: TemplateDefinition = {
  id: "tpl_root",
  type: "frame",
  position: { x: 0, y: 0 },
  size: { w: 300, h: 250 },
  layout: { mode: "free" },
  children: [
    { id: "title", type: "text", content: "Hola", position: { x: 20, y: 20 }, size: { w: 260, h: 60 }, style: { fontSize: 32, color: "#000" } },
    { id: "cta", type: "text", content: "Comprar", position: { x: 20, y: 180 }, size: { w: 120, h: 40 }, style: { fontSize: 16, color: "#fff", backgroundColor: "#f00" } },
  ],
};
const ids = new Set(["tpl_root", "title", "cta"]);

describe("animation-plan", () => {
  it("normaliza tiempos, ids y loop", () => {
    const plan = sanitizeAnimationPlan(
      {
        duration_ms: 99999,
        loop: 7,
        layers: [
          { id: "title", entrance: "slide-up", start_ms: -5, duration_ms: 600, emphasis: "none" },
          { id: "ghost", entrance: "fade", start_ms: 0, duration_ms: 500 },
          { id: "cta", entrance: "rocket", start_ms: 800, duration_ms: 500, emphasis: "pulse" },
        ],
      },
      def,
    )!;
    expect(plan.duration_ms).toBe(30000);
    expect(plan.loop).toBe(3);
    expect(plan.layers.map((l) => l.id)).toEqual(["title", "cta"]);
    expect(plan.layers[0].start_ms).toBe(0);
    expect(plan.layers[1].entrance).toBe("fade");
  });

  it("arma tracks válidos con entrada y énfasis sin t duplicados", () => {
    const plan = sanitizeAnimationPlan(
      {
        duration_ms: 5000,
        loop: 2,
        layers: [
          { id: "title", entrance: "slide-up", start_ms: 0, duration_ms: 600, emphasis: "none" },
          { id: "cta", entrance: "pop", start_ms: 700, duration_ms: 500, emphasis: "pulse" },
        ],
      },
      def,
    )!;
    const anim = buildAnimationFromPlan(def, plan);
    const v = validateAnimationConfig(anim, ids);
    expect(v.ok).toBe(true);
    const titleY = anim.tracks.find((t) => t.layerId === "title" && t.property === "position.y")!;
    expect(titleY.keyframes[0].value).toBe(20 + 20); // 8% de 250 = 20px de offset
    expect(titleY.keyframes.at(-1)!.value).toBe(20);
    const ctaScale = anim.tracks.find((t) => t.layerId === "cta" && t.property === "scale")!;
    const ts = ctaScale.keyframes.map((k) => k.t);
    expect(new Set(ts).size).toBe(ts.length);
    expect(Math.max(...(ctaScale.keyframes.map((k) => k.value) as number[]))).toBeCloseTo(1.08);
  });

  it("rechaza planes sin capas válidas", () => {
    expect(sanitizeAnimationPlan({ layers: [{ id: "x" }] }, def)).toBeNull();
  });
});
