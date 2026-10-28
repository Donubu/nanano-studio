import { describe, it, expect } from "vitest";
import { sanitizeReferenceLayout, buildReferenceDefinition } from "../reference-layout";
import { inferRoles } from "../layer-roles";
import { lintLayout } from "../layout-lint";

const raw = {
  aspect: "square",
  background: "#0b1f3a",
  blocks: [
    { role: "image", x: 0, y: 0, w: 100, h: 60, image_prompt: "modern house facade at golden hour" },
    { role: "shape", x: 0, y: 60, w: 100, h: 40, background_color: "#0b1f3a" },
    { role: "logo", x: 5, y: 4, w: 14, h: 14 },
    { role: "headline", x: 6, y: 64, w: 88, h: 12, text: "RESERVA SAN FRANCISCO", color: "#ffffff", uppercase: true },
    { role: "price", x: 6, y: 78, w: 50, h: 9, text: "DESDE UF21776*", color: "#ffd400" },
    { role: "cta", x: 60, y: 79, w: 34, h: 8, text: "VISITA PILOTOS", color: "#0b1f3a", background_color: "#ffd400", shape: "pill" },
    { role: "bogus", x: 1, y: 1, w: 1, h: 1 },
  ],
};

describe("referencia por bloques", () => {
  it("sanea roles, colores y cajas", () => {
    const l = sanitizeReferenceLayout(raw)!;
    expect(l.aspect).toBe("square");
    expect(l.blocks).toHaveLength(6);
    expect(l.background).toBe("#0B1F3A");
  });

  it("arma capas editables con la composición, el logo y los roles correctos", () => {
    const built = buildReferenceDefinition(sanitizeReferenceLayout(raw)!, "{logo.primary}");
    const d = built.definition;
    expect(d.size).toEqual({ w: 1080, h: 1080 });
    const hero = d.children.find((c) => c.id === "hero")!;
    expect(hero.size).toEqual({ w: 1080, h: 648 });
    expect(built.imagePrompts).toEqual([{ id: "hero", prompt: "modern house facade at golden hour" }]);
    const logo = d.children.find((c) => c.id === "logo");
    expect(logo?.type === "image" && logo.src).toBe("{logo.primary}");
    const price = d.children.find((c) => c.name === "Precio");
    expect(price?.type === "text" && price.content).toBe("DESDE UF 21.776*");
    const cta = d.children.find((c) => c.name === "CTA");
    expect(cta?.type === "text" && cta.style.backgroundColor).toBe("#FFD400");
    const roles = inferRoles(d);
    expect(roles.get(d.children.find((c) => c.name === "Titular")!.id)).toBe("headline");
    expect(lintLayout(d).filter((i) => i.kind === "text_overflow")).toEqual([]);
  });

  it("sin logo de marca no deja el slot", () => {
    const built = buildReferenceDefinition(sanitizeReferenceLayout(raw)!, null);
    expect(built.definition.children.some((c) => c.id === "logo")).toBe(false);
  });
});
