import { describe, it, expect } from "vitest";
import { lintBrand, requiredPhrases, normalizeText } from "../brand-lint";
import type { BrandGuide } from "../brand-guide";
import type { TemplateDefinition, TemplateLayer } from "../types";

const guide: BrandGuide = {
  marca: "Enaco",
  voz: {
    tono: "cercano",
    personalidad: [],
    tratamiento: "tú",
    palabras_usar: [],
    palabras_evitar: ["barato"],
    ejemplos_titulares: [],
    ejemplos_cta: [],
  },
  visual: {
    colores: [],
    tipografias: [],
    logo: { ancho_min_px: 80, area_seguridad: "20% del alto del logo", usos_prohibidos: [] },
    estilo_fotografico: "",
  },
  legales: {
    textos_obligatorios: ["Incluir siempre «www.enaco.cl» al pie", "*Precio incluye descuento"],
    restricciones: ["No usar el claim \"el mejor precio de Chile\""],
  },
  reglas: [],
  fuentes: [],
};

const text = (id: string, content: string, x = 0, y = 0, w = 300, h = 40): TemplateLayer =>
  ({ id, type: "text", content, position: { x, y }, size: { w, h }, style: { fontSize: 20, color: "#000" } }) as unknown as TemplateLayer;
const image = (id: string, x: number, y: number, w: number, h: number): TemplateLayer =>
  ({ id, type: "image", src: "x", position: { x, y }, size: { w, h } }) as unknown as TemplateLayer;
const def = (children: TemplateLayer[]): TemplateDefinition =>
  ({ size: { w: 600, h: 600 }, children, background: "#fff" }) as unknown as TemplateDefinition;

describe("requiredPhrases", () => {
  it("saca comillas y URLs; ítems cortos completos", () => {
    expect(requiredPhrases("Incluir siempre «www.enaco.cl» al pie")).toEqual(["www.enaco.cl"]);
    expect(requiredPhrases("*Precio incluye descuento")).toEqual(["*Precio incluye descuento"]);
    expect(requiredPhrases("Un párrafo largo de más de cuarenta caracteres sin comillas ni url")).toEqual([]);
  });
  it("normaliza acentos y espacios", () => {
    expect(normalizeText("  Óptimo   Precio ")).toBe("optimo precio");
  });
});

describe("lintBrand", () => {
  it("sin problemas cuando se cumple todo", () => {
    const d = def([image("logo", 20, 20, 120, 40), text("h", "Oferta Enaco", 0, 200), text("legal", "*Precio incluye descuento · www.enaco.cl", 0, 540)]);
    expect(lintBrand(d, guide)).toEqual([]);
  });
  it("marca legales faltantes, logo chico y claims prohibidos", () => {
    const d = def([image("logo", 20, 20, 60, 20), text("h", "El mejor precio de Chile, barato", 0, 200), text("b", "con enaco", 0, 300)]);
    const kinds = lintBrand(d, guide).map((i) => i.kind);
    expect(kinds).toContain("brand_logo_size");
    expect(kinds.filter((k) => k === "brand_missing_legal")).toHaveLength(2);
    expect(kinds.filter((k) => k === "brand_forbidden_text")).toHaveLength(2);
    expect(kinds).toContain("brand_name_case");
  });
  it("detecta invasión del área de seguridad del logo pero no su placa", () => {
    const d = def([
      { ...image("plate", 10, 10, 140, 60), type: "shape" } as unknown as TemplateLayer,
      image("logo", 20, 20, 120, 40),
      text("h", "Titular pegado", 142, 25, 200, 30),
      text("legal", "*Precio incluye descuento www.enaco.cl", 0, 540),
    ]);
    const issues = lintBrand(d, guide);
    expect(issues.map((i) => i.kind)).toEqual(["brand_logo_space"]);
    expect(issues[0].layerIds).toEqual(["h", "logo"]);
  });
  it("sin guía solo revisa que el logo se lea", () => {
    expect(lintBrand(def([image("logo", 0, 0, 10, 10)]), null).map((i) => i.kind)).toEqual(["brand_logo_size"]);
    expect(lintBrand(def([image("logo", 0, 0, 100, 40)]), null)).toEqual([]);
  });
});
