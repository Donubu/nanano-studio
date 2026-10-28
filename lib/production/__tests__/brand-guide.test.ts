import { describe, it, expect } from "vitest";
import { parseBrandGuide, brandGuideForModel } from "../brand-guide";

describe("parseBrandGuide", () => {
  it("lee el JSON aunque venga con texto o fences alrededor", () => {
    const raw = 'Listo, acá va:\n```json\n{"marca":"Enaco","voz":{"tono":"Cercano y técnico","tratamiento":"tú","palabras_evitar":["barato"]},"visual":{"colores":[{"nombre":"Azul","hex":"#003DA5","uso":"principal"},{"nombre":"malo","hex":"azul"}]},"reglas":["No deformar el logo"]}\n```';
    const g = parseBrandGuide(raw)!;
    expect(g.marca).toBe("Enaco");
    expect(g.voz.tratamiento).toBe("tú");
    expect(g.voz.palabras_evitar).toEqual(["barato"]);
    expect(g.visual.colores).toEqual([{ nombre: "Azul", hex: "#003DA5", uso: "principal" }]);
    expect(g.visual.logo.ancho_min_px).toBeNull();
  });

  it("rechaza respuestas sin contenido de marca", () => {
    expect(parseBrandGuide("no encontré nada")).toBeNull();
    expect(parseBrandGuide('{"marca":"X"}')).toBeNull();
  });

  it("la versión para el modelo omite vacíos y fuentes", () => {
    const g = parseBrandGuide('{"marca":"X","voz":{"tono":"serio"},"reglas":["a"],"fuentes":["brandbook_x"]}')!;
    expect(brandGuideForModel(g)).toEqual({ marca: "X", voz: { tono: "serio" }, reglas: ["a"] });
  });
});
