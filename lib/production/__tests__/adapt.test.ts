import { describe, it, expect } from "vitest";
import { adaptTree, isLinearFormat, LINEAR_ASPECT_DIFF } from "../adapt";
import type { TemplateDefinition, TextLayer, ShapeLayer, ImageLayer } from "../types";

function hero(): TemplateDefinition {
  // Réplica del layout "Hero Centered" 1920×1080: titular ancho arriba,
  // imagen al centro, badge de precio abajo (text con fondo).
  const title: TextLayer = {
    id: "title",
    type: "text",
    content: "TU TITULAR ACÁ",
    position: { x: 80, y: 100 },
    size: { w: 1760, h: 200 },
    style: { fontSize: 140, fontWeight: 800, color: "#fff", lineHeight: 1.05, align: "center" },
  };
  const img: ImageLayer = {
    id: "hero",
    type: "image",
    src: "https://example.com/x.jpg",
    position: { x: 660, y: 320 },
    size: { w: 600, h: 600 },
    fit: "cover",
  };
  const price: TextLayer = {
    id: "price",
    type: "text",
    content: "$0.000",
    position: { x: 760, y: 880 },
    size: { w: 400, h: 140 },
    style: { fontSize: 96, fontWeight: 900, color: "#000", backgroundColor: "#FACC15", backgroundCornerRadius: 16, align: "center", verticalAlign: "middle" },
  };
  return {
    id: "tpl_root",
    type: "frame",
    position: { x: 0, y: 0 },
    size: { w: 1920, h: 1080 },
    background: { type: "color", value: "#DC2626" },
    layout: { mode: "free" },
    children: [title, img, price],
  };
}

const fontOf = (l: TextLayer) => (typeof l.style.fontSize === "number" ? l.style.fontSize : (l.style.fontSize as { max: number }).max);
const inside = (l: { position: { x: number; y: number }; size: { w: number; h: number } }, w: number, h: number) =>
  l.position.x >= -0.5 && l.position.y >= -0.5 && l.position.x + l.size.w <= w + 0.5 && l.position.y + l.size.h <= h + 0.5;

describe("isLinearFormat", () => {
  it("clasifica tiras como lineales y rectángulos parecidos como reflow", () => {
    expect(isLinearFormat({ w: 1920, h: 1080 }, { w: 728, h: 90 })).toBe(true);
    expect(isLinearFormat({ w: 1080, h: 1920 }, { w: 160, h: 600 })).toBe(true);
    expect(isLinearFormat({ w: 1080, h: 1080 }, { w: 300, h: 250 })).toBe(false);
    expect(isLinearFormat({ w: 1080, h: 1920 }, { w: 300, h: 600 })).toBe(false);
    expect(LINEAR_ASPECT_DIFF).toBeGreaterThan(0.2);
  });
});

describe("adaptTree — formato parecido (reflow + ajuste)", () => {
  it("escala la tipografía con la caja y mantiene todo dentro del formato", () => {
    const out = adaptTree(hero(), { w: 336, h: 280 });
    expect(out.size).toEqual({ w: 336, h: 280 });
    for (const c of out.children) expect(inside(c, 336, 280)).toBe(true);
    const title = out.children.find((c) => c.id === "title") as TextLayer;
    // 140px en 1920 no puede llegar a 140px en 336, pero tampoco debe
    // quedar ilegible: el escalado uniforme previo lo deja cerca de 140×(280/1080).
    expect(fontOf(title)).toBeLessThan(60);
    expect(fontOf(title)).toBeGreaterThanOrEqual(20);
    const price = out.children.find((c) => c.id === "price") as TextLayer;
    expect(price.size.w).toBeLessThanOrEqual(336);
    expect(fontOf(price)).toBeLessThan(96);
    expect(price.style.backgroundCornerRadius).toBeLessThan(16);
  });

  it("devuelve el mismo árbol si el tamaño no cambia", () => {
    const m = hero();
    expect(adaptTree(m, { w: 1920, h: 1080 })).toBe(m);
  });
});

describe("adaptTree — tira extrema (recomposición lineal)", () => {
  it("leaderboard 728×90: fila en orden de lectura, todo dentro y legible", () => {
    const out = adaptTree(hero(), { w: 728, h: 90 });
    expect(out.size).toEqual({ w: 728, h: 90 });
    expect(out.layout.mode).toBe("free");
    expect(out.children).toHaveLength(3);
    for (const c of out.children) expect(inside(c, 728, 90)).toBe(true);
    // Sin superposición horizontal entre ítems consecutivos.
    const sorted = [...out.children].sort((a, b) => a.position.x - b.position.x);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].position.x).toBeGreaterThanOrEqual(sorted[i - 1].position.x + sorted[i - 1].size.w - 0.5);
    }
    const title = out.children.find((c) => c.id === "title") as TextLayer;
    expect(title.size.h).toBeLessThanOrEqual(90);
    expect(fontOf(title)).toBeGreaterThanOrEqual(7);
    expect(fontOf(title)).toBeLessThanOrEqual(90);
    // El badge conserva su forma (escala uniforme) y su fondo.
    const price = out.children.find((c) => c.id === "price") as TextLayer;
    expect(price.style.backgroundColor).toBe("#FACC15");
    expect(Math.abs(price.size.w / price.size.h - 400 / 140)).toBeLessThan(0.05);
  });

  it("skyscraper 160×600: columna, imagen y badge no exceden el ancho", () => {
    const out = adaptTree(hero(), { w: 160, h: 600 });
    for (const c of out.children) expect(inside(c, 160, 600)).toBe(true);
    const sorted = [...out.children].sort((a, b) => a.position.y - b.position.y);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].position.y).toBeGreaterThanOrEqual(sorted[i - 1].position.y + sorted[i - 1].size.h - 0.5);
    }
    expect(sorted.map((c) => c.id)).toEqual(["title", "hero", "price"]);
  });

  it("los fondos a pantalla completa se estiran al formato", () => {
    const m = hero();
    const bg: ShapeLayer = {
      id: "bg",
      type: "shape",
      shape: "rect",
      fill: "#000",
      position: { x: 0, y: 0 },
      size: { w: 1920, h: 1080 },
    };
    m.children.unshift(bg);
    const out = adaptTree(m, { w: 320, h: 50 });
    const outBg = out.children.find((c) => c.id === "bg")!;
    expect(outBg.position).toEqual({ x: 0, y: 0 });
    expect(outBg.size).toEqual({ w: 320, h: 50 });
    expect(out.children[0].id).toBe("bg");
  });
});

describe("adaptTree para producción", () => {
  const W = 1920;
  const H = 1080;
  function piece(): TemplateDefinition {
    return {
      id: "tpl_root",
      type: "frame",
      position: { x: 0, y: 0 },
      size: { w: W, h: H },
      background: { type: "color", value: "#000" },
      layout: { mode: "free" },
      children: [
        // Foto agrandada para reencuadrar: sangra por la derecha y arriba.
        { id: "bg", type: "image", src: "x", position: { x: -400, y: -200 }, size: { w: 2880, h: 1620 } } as ImageLayer,
        { id: "badge", type: "text", content: "-20%", position: { x: 80, y: 60 }, size: { w: 220, h: 220 }, style: { fontSize: 60, color: "#000", backgroundColor: "#FACC15", backgroundCornerRadius: 110 } } as TextLayer,
        { id: "title", type: "text", content: "VUELA SIN LÍMITES", position: { x: 80, y: 380 }, size: { w: 1100, h: 160 }, style: { fontSize: 120, fontWeight: 800, color: "#fff" } } as TextLayer,
        { id: "sub", type: "text", content: "Zapatillas ultra livianas para correr todo el año", position: { x: 80, y: 560 }, size: { w: 1000, h: 60 }, style: { fontSize: 36, color: "#fff" } } as TextLayer,
        { id: "truck", type: "icon", iconName: "Truck", color: "#fff", position: { x: 700, y: 900 }, size: { w: 48, h: 48 } },
        { id: "ship", type: "text", content: "Envío gratis a todo Chile", position: { x: 760, y: 905 }, size: { w: 500, h: 40 }, style: { fontSize: 30, color: "#fff" } } as TextLayer,
        { id: "cta", type: "text", content: "COMPRAR", position: { x: 80, y: 880 }, size: { w: 560, h: 90 }, style: { fontSize: 48, fontWeight: 800, color: "#000", backgroundColor: "#FACC15", backgroundCornerRadius: 8 } } as TextLayer,
      ],
    };
  }
  const visibleIds = (d: TemplateDefinition) => d.children.filter((c) => c.visible !== false).map((c) => c.id);
  const covers = (d: TemplateDefinition, id: string) => {
    const l = d.children.find((c) => c.id === id)!;
    return l.position.x <= 0.5 && l.position.y <= 0.5 && l.position.x + l.size.w >= d.size.w - 0.5 && l.position.y + l.size.h >= d.size.h - 0.5;
  };

  for (const size of [{ w: 300, h: 250 }, { w: 300, h: 600 }, { w: 728, h: 90 }, { w: 160, h: 600 }, { w: 970, h: 250 }]) {
    it(`${size.w}×${size.h}: el fondo que sangra sigue cubriendo y conserva su proporción`, () => {
      const out = adaptTree(piece(), size);
      expect(covers(out, "bg")).toBe(true);
      const bg = out.children.find((c) => c.id === "bg")!;
      expect(bg.size.w / bg.size.h).toBeCloseTo(2880 / 1620, 1);
    });
  }

  it("el badge circular sigue circular en formatos parecidos", () => {
    const out = adaptTree(piece(), { w: 300, h: 250 });
    const b = out.children.find((c) => c.id === "badge")!;
    expect(b.size.w / b.size.h).toBeCloseTo(1, 1);
  });

  it("en una tira chica oculta primero lo secundario (con su ícono) y deja titular y CTA", () => {
    const out = adaptTree(piece(), { w: 320, h: 50 });
    const vis = visibleIds(out);
    expect(vis).toContain("title");
    expect(vis).toContain("cta");
    expect(vis).not.toContain("truck");
    // Ocultas, no borradas.
    expect(out.children.some((c) => c.id === "ship" && c.visible === false)).toBe(true);
  });

  it("en un leaderboard el CTA va al final de la fila", () => {
    const out = adaptTree(piece(), { w: 728, h: 90 });
    const row = out.children.filter((c) => c.visible !== false && c.id !== "bg").sort((a, b) => a.position.x - b.position.x);
    expect(row.at(-1)!.id).toBe("cta");
  });
});
