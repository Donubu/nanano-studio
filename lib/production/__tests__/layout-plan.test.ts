import { describe, it, expect } from "vitest";
import { describeCatalog, expandPlan, sanitizePlan, LayoutPlan } from "../layout-plan";
import { LAYOUT_TEMPLATES } from "../layout-templates";
import type { TemplateLayer, TextLayer } from "../types";

function all(nodes: TemplateLayer[]): TemplateLayer[] {
  return nodes.flatMap((n) => (n.type === "frame" ? [n, ...all(n.children)] : [n]));
}

const basePlan: LayoutPlan = {
  template_id: "hero-centered",
  texts: [
    { id: "title", content: "2x1 en pizzas" },
    { id: "price", content: "$9.990" },
  ],
  hidden: [],
  colors: [
    { from: "#DC2626", to: "{color.primary}" },
    { from: "#FACC15", to: "#22C55E" },
  ],
  heading_font: "Montserrat, sans-serif",
  body_font: null,
  image_prompts: [{ id: "hero", prompt: "pepperoni pizza" }],
  rationale: "ok",
};

describe("describeCatalog", () => {
  it("describe todas las plantillas con slots de texto e imagen", () => {
    const cat = describeCatalog();
    expect(cat).toHaveLength(LAYOUT_TEMPLATES.length);
    const hero = cat.find((c) => c.id === "hero-centered")!;
    expect(hero.texts.map((t) => t.id).sort()).toEqual(["price", "title"]);
    expect(hero.images[0].id).toBe("hero");
    expect(hero.colors).toContain("#dc2626");
    expect(hero.texts.every((t) => t.max_chars > 0)).toBe(true);
  });
});

describe("expandPlan", () => {
  it("instancia master y orientaciones con textos, colores y fuentes del plan", () => {
    const out = expandPlan(basePlan, { w: 1920, h: 1080 }, [{ w: 1080, h: 1080 }, { w: 1080, h: 1920 }])!;
    expect(out.variants).toHaveLength(2);
    for (const def of [out.definition, ...out.variants.map((v) => v.definition)]) {
      expect(def.background).toEqual({ type: "color", value: "{color.primary}" });
      const layers = all(def.children);
      const title = layers.find((l) => l.id === "title") as TextLayer;
      expect(title.content).toBe("2x1 en pizzas");
      expect(title.style.fontFamily).toBe("Montserrat, sans-serif");
      expect(typeof title.style.fontSize).toBe("object"); // auto-fit
      // El par fondo+precio se fusiona y el fondo toma el color nuevo.
      const price = layers.find((l) => l.id === "price") as TextLayer;
      expect(price.style.backgroundColor).toBe("#22C55E");
      expect(layers.find((l) => l.id === "price-bg")).toBeUndefined();
    }
    expect(out.variants[1].definition.size).toEqual({ w: 1080, h: 1920 });
  });

  it("oculta capas pedidas y adapta dims no canónicas", () => {
    const out = expandPlan({ ...basePlan, hidden: ["price"] }, { w: 1200, h: 628 }, [])!;
    expect(out.definition.size).toEqual({ w: 1200, h: 628 });
    expect(all(out.definition.children).some((l) => l.id === "price")).toBe(false);
  });

  it("devuelve null con una plantilla inexistente", () => {
    expect(expandPlan({ ...basePlan, template_id: "nope" }, { w: 1920, h: 1080 }, [])).toBeNull();
  });
});

describe("sanitizePlan", () => {
  it("filtra ids ajenos y colores inválidos", () => {
    const plan = sanitizePlan({
      template_id: "hero-centered",
      texts: [{ id: "title", content: " Hola " }, { id: "ghost", content: "x" }],
      hidden: ["price", "ghost"],
      colors: [{ from: "#DC2626", to: "red; background:url(x)" }, { from: "#FACC15", to: "#fff" }],
      image_prompts: [{ id: "hero", prompt: "a pizza" }],
      rationale: "r",
    })!;
    expect(plan.texts).toEqual([{ id: "title", content: "Hola" }]);
    expect(plan.hidden).toEqual(["price"]);
    expect(plan.colors).toEqual([{ from: "#FACC15", to: "#fff" }]);
  });

  it("rechaza planes sin plantilla válida", () => {
    expect(sanitizePlan({ template_id: "x" })).toBeNull();
    expect(sanitizePlan(null)).toBeNull();
  });
});

describe("imágenes de la propuesta", () => {
  it("pide una imagen por slot y proporción, y las aplica en cada orientación", async () => {
    const { imageJobsFor, applyGeneratedImages, nearestImageRatio } = await import("../layout-plan");
    expect(nearestImageRatio(1920, 1080)).toBe("16:9");
    expect(nearestImageRatio(1080, 1920)).toBe("9:16");
    const plan: LayoutPlan = { ...basePlan, template_id: "badge-promo", image_prompts: [{ id: "hero", prompt: "shoes" }] };
    const out = expandPlan(plan, { w: 1920, h: 1080 }, [{ w: 1080, h: 1080 }, { w: 1080, h: 1920 }])!;
    const defs = [out.definition, ...out.variants.map((v) => v.definition)];
    const jobs = imageJobsFor(defs, plan.image_prompts);
    expect(jobs.map((j) => j.ratio).sort()).toEqual(["16:9", "1:1", "9:16"]);
    const images = jobs.map((j) => ({ slot_id: j.slot_id, ratio: j.ratio, url: `https://x/${j.ratio}.png` }));
    const vertical = applyGeneratedImages(out.variants[1].definition, images);
    const hero = all(vertical.children).find((l) => l.id === "hero");
    expect(hero && hero.type === "image" && hero.src).toBe("https://x/9:16.png");
  });
});

describe("ensureTextContrast", () => {
  it("pasa a blanco un texto oscuro que quedó sobre una pastilla azul", async () => {
    const { ensureTextContrast, contrastRatio } = await import("../layout-plan");
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    const plan: LayoutPlan = { ...basePlan, colors: [{ from: "#FACC15", to: "#005EB8" }, { from: "#111111", to: "#4D4D4D" }] };
    const out = expandPlan(plan, { w: 1920, h: 1080 }, [])!;
    const fixed = ensureTextContrast(out.definition, (c) => c);
    const price = all(fixed.children).find((l) => l.id === "price") as TextLayer;
    expect(price.style.color).toBe("#FFFFFF");
  });
});
