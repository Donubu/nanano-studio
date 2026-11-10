import { describe, it, expect } from "vitest";
import { newCanvasNodeId } from "../canvas-types";

describe("newCanvasNodeId", () => {
  it("genera ids únicos con prefijo node- (no reutiliza ids de nodos borrados)", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newCanvasNodeId()));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(/^node-[a-z0-9]{12,}$/);
  });
});
