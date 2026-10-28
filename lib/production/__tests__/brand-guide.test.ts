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

describe("parseBrandGuide · estrategia", () => {
  it("lee posicionamiento, mensajes y productos con topes", () => {
    const g = parseBrandGuide(
      JSON.stringify({
        marca: "ENACO",
        estrategia: {
          posicionamiento: "La marca que acompaña el día a día",
          publico_objetivo: "Familias",
          mensajes_clave: ["Calidad", "Cercanía"],
          productos: [{ nombre: "Leche", descripcion: "Fresca" }, { descripcion: "sin nombre" }],
          campanas_vigentes: ["Verano 2027"],
        },
      }),
    )!;
    expect(g.estrategia?.posicionamiento).toBe("La marca que acompaña el día a día");
    expect(g.estrategia?.mensajes_clave).toEqual(["Calidad", "Cercanía"]);
    expect(g.estrategia?.productos).toEqual([{ nombre: "Leche", descripcion: "Fresca" }]);
  });
});

describe("parseBrandGuide · desempeño y legales", () => {
  it("lee evidencias con su métrica y descarta las vacías", () => {
    const g = parseBrandGuide(
      JSON.stringify({
        marca: "X",
        desempeno: {
          periodo: "jul–sep 2026",
          aprendizajes: ["Precio en el titular duplica el CTR"],
          ctas_destacados: [{ texto: "Compra ya", resultado: "CTR 1,9%" }, { resultado: "sin texto" }],
          formatos_destacados: [{ formato: "300x250", canal: "GDN", resultado: "CTR 0,8%" }],
        },
        legales: { textos_obligatorios: ["Imágenes referenciales"], restricciones: ["No decir 'el mejor'"] },
      }),
    )!;
    expect(g.desempeno?.ctas_destacados).toEqual([{ texto: "Compra ya", resultado: "CTR 1,9%" }]);
    expect(g.desempeno?.formatos_destacados[0].canal).toBe("GDN");
    expect(g.legales?.textos_obligatorios).toEqual(["Imágenes referenciales"]);
  });

  it("reconoce el error explícito del agente", async () => {
    const { brandGuideError } = await import("../brand-guide");
    expect(brandGuideError('{"error":"client_not_found","client_slug":"x"}')).toContain("slug");
    expect(brandGuideError('{"marca":"X"}')).toBeNull();
  });
});
