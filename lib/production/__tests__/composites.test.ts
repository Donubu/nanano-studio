import { describe, it, expect } from "vitest";
import { collapseShapeTextPairs, mergeShapeAndText } from "../composites";
import type { TemplateDefinition, TextLayer, ShapeLayer } from "../types";

function shape(over: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
    id: "bg",
    type: "shape",
    shape: "rect",
    fill: "#F59E0B",
    position: { x: 100, y: 200 },
    size: { w: 400, h: 120 },
    ...over,
  };
}

function text(over: Partial<TextLayer> = {}): TextLayer {
  return {
    id: "cta",
    type: "text",
    content: "COTIZAR",
    position: { x: 100, y: 200 },
    size: { w: 400, h: 120 },
    style: { fontSize: 32, color: "#000" },
    ...over,
  };
}

function root(children: TemplateDefinition["children"]): TemplateDefinition {
  return {
    id: "tpl_root",
    type: "frame",
    position: { x: 0, y: 0 },
    size: { w: 1920, h: 1080 },
    layout: { mode: "free" },
    children,
  };
}

describe("collapseShapeTextPairs", () => {
  it("colapsa shape + text con la misma caja en un TextLayer con fondo", () => {
    const { definition, merged } = collapseShapeTextPairs(root([shape(), text()]));
    expect(merged).toBe(1);
    expect(definition.children).toHaveLength(1);
    const only = definition.children[0] as TextLayer;
    expect(only.id).toBe("cta");
    expect(only.type).toBe("text");
    expect(only.style.backgroundColor).toBe("#F59E0B");
    expect(only.style.backgroundCornerRadius).toBe(0);
    expect(only.style.align).toBe("center");
    expect(only.style.verticalAlign).toBe("middle");
  });

  it("tolera diferencias de redondeo (<= 2px) entre las cajas", () => {
    const { merged } = collapseShapeTextPairs(
      root([shape({ position: { x: 60, y: 862.5 } }), text({ position: { x: 60, y: 863 } })]),
    );
    expect(merged).toBe(1);
  });

  it("ellipse → círculo: backgroundCornerRadius = lado menor / 2", () => {
    const { definition } = collapseShapeTextPairs(
      root([
        shape({ shape: "ellipse", size: { w: 260, h: 260 } }),
        text({ size: { w: 260, h: 260 } }),
      ]),
    );
    const only = definition.children[0] as TextLayer;
    expect(only.style.backgroundCornerRadius).toBe(130);
  });

  it("no toca pares con cajas distintas ni shapes con stroke", () => {
    const withDifferentBox = collapseShapeTextPairs(
      root([shape({ size: { w: 800, h: 120 } }), text()]),
    );
    expect(withDifferentBox.merged).toBe(0);
    expect(withDifferentBox.definition.children).toHaveLength(2);

    const withStroke = collapseShapeTextPairs(
      root([shape({ stroke: { color: "#000", width: 2 } }), text()]),
    );
    expect(withStroke.merged).toBe(0);
  });

  it("solo fusiona con un texto POR ENCIMA del shape (z mayor)", () => {
    const { merged } = collapseShapeTextPairs(root([text(), shape()]));
    expect(merged).toBe(0);
  });

  it("no pisa un texto que ya tiene fondo propio", () => {
    const { merged } = collapseShapeTextPairs(
      root([shape(), text({ style: { fontSize: 32, color: "#000", backgroundColor: "#fff" } })]),
    );
    expect(merged).toBe(0);
  });

  it("recorre frames anidados", () => {
    const { definition, merged } = collapseShapeTextPairs(
      root([
        {
          id: "grp",
          type: "frame",
          position: { x: 0, y: 0 },
          size: { w: 900, h: 500 },
          layout: { mode: "free" },
          children: [shape(), text()],
        },
      ]),
    );
    expect(merged).toBe(1);
    const grp = definition.children[0];
    expect(grp.type === "frame" && grp.children).toHaveLength(1);
  });
});

describe("mergeShapeAndText", () => {
  it("usa la caja del shape y conserva id, contenido y estilo del texto", () => {
    const merged = mergeShapeAndText(
      shape({ position: { x: 10, y: 20 }, size: { w: 300, h: 90 }, cornerRadius: 45, name: "cta-bg" }),
      text({ position: { x: 30, y: 40 }, size: { w: 200, h: 50 } }),
    );
    expect(merged.id).toBe("cta");
    expect(merged.position).toEqual({ x: 10, y: 20 });
    expect(merged.size).toEqual({ w: 300, h: 90 });
    expect(merged.name).toBe("cta-bg");
    expect(merged.content).toBe("COTIZAR");
    expect(merged.style.backgroundCornerRadius).toBe(45);
  });
});
