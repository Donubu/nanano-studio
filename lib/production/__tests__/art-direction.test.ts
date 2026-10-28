import { describe, it, expect } from "vitest";
import { artDirectionGuide, ART_DIRECTIONS, DATED_PATTERNS } from "../art-direction";

describe("artDirectionGuide", () => {
  it("lista todas las direcciones y lo que se ve anticuado", () => {
    const g = artDirectionGuide();
    for (const d of ART_DIRECTIONS) expect(g).toContain(d.label);
    for (const p of DATED_PATTERNS) expect(g).toContain(p);
    expect(g).toContain("guía de marca");
  });
});
