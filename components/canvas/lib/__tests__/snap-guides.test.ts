import { describe, it, expect } from "vitest";
import { computeSnap, intersects, unionBox } from "../snap-guides";

const other = { x: 100, y: 100, w: 200, h: 100 }; // bordes x: 100/200/300, y: 100/150/200

describe("computeSnap", () => {
  it("pega el borde izquierdo al de otro nodo y dibuja la guía vertical", () => {
    const r = computeSnap({ x: 104, y: 400, w: 50, h: 50 }, [other], 6);
    expect(r.dx).toBe(-4);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ orientation: "v", pos: 100, from: 100, to: 450 }]);
  });

  it("alinea centros y elige el ajuste más cercano en cada eje", () => {
    // centro x del bloque = 197 + 3 → 200 (centro del otro); y: top 203 → 200 (borde inferior)
    const r = computeSnap({ x: 172, y: 203, w: 56, h: 40 }, [other], 6);
    expect(r.dx).toBe(0 + 0); // 172+28=200: ya alineado en centro
    expect(r.dy).toBe(-3);
    expect(r.guides.map((g) => g.orientation).sort()).toEqual(["h", "v"]);
  });

  it("fuera del umbral no se mueve ni dibuja nada", () => {
    expect(computeSnap({ x: 500, y: 500, w: 40, h: 40 }, [other], 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it("la guía abarca todos los nodos alineados", () => {
    const below = { x: 100, y: 600, w: 80, h: 40 };
    const r = computeSnap({ x: 102, y: 300, w: 60, h: 60 }, [other, below], 6);
    expect(r.dx).toBe(-2);
    expect(r.guides).toContainEqual({ orientation: "v", pos: 100, from: 100, to: 640 });
  });
});

describe("cajas", () => {
  it("unionBox envuelve el grupo", () => {
    expect(unionBox([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 30 }])).toEqual({ x: 0, y: 0, w: 30, h: 35 });
    expect(unionBox([])).toBeNull();
  });
  it("intersects", () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 })).toBe(false);
  });
});
