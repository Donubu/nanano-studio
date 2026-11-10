import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { HANDLE_IDS, type CharacterNodeData, type CharacterStage } from "../canvas-types";
import { composeCharacterPrompt, planCharacterMaterialize, remapCharacterIds } from "../character";

function character(stages: CharacterStage[], extra: Partial<CharacterNodeData> = {}): Node {
  return {
    id: "char",
    type: "character",
    position: { x: 0, y: 0 },
    width: 360,
    data: { type: "character", label: "Ana", status: "completed", stages, ...extra } as unknown as Record<string, unknown>,
  };
}
const photo: Node = { id: "photo", type: "static-image", position: { x: -400, y: 0 }, data: { label: "Foto actual", status: "completed", imageUrl: "x" } };

const stages: CharacterStage[] = [
  { id: "s5", name: "5 años", text: "niña" },
  { id: "s15", name: "15 años", text: "adolescente" },
  { id: "s35", name: "35 años", text: "adulta", referenceNodeId: "photo" },
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
  it("crea una imagen por etapa, encadenadas de la más reciente a la más antigua", () => {
    const plan = planCharacterMaterialize(character(stages), [character(stages), photo], [], { idPrefix: "t" });
    expect(plan.addNodes).toHaveLength(3);
    const img = Object.fromEntries(plan.characterData.stages.map((s) => [s.id, s.imageNodeId!]));
    // La más reciente arriba.
    const y = (id: string) => plan.addNodes.find((n) => n.id === id)!.position.y;
    expect(y(img.s35)).toBeLessThan(y(img.s15));
    expect(y(img.s15)).toBeLessThan(y(img.s5));

    const edge = (source: string, target: string, handle: string) =>
      plan.addEdges.find((e) => e.source === source && e.target === target && e.targetHandle === handle);
    for (const s of ["s5", "s15", "s35"]) expect(edge("char", img[s], HANDLE_IDS.INPUT_PROMPT)).toBeTruthy();
    // Foto propia con prioridad 1 en la etapa más reciente.
    expect(edge("photo", img.s35, HANDLE_IDS.INPUT_REFERENCE)!.data).toEqual({ priority: 1 });
    // Continuidad: 35 → 15 → 5, neutra (esas etapas no tienen foto propia).
    expect(edge(img.s35, img.s15, HANDLE_IDS.INPUT_REFERENCE)!.data).toBeUndefined();
    expect(edge(img.s15, img.s5, HANDLE_IDS.INPUT_REFERENCE)).toBeTruthy();
    expect(edge(img.s5, img.s15, HANDLE_IDS.INPUT_REFERENCE)).toBeUndefined();
    expect(plan.characterData.managedEdgeIds).toHaveLength(plan.addEdges.length);
    expect(plan.warnings).toEqual([]);
  });

  it("con foto propia, la continuidad baja a prioridad 2", () => {
    const st: CharacterStage[] = [
      { id: "a", name: "niño", text: "x", referenceNodeId: "photo" },
      { id: "b", name: "adulto", text: "y" },
    ];
    const plan = planCharacterMaterialize(character(st), [character(st), photo], [], { idPrefix: "t" });
    const img = Object.fromEntries(plan.characterData.stages.map((s) => [s.id, s.imageNodeId!]));
    const cont = plan.addEdges.find((e) => e.source === img.b && e.target === img.a)!;
    expect(cont.data).toEqual({ priority: 2 });
  });

  it("volver a generar no duplica y agrega solo la etapa nueva en la cadena", () => {
    const first = planCharacterMaterialize(character(stages), [character(stages), photo], [], { idPrefix: "a" });
    let state = apply([character(stages), photo], [], first);
    const charData = state.nodes.find((n) => n.id === "char")!.data as unknown as CharacterNodeData;

    const again = planCharacterMaterialize(state.nodes.find((n) => n.id === "char")!, state.nodes, state.edges, { idPrefix: "b" });
    expect(again.addNodes).toHaveLength(0);
    expect(again.addEdges).toHaveLength(0);
    expect(again.removeEdgeIds).toHaveLength(0);

    // Etapa nueva entre 15 y 35.
    const withNew = [...charData.stages.slice(0, 2), { id: "s25", name: "25 años", text: "joven" }, charData.stages[2]];
    const char2 = { ...state.nodes.find((n) => n.id === "char")!, data: { ...charData, stages: withNew } as unknown as Record<string, unknown> };
    state = { ...state, nodes: state.nodes.map((n) => (n.id === "char" ? char2 : n)) };
    const third = planCharacterMaterialize(char2, state.nodes, state.edges, { idPrefix: "c" });
    expect(third.addNodes).toHaveLength(1);
    const img = Object.fromEntries(third.characterData.stages.map((s) => [s.id, s.imageNodeId!]));
    // La continuidad vieja 35 → 15 se reemplaza por 35 → 25 → 15.
    const removed = state.edges.find((e) => e.source === img.s35 && e.target === img.s15)!;
    expect(third.removeEdgeIds).toContain(removed.id);
    expect(third.addEdges.some((e) => e.source === img.s35 && e.target === img.s25)).toBe(true);
    expect(third.addEdges.some((e) => e.source === img.s25 && e.target === img.s15)).toBe(true);
  });

  it("al borrar una etapa elimina su imagen solo si nunca se generó", () => {
    const first = planCharacterMaterialize(character(stages), [character(stages), photo], [], { idPrefix: "a" });
    const state = apply([character(stages), photo], [], first);
    const data = state.nodes.find((n) => n.id === "char")!.data as unknown as CharacterNodeData;
    const img15 = data.stages[1].imageNodeId!;
    const img5 = data.stages[0].imageNodeId!;
    // La de 5 años ya tiene resultado.
    const nodes = state.nodes.map((n) => (n.id === img5 ? { ...n, data: { ...n.data, outputUrl: "https://x/5.png" } } : n));
    const char2 = { ...state.nodes.find((n) => n.id === "char")!, data: { ...data, stages: [data.stages[2]] } as unknown as Record<string, unknown> };
    const plan = planCharacterMaterialize(char2, nodes.map((n) => (n.id === "char" ? char2 : n)), state.edges, { idPrefix: "b" });
    expect(plan.removeNodeIds).toEqual([img15]);
    expect(plan.warnings.join(" ")).toMatch(/se conservó/);
    // La imagen conservada queda sin las conexiones que puso Generar.
    const managedTo5 = state.edges.filter((e) => e.target === img5).map((e) => e.id);
    for (const id of managedTo5) expect(plan.removeEdgeIds).toContain(id);
  });

  it("no toca conexiones del usuario y avisa si la referencia ya no existe", () => {
    const st: CharacterStage[] = [{ id: "a", name: "x", text: "y", referenceNodeId: "borrado", imageNodeId: "img" }];
    const img: Node = { id: "img", type: "image", position: { x: 0, y: 0 }, data: { label: "img" } };
    const userEdge: Edge = { id: "u1", source: "photo", target: "img", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetHandle: HANDLE_IDS.INPUT_REFERENCE };
    const plan = planCharacterMaterialize(character(st), [character(st), photo, img], [userEdge], { idPrefix: "t" });
    expect(plan.removeEdgeIds).toEqual([]);
    expect(plan.warnings[0]).toMatch(/ya no existe/);
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
  it("remapea imagen y referencia; descarta las de afuera en plantillas", () => {
    const data = { stages: [{ id: "a", name: "x", text: "", imageNodeId: "i1", referenceNodeId: "ext" }], generatedImageIds: ["i1"], managedEdgeIds: ["e1"] };
    const idMap = new Map([["i1", "n1"]]);
    const paste = remapCharacterIds(data, idMap, new Map([["e1", "f1"]]));
    expect(paste.stages![0]).toMatchObject({ imageNodeId: "n1", referenceNodeId: "ext" });
    expect(paste.managedEdgeIds).toEqual(["f1"]);
    const tpl = remapCharacterIds(data, idMap, undefined, { keepExternalRefs: false });
    expect(tpl.stages![0].referenceNodeId).toBeUndefined();
  });
});
