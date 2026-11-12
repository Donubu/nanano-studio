import { describe, it, expect } from "vitest";
import { pinchZoom } from "../../hooks/use-pinch-zoom-over-nodes";

describe("pinchZoom", () => {
  it("pellizcar hacia afuera acerca y hacia adentro aleja (misma escala que React Flow)", () => {
    // deltaY -50 en píxeles: 2^(50*0.002*10) = 2
    expect(pinchZoom(0.5, -50, 0, 0.1, 2)).toBeCloseTo(1);
    expect(pinchZoom(1, 50, 0, 0.1, 2)).toBeCloseTo(0.5);
  });
  it("respeta el zoom mínimo y máximo", () => {
    expect(pinchZoom(1.8, -500, 0, 0.1, 2)).toBe(2);
    expect(pinchZoom(0.2, 500, 0, 0.1, 2)).toBe(0.1);
  });
});
