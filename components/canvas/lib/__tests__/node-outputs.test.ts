import { describe, it, expect } from "vitest";
import { HANDLE_IDS } from "../canvas-types";
import { galleryOutput, lookupFrom, scriptGalleryImages, staticTextOutput, type OutEdge, type OutNode } from "../node-outputs";
import { resolveScriptContext, sceneReferenceImages } from "../scene-context";

const st = (id: string, content: string, extra: Record<string, unknown> = {}): OutNode => ({ id, type: "static-text", data: { content, status: "completed", ...extra } });
const part = (id: string, source: string, target: string, sourceHandle: string = HANDLE_IDS.OUTPUT_TEXT): OutEdge => ({ id, source, target, sourceHandle, targetHandle: HANDLE_IDS.INPUT_TEXT_PARTS });

describe("texto estático con piezas", () => {
  it("piezas en orden de conexión + texto propio al final, con línea en blanco", () => {
    const nodes = [st("a", "uno"), st("b", "dos"), st("c", "propio")];
    const edges = [part("e1", "a", "c"), part("e2", "b", "c")];
    expect(staticTextOutput(nodes[2], lookupFrom(nodes), edges)).toBe("uno\n\ndos\n\npropio");
  });

  it("respeta partOrder, omite vacías y una IA sin generar", () => {
    const nodes: OutNode[] = [
      st("a", "uno"),
      { id: "ia", type: "text", data: { status: "idle", outputText: "viejo" } },
      st("vacio", "   "),
      st("c", "", { partOrder: ["e2", "e1"] }),
      { id: "ia2", type: "text", data: { status: "completed", outputText: "generado" } },
    ];
    const edges = [part("e1", "a", "c"), part("e2", "ia2", "c"), part("e3", "ia", "c"), part("e4", "vacio", "c")];
    expect(staticTextOutput(nodes[3], lookupFrom(nodes), edges)).toBe("generado\n\nuno");
  });

  it("anidado y con ciclo no se cuelga", () => {
    const nodes = [st("a", "A"), st("b", "B"), st("c", "C")];
    const edges = [part("e1", "a", "b"), part("e2", "b", "c"), part("e3", "c", "a")];
    expect(staticTextOutput(nodes[2], lookupFrom(nodes), edges)).toBe("A\n\nB\n\nC");
  });

  it("toma ADN de un Personaje vinculado y el gemelo superior de la entrada", () => {
    const linked: OutNode = { id: "l", type: "linked", data: { linkSnapshot: { kind: "character", label: "Ana", dna: "pelo rizado", style: "acuarela", stages: [] } } };
    const nodes = [linked, st("c", "en la playa")];
    const edges: OutEdge[] = [{ id: "e1", source: "l", target: "c", sourceHandle: HANDLE_IDS.OUTPUT_CHARACTER_DNA, targetHandle: `${HANDLE_IDS.INPUT_TEXT_PARTS}__top` }];
    expect(staticTextOutput(nodes[1], lookupFrom(nodes), edges)).toBe("pelo rizado\n\nen la playa");
  });
});

describe("galería con imágenes conectadas", () => {
  const nodes: OutNode[] = [
    { id: "g", type: "static-image-group", data: { images: [{ url: "u1" }] } },
    { id: "img", type: "image", data: { outputUrl: "u2" } },
    { id: "g2", type: "static-image-group", data: { images: [{ url: "u1" }, { url: "u3" }] } },
    { id: "char", type: "character", data: { stages: [{ id: "s", name: "niña", text: "", imageNodeId: "stimg" }], imageOutputs: { ec: "s" } } },
    { id: "stimg", type: "image", data: { outputUrl: "u4" } },
  ];
  const gal = (id: string, source: string, sourceHandle: string = HANDLE_IDS.OUTPUT_IMAGE): OutEdge => ({ id, source, target: "g", sourceHandle, targetHandle: HANDLE_IDS.INPUT_GALLERY_IMAGES });

  it("suma imagen, otra galería y la etapa del Personaje, sin repetir", () => {
    const edges = [gal("e1", "img"), gal("e2", "g2"), gal("ec", "char", HANDLE_IDS.OUTPUT_CHARACTER_IMAGE)];
    expect(galleryOutput(nodes[0], lookupFrom(nodes), edges).map((i) => i.url)).toEqual(["u1", "u2", "u3", "u4"]);
  });

  it("ciclo entre galerías no se cuelga", () => {
    const edges: OutEdge[] = [gal("e2", "g2"), { id: "back", source: "g", target: "g2", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetHandle: HANDLE_IDS.INPUT_GALLERY_IMAGES }];
    expect(galleryOutput(nodes[0], lookupFrom(nodes), edges).map((i) => i.url)).toEqual(["u1", "u3"]);
  });
});

describe("Galería del Guión", () => {
  const nodes: OutNode[] = [
    { id: "script", type: "script", data: { label: "Guión" } },
    { id: "s1", type: "scene", data: { sceneIndex: 1, totalScenes: 1, text: "ACCIÓN: x", scriptNodeId: "script" } },
    { id: "img", type: "image", data: { outputUrl: "u9" } },
    { id: "dest", type: "image", data: {} },
  ];
  const edges: OutEdge[] = [
    { id: "c", source: "script", target: "s1", sourceHandle: HANDLE_IDS.OUTPUT_SCRIPT_CHAIN, targetHandle: HANDLE_IDS.INPUT_SCRIPT_CHAIN },
    { id: "g", source: "img", target: "script", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetHandle: HANDLE_IDS.INPUT_GALLERY_IMAGES },
    { id: "p", source: "s1", target: "dest", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetHandle: HANDLE_IDS.INPUT_PROMPT },
  ];
  it("las imágenes del Guión llegan como referencia a lo que genera la escena", () => {
    expect(scriptGalleryImages("script", lookupFrom(nodes), edges)).toEqual(["u9"]);
    expect(sceneReferenceImages("dest", nodes as never, edges as never)).toEqual(["u9"]);
  });
  it("reglas del Guión desde un texto estático con piezas", () => {
    const withRules: OutNode[] = [...nodes, st("r1", "sin perros"), st("r2", "de día")];
    const e2: OutEdge[] = [...edges, { id: "r", source: "r2", target: "script", targetHandle: HANDLE_IDS.INPUT_RULES }, part("rp", "r1", "r2")];
    expect(resolveScriptContext("dest", withRules as never, e2 as never)).toContain("sin perros\n\nde día");
  });
});
