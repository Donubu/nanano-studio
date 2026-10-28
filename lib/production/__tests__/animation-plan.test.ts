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

describe("followBaseChanges", () => {
  it("mueve los keyframes de posición con la capa y borra tracks de capas eliminadas", async () => {
    const { followBaseChanges } = await import("../reflow");
    const plan = sanitizeAnimationPlan(
      { duration_ms: 3000, loop: 1, layers: [
        { id: "title", entrance: "slide-left", start_ms: 0, duration_ms: 500, emphasis: "none" },
        { id: "cta", entrance: "fade", start_ms: 500, duration_ms: 500, emphasis: "none" },
      ] },
      def,
    )!;
    const animated = { ...def, animation: buildAnimationFromPlan(def, plan) };
    const moved = {
      ...animated,
      children: [{ ...animated.children[0], position: { x: 120, y: 20 } }],
    };
    const out = followBaseChanges(animated, moved);
    const x = out.animation!.tracks.find((t) => t.layerId === "title" && t.property === "position.x")!;
    expect(x.keyframes.at(-1)!.value).toBe(120);
    expect(out.animation!.tracks.some((t) => t.layerId === "cta")).toBe(false);
  });
});

describe("grupos visuales en la animación", () => {
  // Caso real: franja + texto arriba, foto, caja de precio con precio y legal
  // dentro y el logo pegado a la derecha.
  const piece = {
    id: "tpl_root",
    type: "frame" as const,
    position: { x: 0, y: 0 },
    size: { w: 1080, h: 1080 },
    layout: { mode: "free" as const },
    children: [
      { id: "band", type: "shape" as const, shape: "rect" as const, fill: "#D31215", position: { x: 48, y: 48 }, size: { w: 985, h: 63 } },
      { id: "ribbon", type: "text" as const, content: "NUEVA ETAPA", position: { x: 54, y: 56 }, size: { w: 972, h: 45 }, style: { fontSize: 30, color: "#fff" } },
      { id: "photo", type: "image" as const, src: "x", position: { x: 48, y: 110 }, size: { w: 985, h: 922 } },
      { id: "box", type: "shape" as const, shape: "rect" as const, fill: "#D31215", position: { x: 156, y: 759 }, size: { w: 578, h: 189 } },
      { id: "price", type: "text" as const, content: "DESDE UF 2.773*", position: { x: 173, y: 799 }, size: { w: 543, h: 73 }, style: { fontSize: 60, color: "#fff" } },
      { id: "logo", type: "image" as const, name: "Logo", src: "l", position: { x: 734, y: 759 }, size: { w: 189, h: 189 } },
    ],
  };

  it("agrupa texto sobre franja, precio en su caja y logo al lado, pero no la foto", async () => {
    const { visualGroups } = await import("../animation-plan");
    const g = visualGroups(piece);
    expect(g.get("ribbon")).toEqual({ anchor: "band", kind: "inside" });
    expect(g.get("price")).toEqual({ anchor: "box", kind: "inside" });
    expect(g.get("logo")).toEqual({ anchor: "box", kind: "beside" });
    expect(g.has("photo")).toBe(false);
  });

  it("el grupo entra junto; el pop se vuelve subida y el latido flotación", async () => {
    const { buildAnimationFromPlan } = await import("../animation-plan");
    const anim = buildAnimationFromPlan(piece, {
      duration_ms: 5000,
      loop: 1,
      rationale: "",
      layers: [
        { id: "band", entrance: "slide-down", start_ms: 0, duration_ms: 500, emphasis: "none" },
        { id: "ribbon", entrance: "fade", start_ms: 300, duration_ms: 400, emphasis: "none" },
        { id: "box", entrance: "pop", start_ms: 1200, duration_ms: 500, emphasis: "none" },
        { id: "price", entrance: "fade", start_ms: 1500, duration_ms: 400, emphasis: "pulse" },
        { id: "logo", entrance: "pop", start_ms: 1600, duration_ms: 400, emphasis: "none" },
      ],
    });
    const track = (id: string, p: string) => anim.tracks.find((t) => t.layerId === id && t.property === p);
    expect(track("ribbon", "position.y")?.keyframes.map((k) => k.t)).toEqual(track("band", "position.y")?.keyframes.map((k) => k.t));
    expect(track("price", "position.y")?.keyframes[0].t).toBe(1200);
    expect(track("logo", "position.y")?.keyframes[0].t).toBe(1200);
    // Con el logo al lado, el latido pasa a flotación del grupo entero.
    expect(track("box", "scale")).toBeUndefined();
    expect(track("logo", "scale")).toBeUndefined();
    const floatTimes = (id: string) => track(id, "position.y")?.keyframes.map((k) => k.t);
    expect(floatTimes("logo")).toEqual(floatTimes("box"));
    expect(floatTimes("price")).toEqual(floatTimes("box"));
    expect(floatTimes("box")!.length).toBeGreaterThan(2);
  });
});
