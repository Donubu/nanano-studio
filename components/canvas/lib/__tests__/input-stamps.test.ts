import { describe, it, expect } from "vitest";
import { HANDLE_IDS } from "../canvas-types";
import { computeInputStamps, describeStale, staleInputs } from "../input-stamps";
import { galleryOutput, lookupFrom, type OutEdge, type OutNode } from "../node-outputs";
import { isValidConnection } from "../connection-rules";

function linked(stages: { id: string; name: string; text: string; imageUrl: string | null }[], dna = "ADN", imageOutputs: Record<string, string> = {}): OutNode {
  return {
    id: "lk",
    type: "linked",
    data: {
      sourceType: "character",
      imageOutputs,
      linkSnapshot: {
        kind: "character",
        label: "Mike",
        dna,
        style: "estilo",
        stages: stages.map((s) => ({ ...s, photoUrls: [] })),
      },
    },
  };
}

const stages = [
  { id: "s1", name: "Niño", text: "a los 8", imageUrl: "https://x/1.png" },
  { id: "s2", name: "Adulto", text: "a los 40", imageUrl: "https://x/2.png" },
];

describe("input stamps", () => {
  const edges: OutEdge[] = [
    { id: "e-img", source: "lk", sourceHandle: HANDLE_IDS.OUTPUT_CHARACTER_IMAGE, target: "vid", targetHandle: HANDLE_IDS.INPUT_FIRST_FRAME },
    { id: "e-prompt", source: "lk", sourceHandle: HANDLE_IDS.OUTPUT_CHARACTER, target: "vid", targetHandle: HANDLE_IDS.INPUT_PROMPT },
    { id: "e-text", source: "txt", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, target: "vid", targetHandle: HANDLE_IDS.INPUT_PROMPT },
  ];
  const outputs = { "e-img": "s1", "e-prompt": "s1" };

  function generatedWith(lk: OutNode): OutNode {
    const lookup = lookupFrom([lk, { id: "txt", type: "static-text", data: { content: "hola" } }]);
    return { id: "vid", type: "video", data: { status: "completed", inputStamps: computeInputStamps("vid", lookup, edges) } };
  }

  it("solo vigila conexiones de Personajes (no el texto estático)", () => {
    const vid = generatedWith(linked(stages, "ADN", outputs));
    expect(Object.keys(vid.data.inputStamps as object).sort()).toEqual(["e-img", "e-prompt"]);
  });

  it("sin cambios no está desactualizado", () => {
    const lk = linked(stages, "ADN", outputs);
    const vid = generatedWith(lk);
    expect(staleInputs(vid, lookupFrom([lk, vid]), edges)).toEqual([]);
  });

  it("cambiar otra etapa no lo desactualiza; cambiar la suya sí", () => {
    const vid = generatedWith(linked(stages, "ADN", outputs));
    const otherStage = linked([stages[0], { ...stages[1], text: "a los 45" }], "ADN", outputs);
    expect(staleInputs(vid, lookupFrom([otherStage, vid]), edges)).toEqual([]);

    const ownStage = linked([{ ...stages[0], imageUrl: "https://x/1b.png" }, stages[1]], "ADN", outputs);
    const stale = staleInputs(vid, lookupFrom([ownStage, vid]), edges);
    expect(stale).toEqual([{ edgeId: "e-img", source: "Mike", stage: "Niño" }]);
    expect(describeStale(stale)).toBe("Mike (Niño) cambió desde que se generó");
  });

  it("cambiar el ADN desactualiza el prompt", () => {
    const vid = generatedWith(linked(stages, "ADN", outputs));
    const stale = staleInputs(vid, lookupFrom([linked(stages, "ADN nuevo", outputs), vid]), edges);
    expect(stale.map((s) => s.edgeId)).toEqual(["e-prompt"]);
  });

  it("Personaje local: editar el texto de la etapa desactualiza su imagen", () => {
    const character = (text: string): OutNode => ({
      id: "ch",
      type: "character",
      data: { dna: "ADN", stages: [{ id: "s1", name: "Niño", text, imageNodeId: "img1" }] },
    });
    const e: OutEdge[] = [{ id: "e1", source: "ch", sourceHandle: HANDLE_IDS.OUTPUT_CHARACTER, target: "img1", targetHandle: HANDLE_IDS.INPUT_PROMPT }];
    const img: OutNode = { id: "img1", type: "image", data: { status: "completed" } };
    img.data.inputStamps = computeInputStamps("img1", lookupFrom([character("a los 8"), img]), e);
    expect(staleInputs(img, lookupFrom([character("a los 8"), img]), e)).toEqual([]);
    expect(staleInputs(img, lookupFrom([character("a los 9"), img]), e)).toEqual([{ edgeId: "e1", source: "Personaje", stage: "Niño" }]);
  });

  it("sin huellas o sin resultado no avisa", () => {
    const lk = linked(stages, "ADN nuevo", outputs);
    expect(staleInputs({ id: "vid", type: "video", data: { status: "completed" } }, lookupFrom([lk]), edges)).toEqual([]);
    const vid = generatedWith(linked(stages, "ADN", outputs));
    vid.data.status = "error";
    expect(staleInputs(vid, lookupFrom([lk, vid]), edges)).toEqual([]);
  });
});

describe("imagen vinculada", () => {
  const linkedImage = (url: string | null): OutNode => ({
    id: "li",
    type: "linked",
    data: { sourceType: "image", linkSnapshot: { kind: "image", label: "Cierre acto 1", imageUrl: url, prompt: "" } },
  });
  const edges: OutEdge[] = [
    { id: "e1", source: "li", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, target: "vid", targetHandle: HANDLE_IDS.INPUT_FIRST_FRAME },
  ];

  it("regenerar el original desactualiza lo que la usó", () => {
    const vid: OutNode = { id: "vid", type: "video", data: { status: "completed" } };
    vid.data.inputStamps = computeInputStamps("vid", lookupFrom([linkedImage("https://x/a.png"), vid]), edges);
    expect(staleInputs(vid, lookupFrom([linkedImage("https://x/a.png"), vid]), edges)).toEqual([]);
    expect(staleInputs(vid, lookupFrom([linkedImage("https://x/b.png"), vid]), edges)).toEqual([
      { edgeId: "e1", source: "Cierre acto 1", stage: undefined },
    ]);
  });

  it("una galería conectada la entrega como una foto más", () => {
    const gallery: OutNode = { id: "g", type: "static-image-group", data: { images: [{ url: "https://x/own.png" }] } };
    const e: OutEdge[] = [{ id: "e2", source: "li", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, target: "g", targetHandle: HANDLE_IDS.INPUT_GALLERY_IMAGES }];
    expect(galleryOutput(gallery, lookupFrom([gallery, linkedImage("https://x/a.png")]), e).map((i) => i.url)).toEqual([
      "https://x/own.png",
      "https://x/a.png",
    ]);
  });

  it("se conecta como una imagen estática (no como referencia visual del Guión)", () => {
    const nodes = [
      { id: "li", type: "linked", position: { x: 0, y: 0 }, data: {} },
      { id: "vid", type: "video", position: { x: 0, y: 0 }, data: {} },
      { id: "sc", type: "script", position: { x: 0, y: 0 }, data: {} },
    ];
    const conn = (target: string, targetHandle: string) => ({ source: "li", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, target, targetHandle });
    expect(isValidConnection(conn("vid", HANDLE_IDS.INPUT_FIRST_FRAME), nodes, [])).toBe(true);
    expect(isValidConnection(conn("sc", HANDLE_IDS.INPUT_GALLERY_IMAGES), nodes, [])).toBe(true);
    expect(isValidConnection(conn("sc", HANDLE_IDS.INPUT_VISUAL_REFERENCE), nodes, [])).toBe(false);
  });
});
