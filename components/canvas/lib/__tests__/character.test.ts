import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { HANDLE_IDS, type CharacterNodeData, type CharacterStage } from "../canvas-types";
import {
  composeCharacterPrompt,
  externalConnections,
  galleryImagesOf,
  planCharacterMaterialize,
  remapCharacterIds,
  resolveCharacterImageEdges,
  stagesAsText,
  stageReferenceUrls,
} from "../character";

function character(stages: CharacterStage[], extra: Partial<CharacterNodeData> = {}): Node {
  return {
    id: "char",
    type: "character",
    position: { x: 0, y: 0 },
    width: 360,
    data: { type: "character", label: "Ana", status: "completed", dna: "pelo rizado", stages, ...extra } as unknown as Record<string, unknown>,
  };
}
const gallery: Node = {
  id: "gal",
  type: "static-image-group",
  position: { x: -400, y: 0 },
  data: { label: "Fotos", status: "completed", images: [{ url: "https://x/1.png" }, { url: "https://x/2.png", caption: "hoy" }] },
};

const stages: CharacterStage[] = [
  { id: "s5", name: "5 años", text: "niña" },
  { id: "s15", name: "15 años", text: "adolescente" },
  { id: "s35", name: "35 años", text: "adulta", referenceImages: [{ nodeId: "gal", url: "https://x/2.png" }] },
];

function apply(nodes: Node[], edges: Edge[], plan: ReturnType<typeof planCharacterMaterialize>) {
  const rmN = new Set(plan.removeNodeIds);
  const rmE = new Set(plan.removeEdgeIds);
  const upd = new Map(plan.updateEdges.map((e) => [e.id, e]));
  return {
    nodes: [
      ...nodes.filter((n) => !rmN.has(n.id)).map((n) => (n.id === "char" ? { ...n, data: plan.characterData as unknown as Record<string, unknown> } : n)),
      ...plan.addNodes,
    ],
    edges: [...edges.filter((e) => !rmE.has(e.id)).map((e) => upd.get(e.id) ?? e), ...plan.addEdges],
  };
}

describe("planCharacterMaterialize", () => {
  it("al regenerar renombra las imágenes con el título nuevo de su etapa, salvo las renombradas a mano", () => {
    const first = planCharacterMaterialize(character(stages), [character(stages), gallery], [], { idPrefix: "a" });
    const state = apply([character(stages), gallery], [], first);
    const img = Object.fromEntries(first.characterData.stages.map((s) => [s.id, s.imageNodeId!]));
    expect(state.nodes.find((n) => n.id === img.s5)!.data.label).toBe("Ana · 5 años");
    // El usuario renombra a mano la imagen de 15 años y cambia los títulos de 5 y 15.
    const nodes = state.nodes.map((n) => (n.id === img.s15 ? { ...n, data: { ...n.data, label: "Mi favorita" } } : n));
    const char = nodes.find((n) => n.id === "char")!;
    const cd = char.data as unknown as CharacterNodeData;
    const edited = { ...char, data: { ...cd, stages: cd.stages.map((s) => (s.id === "s5" ? { ...s, name: "Niñez" } : s.id === "s15" ? { ...s, name: "Juventud" } : s)) } as unknown as Record<string, unknown> };
    const again = planCharacterMaterialize(edited, nodes.map((n) => (n.id === "char" ? edited : n)), state.edges, { idPrefix: "b" });
    expect(again.addNodes).toHaveLength(0);
    expect(again.renameNodes).toEqual([{ id: img.s5, label: "Ana · Niñez" }]);
    expect(again.characterData.imageLabels?.[img.s5]).toBe("Ana · Niñez");
    expect(again.characterData.imageLabels?.[img.s15]).toBeUndefined();
  });

  it("imágenes generadas antes del registro de nombres también se renombran si tienen la forma automática", () => {
    const withImg = stages.map((s, i) => (i === 0 ? { ...s, name: "Niñez", imageNodeId: "old" } : s));
    const char = character(withImg, { generatedImageIds: ["old"] });
    const oldImg: Node = { id: "old", type: "image", position: { x: 0, y: 0 }, data: { label: "Ana · 5 años", status: "completed" } };
    const plan = planCharacterMaterialize(char, [char, gallery, oldImg], [], { idPrefix: "c" });
    expect(plan.renameNodes).toEqual([{ id: "old", label: "Ana · Niñez" }]);
  });

  it("crea una imagen por etapa, encadenadas en el orden de la lista (1 → 2 → 3)", () => {
    const plan = planCharacterMaterialize(character(stages), [character(stages), gallery], [], { idPrefix: "t" });
    expect(plan.addNodes).toHaveLength(3);
    const img = Object.fromEntries(plan.characterData.stages.map((s) => [s.id, s.imageNodeId!]));
    const y = (id: string) => plan.addNodes.find((n) => n.id === id)!.position.y;
    expect(y(img.s5)).toBeLessThan(y(img.s15));
    expect(y(img.s15)).toBeLessThan(y(img.s35));

    const edge = (source: string, target: string, handle: string) =>
      plan.addEdges.find((e) => e.source === source && e.target === target && e.targetHandle === handle);
    for (const s of ["s5", "s15", "s35"]) expect(edge("char", img[s], HANDLE_IDS.INPUT_PROMPT)).toBeTruthy();
    // Continuidad 5 → 15 → 35 (la etapa 1 es referencia de la 2…), neutra:
    // las fotos propias llegan desde el Personaje con prioridad 1 al ejecutar.
    expect(edge(img.s5, img.s15, HANDLE_IDS.INPUT_REFERENCE)!.data).toBeUndefined();
    expect(edge(img.s15, img.s35, HANDLE_IDS.INPUT_REFERENCE)).toBeTruthy();
    expect(edge(img.s35, img.s15, HANDLE_IDS.INPUT_REFERENCE)).toBeUndefined();
    // La galería no se conecta a las imágenes (mandaría todas sus fotos).
    expect(plan.addEdges.some((e) => e.source === "gal")).toBe(false);
    expect(plan.addEdges).toHaveLength(5);
    expect(plan.characterData.managedEdgeIds).toHaveLength(5);
    expect(plan.warnings).toEqual([]);
  });

  it("volver a generar no duplica y agrega solo la etapa nueva en la cadena", () => {
    const first = planCharacterMaterialize(character(stages), [character(stages), gallery], [], { idPrefix: "a" });
    let state = apply([character(stages), gallery], [], first);
    const charData = state.nodes.find((n) => n.id === "char")!.data as unknown as CharacterNodeData;

    const again = planCharacterMaterialize(state.nodes.find((n) => n.id === "char")!, state.nodes, state.edges, { idPrefix: "b" });
    expect(again.addNodes).toHaveLength(0);
    expect(again.addEdges).toHaveLength(0);
    expect(again.removeEdgeIds).toHaveLength(0);

    const withNew = [...charData.stages.slice(0, 2), { id: "s25", name: "25 años", text: "joven" }, charData.stages[2]];
    const char2 = { ...state.nodes.find((n) => n.id === "char")!, data: { ...charData, stages: withNew } as unknown as Record<string, unknown> };
    state = { ...state, nodes: state.nodes.map((n) => (n.id === "char" ? char2 : n)) };
    const third = planCharacterMaterialize(char2, state.nodes, state.edges, { idPrefix: "c" });
    expect(third.addNodes).toHaveLength(1);
    const img = Object.fromEntries(third.characterData.stages.map((s) => [s.id, s.imageNodeId!]));
    const removed = state.edges.find((e) => e.source === img.s15 && e.target === img.s35)!;
    expect(third.removeEdgeIds).toContain(removed.id);
    expect(third.addEdges.some((e) => e.source === img.s15 && e.target === img.s25)).toBe(true);
    expect(third.addEdges.some((e) => e.source === img.s25 && e.target === img.s35)).toBe(true);
  });

  it("al reordenar y volver a generar, la cadena sigue el nuevo orden sin crear imágenes", () => {
    const first = planCharacterMaterialize(character(stages), [character(stages)], [], { idPrefix: "a" });
    const state = apply([character(stages)], [], first);
    const data = state.nodes.find((n) => n.id === "char")!.data as unknown as CharacterNodeData;
    // Nuevo orden: 35 → 15 → 5 (parte por la etapa actual).
    const reversed = [...data.stages].reverse();
    const char2 = { ...state.nodes.find((n) => n.id === "char")!, data: { ...data, stages: reversed, chainStale: true } as unknown as Record<string, unknown> };
    const plan = planCharacterMaterialize(char2, state.nodes.map((n) => (n.id === "char" ? char2 : n)), state.edges, { idPrefix: "b" });
    const img = Object.fromEntries(plan.characterData.stages.map((s) => [s.id, s.imageNodeId!]));
    expect(plan.addNodes).toHaveLength(0);
    expect(plan.addEdges.map((e) => [e.source, e.target])).toEqual([
      [img.s35, img.s15],
      [img.s15, img.s5],
    ]);
    expect(plan.removeEdgeIds).toHaveLength(2);
    expect(plan.characterData.chainStale).toBe(false);
  });

  it("al borrar una etapa elimina su imagen solo si nunca se generó", () => {
    const first = planCharacterMaterialize(character(stages), [character(stages)], [], { idPrefix: "a" });
    const state = apply([character(stages)], [], first);
    const data = state.nodes.find((n) => n.id === "char")!.data as unknown as CharacterNodeData;
    const img15 = data.stages[1].imageNodeId!;
    const img5 = data.stages[0].imageNodeId!;
    const nodes = state.nodes.map((n) => (n.id === img5 ? { ...n, data: { ...n.data, outputUrl: "https://x/5.png" } } : n));
    const char2 = { ...state.nodes.find((n) => n.id === "char")!, data: { ...data, stages: [data.stages[2]] } as unknown as Record<string, unknown> };
    const plan = planCharacterMaterialize(char2, nodes.map((n) => (n.id === "char" ? char2 : n)), state.edges, { idPrefix: "b" });
    expect(plan.removeNodeIds).toEqual([img15]);
    expect(plan.warnings.join(" ")).toMatch(/se conservó/);
    for (const id of state.edges.filter((e) => e.target === img5).map((e) => e.id)) expect(plan.removeEdgeIds).toContain(id);
  });

  it("no borra la imagen de una etapa eliminada si tiene conexiones del usuario", () => {
    const first = planCharacterMaterialize(character(stages), [character(stages)], [], { idPrefix: "a" });
    const state = apply([character(stages)], [], first);
    const data = state.nodes.find((n) => n.id === "char")!.data as unknown as CharacterNodeData;
    const img15 = data.stages[1].imageNodeId!;
    // El usuario usó la imagen de 15 años como primer cuadro de un video.
    const video: Node = { id: "vid", type: "video", position: { x: 0, y: 0 }, data: { label: "Video" } };
    const userEdge: Edge = { id: "u-vid", source: img15, target: "vid", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetHandle: HANDLE_IDS.INPUT_FIRST_FRAME };
    const char2 = { ...state.nodes.find((n) => n.id === "char")!, data: { ...data, stages: [data.stages[0], data.stages[2]] } as unknown as Record<string, unknown> };
    const nodes = [...state.nodes.map((n) => (n.id === "char" ? char2 : n)), video];
    const plan = planCharacterMaterialize(char2, nodes, [...state.edges, userEdge], { idPrefix: "b" });
    expect(plan.removeNodeIds).toEqual([]);
    expect(plan.removeEdgeIds).not.toContain("u-vid");
    expect(plan.warnings.join(" ")).toMatch(/conectada a otros nodos/);
    // La cadena se reconecta saltándose la etapa borrada: 5 → 35.
    const img = Object.fromEntries(plan.characterData.stages.map((st) => [st.id, st.imageNodeId!]));
    expect(plan.addEdges.some((e) => e.source === img.s5 && e.target === img.s35)).toBe(true);
    expect(externalConnections(img15, "char", data, [...state.edges, userEdge])).toEqual(["vid"]);
    expect(externalConnections(img.s5, "char", data, state.edges)).toEqual([]);
  });

  it("no toca conexiones del usuario", () => {
    const st: CharacterStage[] = [{ id: "a", name: "x", text: "y", imageNodeId: "img" }];
    const img: Node = { id: "img", type: "image", position: { x: 0, y: 0 }, data: { label: "img" } };
    const userEdge: Edge = { id: "u1", source: "gal", target: "img", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetHandle: HANDLE_IDS.INPUT_REFERENCE };
    const plan = planCharacterMaterialize(character(st), [character(st), gallery, img], [userEdge], { idPrefix: "t" });
    expect(plan.removeEdgeIds).toEqual([]);
  });
});

describe("fotos de referencia por etapa", () => {
  it("lee fotos de galería, imagen estática e imagen generada", () => {
    expect(galleryImagesOf(gallery).map((i) => i.url)).toEqual(["https://x/1.png", "https://x/2.png"]);
    expect(galleryImagesOf({ type: "static-image", data: { imageUrl: "https://x/s.png" } })).toEqual([{ url: "https://x/s.png", caption: undefined }]);
    expect(galleryImagesOf({ type: "image", data: { outputUrl: "https://x/o.png" } })).toEqual([{ url: "https://x/o.png" }]);
    expect(galleryImagesOf({ type: "image", data: {} })).toEqual([]);
  });

  it("solo entrega fotos de galerías todavía conectadas y que siguen existiendo", () => {
    const stage: CharacterStage = {
      id: "a", name: "x", text: "",
      referenceImages: [
        { nodeId: "gal", url: "https://x/2.png" },
        { nodeId: "gal", url: "https://x/borrada.png" },
        { nodeId: "otra", url: "https://x/1.png" },
      ],
    };
    expect(stageReferenceUrls(stage, [gallery])).toEqual(["https://x/2.png"]);
    expect(stageReferenceUrls(stage, [])).toEqual([]);
  });
});

describe("composeCharacterPrompt", () => {
  it("arma ADN + estilo + etapa", () => {
    const p = composeCharacterPrompt({ dna: "pelo rizado", style: "acuarela", stage: { id: "a", name: "8 años", text: "con mochila" }, hasReferences: true });
    expect(p).toContain("pelo rizado");
    expect(p).toContain("acuarela");
    expect(p).toContain("Etapa: 8 años\ncon mochila");
    expect(p).toMatch(/Mantén la identidad/);
  });
});

describe("remapCharacterIds", () => {
  it("remapea imagen y fotos; en plantillas descarta galerías de afuera", () => {
    const data = {
      stages: [{ id: "a", name: "x", text: "", imageNodeId: "i1", referenceImages: [{ nodeId: "g1", url: "u1" }, { nodeId: "ext", url: "u2" }] }],
      generatedImageIds: ["i1"],
      managedEdgeIds: ["e1"],
    };
    const idMap = new Map([["i1", "n1"], ["g1", "n2"]]);
    const paste = remapCharacterIds(data, idMap, new Map([["e1", "f1"]]));
    expect(paste.stages![0]).toMatchObject({ imageNodeId: "n1", referenceImages: [{ nodeId: "n2", url: "u1" }, { nodeId: "ext", url: "u2" }] });
    expect(paste.managedEdgeIds).toEqual(["f1"]);
    const tpl = remapCharacterIds(data, idMap, undefined, { keepExternalRefs: false });
    expect(tpl.stages![0].referenceImages).toEqual([{ nodeId: "n2", url: "u1" }]);
  });
});

describe("resolveCharacterImageEdges", () => {
  const imgNode = (id: string): Node => ({ id, type: "image", position: { x: 0, y: 0 }, data: { status: "completed", outputUrl: `https://x/${id}.png` } });
  const out = (id: string, target: string, targetHandle: string = HANDLE_IDS.INPUT_FIRST_FRAME): Edge => ({
    id, source: "char", sourceHandle: HANDLE_IDS.OUTPUT_CHARACTER_IMAGE, target, targetHandle, data: { priority: 2 },
  });
  const twoStages: CharacterStage[] = [
    { id: "a", name: "niña", text: "", imageNodeId: "imgA" },
    { id: "b", name: "adulta", text: "", imageNodeId: "imgB" },
    { id: "c", name: "vieja", text: "" },
  ];
  const prompt: Edge = { id: "p", source: "char", sourceHandle: HANDLE_IDS.OUTPUT_CHARACTER, target: "imgA", targetHandle: HANDLE_IDS.INPUT_PROMPT };

  it("cada conexión sale de la imagen de su etapa elegida, conservando id, destino y prioridad", () => {
    const ch = character(twoStages, { imageOutputs: { o1: "b", o2: "a" } });
    const nodes = [ch, imgNode("imgA"), imgNode("imgB"), imgNode("vid")];
    const r = resolveCharacterImageEdges(nodes, [prompt, out("o1", "vid"), out("o2", "vid", HANDLE_IDS.INPUT_LAST_FRAME)]);
    expect(r[0]).toBe(prompt);
    expect(r[1]).toMatchObject({ id: "o1", source: "imgB", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, target: "vid", data: { priority: 2 } });
    expect(r[2]).toMatchObject({ id: "o2", source: "imgA", targetHandle: HANDLE_IDS.INPUT_LAST_FRAME });
  });

  it("descarta conexiones sin etapa elegida, con etapa sin imagen, borrada o hacia su propia imagen", () => {
    const ch = character(twoStages, { imageOutputs: { o2: "c", o3: "zz", o4: "a" } });
    const nodes = [ch, imgNode("imgA"), imgNode("imgB"), imgNode("vid")];
    const r = resolveCharacterImageEdges(nodes, [out("o1", "vid"), out("o2", "vid"), out("o3", "vid"), out("o4", "imgA", HANDLE_IDS.INPUT_REFERENCE)]);
    expect(r).toEqual([]);
  });

  it("sin salidas de imagen devuelve el mismo array", () => {
    const edges = [prompt];
    expect(resolveCharacterImageEdges([character(twoStages)], edges)).toBe(edges);
  });

  it("remapCharacterIds lleva la etapa elegida a la conexión copiada", () => {
    const r = remapCharacterIds({ stages: [], imageOutputs: { o1: "a", gone: "b" } }, new Map(), new Map([["o1", "o9"]]));
    expect(r.imageOutputs).toEqual({ o9: "a" });
  });
});

describe("stagesAsText", () => {
  const list = [
    { name: "5 años", text: "niña con trenzas" },
    { name: "", text: "" },
    { name: "", text: "adolescente" },
    { name: "adulta", text: "" },
  ];
  it("solo títulos, uno por línea, sin etapas vacías", () => {
    expect(stagesAsText(list, false)).toBe("5 años\nEtapa 3\nadulta");
  });
  it("títulos con descripción en bloques", () => {
    expect(stagesAsText(list, true)).toBe("5 años\nniña con trenzas\n\nEtapa 3\nadolescente\n\nadulta");
  });
});
