import { describe, it, expect } from "vitest";
import { HANDLE_IDS, type LinkedNodeData } from "../canvas-types";
import { buildCharacterSnapshot, linkedImageForEdge, linkedPromptForEdge, linkedStageForEdge, linkedTextForHandle, textOutputOf } from "../linked";
import { linkPatch } from "../linked-sync";
import { resolveCharacterImageEdges } from "../character";

const character = {
  id: "char",
  type: "character",
  data: {
    label: "Ana",
    dna: "pelo rizado",
    stages: [
      { id: "a", name: "niña", text: "5 años", imageNodeId: "imgA", referenceImages: [{ nodeId: "gal", url: "https://x/1.png" }, { nodeId: "gone", url: "https://x/9.png" }] },
      { id: "b", name: "adulta", text: "", imageNodeId: "imgB" },
      { id: "c", name: "vieja", text: "80 años" },
    ],
  },
};
const gallery = { id: "gal", type: "static-image-group", data: { images: [{ url: "https://x/1.png" }] } };
const style = { id: "sty", type: "static-text", data: { content: "acuarela" } };

describe("buildCharacterSnapshot", () => {
  it("resuelve estilo, fotos disponibles e imagen de cada etapa", () => {
    const snap = buildCharacterSnapshot({
      character,
      styleNode: style,
      galleries: [gallery],
      stageImages: [
        { id: "imgA", type: "image", data: { outputUrl: "https://x/a.png" } },
        { id: "imgB", type: "image", data: { outputUrl: null } },
      ],
    });
    expect(snap).toEqual({
      kind: "character",
      label: "Ana",
      dna: "pelo rizado",
      style: "acuarela",
      stages: [
        { id: "a", name: "niña", text: "5 años", photoUrls: ["https://x/1.png"], imageUrl: "https://x/a.png" },
        { id: "b", name: "adulta", text: "", photoUrls: [], imageUrl: null },
        { id: "c", name: "vieja", text: "80 años", photoUrls: [], imageUrl: null },
      ],
    });
  });

  it("un texto IA solo aporta estilo si ya terminó", () => {
    expect(textOutputOf({ type: "text", data: { status: "generating", outputText: "x" } })).toBe("");
    expect(textOutputOf({ type: "text", data: { status: "completed", outputText: "x" } })).toBe("x");
  });
});

describe("lectura por conexión", () => {
  const data = {
    type: "linked",
    label: "Ana",
    status: "completed",
    sourceType: "character",
    sourceConversationId: 7,
    sourceNodeId: "char",
    linkSnapshot: {
      kind: "character",
      label: "Ana",
      dna: "pelo rizado",
      style: "acuarela",
      stages: [{ id: "a", name: "niña", text: "5 años", photoUrls: [], imageUrl: "https://x/a.png" }],
    },
    imageOutputs: { e1: "a", e2: "zz" },
  } as unknown as LinkedNodeData;

  it("imagen y etapa según la conexión", () => {
    expect(linkedImageForEdge(data, "e1")).toBe("https://x/a.png");
    expect(linkedImageForEdge(data, "e2")).toBeNull();
    expect(linkedStageForEdge(data, "nada")).toBeNull();
  });

  it("prompt: ADN + estilo + etapa; sin etapa elegida, solo ADN + estilo", () => {
    const withStage = linkedPromptForEdge(data, "e1", false);
    expect(withStage).toContain("pelo rizado");
    expect(withStage).toContain("acuarela");
    expect(withStage).toContain("Etapa: niña");
    const noStage = linkedPromptForEdge(data, "otra", false);
    expect(noStage).toContain("pelo rizado");
    expect(noStage).not.toContain("Etapa:");
  });

  it("ADN y Estilo por separado; un vinculado como estilo entrega su estilo", () => {
    expect(linkedTextForHandle(data, HANDLE_IDS.OUTPUT_CHARACTER_DNA, "e1", false)).toBe("pelo rizado");
    expect(linkedTextForHandle(data, HANDLE_IDS.OUTPUT_CHARACTER_STYLE, "e1", false)).toBe("acuarela");
    expect(linkedTextForHandle(data, HANDLE_IDS.OUTPUT_TEXT, "e1", false)).toBe("");
    expect(textOutputOf({ type: "linked", data: data as unknown as Record<string, unknown> }, HANDLE_IDS.OUTPUT_CHARACTER_STYLE)).toBe("acuarela");
  });

  it("escena vinculada: su texto por la salida de texto", () => {
    const scene = { linkSnapshot: { kind: "scene", label: "Escena 2", scriptLabel: "G", text: "ACCIÓN: x", context: {} } } as unknown as LinkedNodeData;
    expect(linkedTextForHandle(scene, HANDLE_IDS.OUTPUT_TEXT, "e", false)).toBe("ACCIÓN: x");
    expect(linkedTextForHandle(scene, HANDLE_IDS.OUTPUT_CHARACTER_DNA, "e", false)).toBe("");
  });

  it("resolveCharacterImageEdges deja tal cual las salidas de un vinculado", () => {
    const edge = { id: "e1", source: "lnk", sourceHandle: HANDLE_IDS.OUTPUT_CHARACTER_IMAGE, target: "vid", targetHandle: HANDLE_IDS.INPUT_FIRST_FRAME };
    const r = resolveCharacterImageEdges([{ id: "lnk", type: "linked", data: data as unknown as Record<string, unknown> }], [edge]);
    expect(r).toEqual([edge]);
  });
});

describe("linkPatch", () => {
  const snapshot = { kind: "character" as const, label: "Ana 2", dna: "", style: "", stages: [] };
  it("actualiza solo si cambió el hash, el título o el estado", () => {
    const base = { linkState: "ok" as const, linkHash: "h1", sourceCanvasTitle: "Personajes" };
    const same = { conversationId: 1, nodeId: "c", state: "ok" as const, snapshot, hash: "h1", sourceCanvasTitle: "Personajes" };
    expect(linkPatch(base, same)).toBeNull();
    expect(linkPatch(base, { ...same, hash: "h2" })).toMatchObject({ linkHash: "h2", label: "Ana 2", linkSnapshot: snapshot });
  });
  it("borrado o sin acceso conserva la vista y solo cambia el estado", () => {
    const patch = linkPatch({ linkState: "ok", linkHash: "h1" }, { conversationId: 1, nodeId: "c", state: "deleted" });
    expect(patch).toEqual({ linkState: "deleted" });
    expect(linkPatch({ linkState: "deleted" }, { conversationId: 1, nodeId: "c", state: "deleted" })).toBeNull();
  });
});
