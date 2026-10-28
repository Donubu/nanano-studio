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
    const built = buildReferenceDefinition(sanitizeReferenceLayout(raw)!, { src: "{logo.primary}", aspect: 1 });
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

  it("un logo cuadrado sobre un recuadro de su misma proporción ocupa el recuadro y la forma sobra", () => {
    const layout = sanitizeReferenceLayout({
      aspect: "square",
      background: "#ffffff",
      blocks: [
        { role: "headline", x: 10, y: 10, w: 80, h: 10, text: "PUERTA DEL SOL" },
        { role: "shape", x: 68, y: 70, w: 18, h: 18, background_color: "#245C98" },
        { role: "logo", x: 68.5, y: 76, w: 17, h: 5 },
      ],
    })!;
    const d = buildReferenceDefinition(layout, { src: "logo.png", aspect: 1 }).definition;
    expect(d.children.some((c) => c.type === "shape")).toBe(false);
    const logo = d.children.find((c) => c.id === "logo")!;
    expect(logo.size.w).toBe(logo.size.h);
    expect(logo.size.w).toBeCloseTo(194, -1);
  });

  it("una palabra sobre un bloque de otra proporción va centrada con aire", () => {
    const layout = sanitizeReferenceLayout({
      aspect: "square",
      background: "#ffffff",
      blocks: [
        { role: "headline", x: 10, y: 10, w: 80, h: 10, text: "PUERTA DEL SOL" },
        { role: "shape", x: 10, y: 70, w: 40, h: 20, background_color: "#245C98" },
        { role: "logo", x: 12, y: 75, w: 30, h: 6 },
      ],
    })!;
    const d = buildReferenceDefinition(layout, { src: "logo.png", aspect: 4 }).definition;
    expect(d.children.some((c) => c.type === "shape")).toBe(true);
    const logo = d.children.find((c) => c.id === "logo")!;
    expect(Math.round(logo.size.w / logo.size.h)).toBe(4);
    const cx = logo.position.x + logo.size.w / 2;
    expect(cx).toBeCloseTo(0.3 * 1080, -1);
  });
});

describe("referencia · tipografía, degradados, íconos y copia íntegra", () => {
  const raw = {
    aspect: "square",
    background: "#ffffff",
    blocks: [
      { role: "image", x: 0, y: 0, w: 100, h: 60, image_prompt: "house" },
      { role: "shape", x: 0, y: 40, w: 100, h: 20, gradient_colors: ["#000000", "#00000000", "#123456"], gradient_angle: 0 },
      { role: "headline", x: 5, y: 62, w: 90, h: 12, text: "PUERTA DEL SOL", font_family: "Playfair Display", weight: 700 },
      { role: "icon", x: 5, y: 80, w: 6, h: 6, icon_name: "MapPin", color: "#d31215" },
      { role: "icon", x: 15, y: 80, w: 6, h: 6, icon_name: "NoExiste" },
      { role: "logo", x: 80, y: 85, w: 15, h: 10 },
    ],
  };

  it("usa la fuente de la referencia, el degradado y los íconos válidos", () => {
    const layout = sanitizeReferenceLayout(raw)!;
    const d = buildReferenceDefinition(layout, null).definition;
    const title = d.children.find((c) => c.name === "Titular");
    expect(title?.type === "text" && title.style.fontFamily).toBe("Playfair Display, Georgia, serif");
    const shade = d.children.find((c) => c.type === "shape");
    expect(shade?.type === "shape" && shade.fill).toBe("linear-gradient(0deg, #000000, #00000000, #123456)");
    const icons = d.children.filter((c) => c.type === "icon");
    expect(icons).toHaveLength(1);
    expect(icons[0].type === "icon" && icons[0].iconName).toBe("MapPin");
  });

  it("en modo normal la fuente de la marca manda", () => {
    const d = buildReferenceDefinition(sanitizeReferenceLayout(raw)!, null, {
      fonts: { heading: "{font.heading}", body: "{font.body}" },
    }).definition;
    const title = d.children.find((c) => c.name === "Titular");
    expect(title?.type === "text" && title.style.fontFamily).toBe("{font.heading}");
  });

  it("copia íntegra: fotos y logo son recortes de la referencia, y manda su fuente", () => {
    const crops = new Map<number, string>([
      [0, "https://bucket/ref-photo.jpg"],
      [5, "https://bucket/ref-logo.png"],
    ]);
    const built = buildReferenceDefinition(sanitizeReferenceLayout(raw)!, { src: "brand-logo", aspect: 1 }, {
      integral: true,
      crops,
      fonts: { heading: "{font.heading}" },
    });
    const d = built.definition;
    const hero = d.children.find((c) => c.id === "hero");
    expect(hero?.type === "image" && hero.src).toBe("https://bucket/ref-photo.jpg");
    const logo = d.children.find((c) => c.id === "logo");
    expect(logo?.type === "image" && logo.src).toBe("https://bucket/ref-logo.png");
    const title = d.children.find((c) => c.name === "Titular");
    expect(title?.type === "text" && title.style.fontFamily).toBe("Playfair Display, Georgia, serif");
  });
});

describe("normalizeHex", () => {
  it("acepta los formatos que devuelve el modelo", async () => {
    const { normalizeHex } = await import("../reference-layout");
    expect(normalizeHex("#fff")).toBe("#FFFFFF");
    expect(normalizeHex("white")).toBe("#FFFFFF");
    expect(normalizeHex("rgb(230, 0, 9)")).toBe("#E60009");
    expect(normalizeHex("#E60000FF")).toBe("#E60000");
    expect(normalizeHex("azul")).toBeUndefined();
    expect(normalizeHex("rgba(0,0,0,0.5)", true)).toBe("#00000080");
    expect(normalizeHex("transparent", true)).toBe("#00000000");
  });
});
