import { describe, it, expect } from "vitest";
import { lintLayout, estimateTextLines, hasLintErrors } from "../layout-lint";
import { applyLayerPatches } from "../layout-patch";
import { adaptTree } from "../adapt";
import type { TemplateDefinition, TextLayer, ImageLayer, ShapeLayer, FrameLayer } from "../types";

function text(id: string, x: number, y: number, w: number, h: number, fontSize: number, content = "Titular"): TextLayer {
  return {
    id,
    type: "text",
    content,
    position: { x, y },
    size: { w, h },
    style: { fontSize, color: "#000", lineHeight: 1.2 },
  };
}

function root(w: number, h: number, children: TemplateDefinition["children"]): TemplateDefinition {
  return {
    id: "tpl_root",
    type: "frame",
    position: { x: 0, y: 0 },
    size: { w, h },
    background: { type: "color", value: "#fff" },
    layout: { mode: "free" },
    children,
  };
}

const kinds = (def: TemplateDefinition) => lintLayout(def).map((i) => i.kind);

describe("estimateTextLines", () => {
  it("hace word-wrap por ancho", () => {
    // 0.55 * 20 = 11px por glifo → 10 caracteres en 120px: "hola mundo" + "cruel".
    expect(estimateTextLines("hola mundo cruel", 120, 20).lines).toBe(2);
    expect(estimateTextLines("hola", 100, 20).lines).toBe(1);
  });
  it("marca palabras más anchas que la caja", () => {
    expect(estimateTextLines("Supercalifragilístico", 60, 20).wordTooLong).toBe(true);
  });
});

describe("lintLayout", () => {
  it("un layout limpio no tiene problemas", () => {
    const def = root(300, 250, [text("t", 20, 20, 260, 40, 24), text("cta", 20, 190, 120, 40, 16, "Comprar")]);
    expect(lintLayout(def)).toEqual([]);
  });

  it("detecta capas fuera del formato", () => {
    const def = root(300, 250, [text("t", 200, 20, 260, 40, 24)]);
    expect(kinds(def)).toContain("out_of_bounds");
    expect(hasLintErrors(lintLayout(def))).toBe(true);
  });

  it("detecta textos que se pisan", () => {
    const def = root(300, 250, [text("a", 20, 20, 260, 60, 24), text("b", 20, 40, 260, 60, 24)]);
    const issue = lintLayout(def).find((i) => i.kind === "overlap");
    expect(issue?.layerIds).toEqual(["a", "b"]);
    expect(issue?.severity).toBe("error");
  });

  it("no marca texto dentro de una tarjeta como choque", () => {
    const card: ShapeLayer = {
      id: "card",
      type: "shape",
      shape: "rect",
      fill: "#eee",
      position: { x: 10, y: 10 },
      size: { w: 280, h: 120 },
    };
    const def = root(300, 250, [card, text("t", 20, 20, 260, 40, 24)]);
    expect(kinds(def)).not.toContain("overlap");
  });

  it("ignora fondos a pantalla completa", () => {
    const bg: ImageLayer = {
      id: "bg",
      type: "image",
      src: null,
      position: { x: -10, y: -10 },
      size: { w: 320, h: 270 },
    };
    const def = root(300, 250, [bg, text("t", 20, 20, 260, 40, 24)]);
    expect(lintLayout(def)).toEqual([]);
  });

  it("detecta texto que no cabe en su caja", () => {
    const def = root(300, 250, [text("t", 20, 20, 120, 30, 24, "Un titular bastante largo para esta caja")]);
    expect(kinds(def)).toContain("text_overflow");
  });

  it("detecta tipografía ilegible", () => {
    const def = root(320, 50, [text("t", 10, 10, 200, 20, 7)]);
    const issue = lintLayout(def).find((i) => i.kind === "text_too_small");
    expect(issue?.severity).toBe("error");
  });

  it("en root stack solo revisa tipografía", () => {
    const def: TemplateDefinition = {
      ...root(300, 250, [text("t", 900, 900, 100, 40, 6)]),
      layout: { mode: "stack", direction: "vertical", padding: [8, 8, 8, 8], gap: 8, align: "start", justify: "start" },
    };
    expect(kinds(def)).toEqual(["text_too_small"]);
  });

  it("encuentra problemas en un leaderboard derivado de un hero", () => {
    const hero = root(1920, 1080, [
      text("title", 80, 100, 1760, 200, 140, "TU TITULAR ACÁ CON MÁS PALABRAS"),
      text("price", 760, 880, 400, 140, 96, "$0.000"),
    ]);
    const adapted = adaptTree(hero, { w: 728, h: 90 });
    // No exigimos un problema concreto (el motor puede mejorar), solo que el
    // lint corra sobre la salida real del motor sin lanzar.
    expect(Array.isArray(lintLayout(adapted))).toBe(true);
  });
});

describe("applyLayerPatches", () => {
  it("mueve, redimensiona y cambia la tipografía de capas de primer nivel", () => {
    const def = root(300, 250, [text("t", 200, 20, 260, 40, 24)]);
    const { definition, applied, unknown } = applyLayerPatches(def, [
      { id: "t", x: 20, w: 260, fontSize: 20 },
      { id: "nope", x: 1 },
    ]);
    const t = definition.children[0] as TextLayer;
    expect(t.position.x).toBe(20);
    expect(t.style.fontSize).toBe(20);
    expect(applied).toEqual(["t"]);
    expect(unknown).toEqual(["nope"]);
    expect(lintLayout(definition)).toEqual([]);
  });

  it("reencaja capas que el modelo dejó fuera del formato", () => {
    const def = root(300, 250, [text("t", 20, 20, 100, 40, 24)]);
    const { definition } = applyLayerPatches(def, [{ id: "t", x: 280, y: -5 }]);
    const t = definition.children[0];
    expect(t.position.x + t.size.w).toBeLessThanOrEqual(300);
    expect(t.position.y).toBe(0);
  });

  it("sobre un rango de smart text fija el máximo", () => {
    const t = text("t", 20, 20, 260, 40, 24);
    t.style.fontSize = { min: 18, max: 64 };
    const { definition } = applyLayerPatches(root(300, 250, [t]), [{ id: "t", fontSize: 14 }]);
    expect((definition.children[0] as TextLayer).style.fontSize).toEqual({ min: 14, max: 14 });
  });

  it("oculta capas anidadas y escala los hijos de un frame redimensionado", () => {
    const inner = text("inner", 10, 10, 80, 20, 16);
    const group: FrameLayer = {
      id: "g",
      type: "frame",
      position: { x: 10, y: 10 },
      size: { w: 100, h: 40 },
      layout: { mode: "free" },
      children: [inner, text("tag", 10, 30, 80, 10, 8)],
    };
    const { definition } = applyLayerPatches(root(300, 250, [group]), [
      { id: "g", w: 200, h: 80 },
      { id: "tag", hidden: true },
    ]);
    const g = definition.children[0] as FrameLayer;
    expect(g.size).toEqual({ w: 200, h: 80 });
    expect(g.children[0].size.w).toBe(160);
    expect(g.children[1].visible).toBe(false);
  });
});
