import { describe, it, expect } from "vitest";
import { applyReferenceCorrections, describeLayersForVerify, sanitizeVerification } from "../reference-verify";
import type { TemplateDefinition, TemplateLayer, TextLayer } from "../types";

const text = (id: string, content: string, x: number, y: number, w: number, h: number, fontSize: number | { min: number; max: number } = 40): TemplateLayer =>
  ({ id, type: "text", content, position: { x, y }, size: { w, h }, style: { fontSize, color: "#000000" } }) as unknown as TemplateLayer;
const shape = (id: string, x: number, y: number, w: number, h: number): TemplateLayer =>
  ({ id, type: "shape", shape: "rect", fill: "#ff0000", position: { x, y }, size: { w, h } }) as unknown as TemplateLayer;
const def = (children: TemplateLayer[]): TemplateDefinition =>
  ({ size: { w: 1000, h: 500 }, children, background: "#fff" }) as unknown as TemplateDefinition;

describe("describeLayersForVerify", () => {
  it("describe cajas en % y textos acotados", () => {
    const d = def([shape("bar", 0, 400, 1000, 100), text("h", "Hola", 100, 50, 500, 100)]);
    const layers = describeLayersForVerify(d);
    expect(layers.map((l) => l.id)).toEqual(["bar", "h"]);
    expect(layers[0]).toMatchObject({ x: 0, y: 80, w: 100, h: 20, background_color: "#ff0000" });
    expect(layers[1]).toMatchObject({ x: 10, y: 10, w: 50, h: 20, text: "Hola", color: "#000000" });
  });
});

describe("sanitizeVerification", () => {
  it("acota fidelidad, normaliza colores y descarta correcciones vacías", () => {
    const v = sanitizeVerification({
      fidelity: 140,
      summary: "ok",
      corrections: [{ id: "h", x: 12.3, color: "#FF00AA" }, { id: "x" }, { nope: 1 }],
    });
    expect(v?.fidelity).toBe(100);
    expect(v?.corrections).toEqual([{ id: "h", x: 12.3, color: "#FF00AA" }]);
  });
});

describe("applyReferenceCorrections", () => {
  it("mueve y escala con topes, cambia colores y letra, oculta", () => {
    const d = def([shape("bar", 0, 400, 1000, 100), text("h", "Hola", 100, 50, 500, 100), text("r", "Rango", 0, 0, 200, 50, { min: 20, max: 40 }), text("sobra", "x", 0, 0, 50, 50)]);
    const { definition, applied } = applyReferenceCorrections(d, [
      // 60% del formato = 600px de desplazamiento: se acota a 20% (200px).
      { id: "h", x: 70, w: 10, color: "#123456", font_scale: 1.5 },
      { id: "bar", background_color: "#00ff00" },
      { id: "r", font_scale: 0.5 },
      { id: "sobra", hidden: true },
      { id: "no-existe", x: 1 },
    ]);
    expect(applied).toBe(4);
    const h = definition.children.find((l) => l.id === "h") as TextLayer;
    expect(h.position.x).toBe(300);
    // 10% = 100px pero el mínimo es 0,5× (250).
    expect(h.size.w).toBe(250);
    expect(h.style.color).toBe("#123456");
    expect(h.style.fontSize).toBe(60);
    const bar = definition.children.find((l) => l.id === "bar");
    expect(bar && bar.type === "shape" ? bar.fill : null).toBe("#00ff00");
    const r = definition.children.find((l) => l.id === "r") as TextLayer;
    // 0.5 se acota a 0.6.
    expect(r.style.fontSize).toEqual({ min: 12, max: 24 });
    expect(definition.children.find((l) => l.id === "sobra")?.visible).toBe(false);
  });
  it("sin cambios reales no cuenta", () => {
    const d = def([text("h", "Hola", 100, 50, 500, 100)]);
    expect(applyReferenceCorrections(d, [{ id: "h", x: 10, y: 10 }]).applied).toBe(0);
  });
});
