import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { HANDLE_IDS, topHandleId } from "../canvas-types";
import { listConnectCandidates, type HandlesOf } from "../connect-candidates";

const node = (id: string, type: string, x = 0, y = 0): Node => ({ id, type, position: { x, y }, data: {} });

// Conectores que muestra cada tipo en estos tests (como los mediría React Flow).
const handles: Record<string, { source: string[]; target: string[] }> = {
  image: {
    source: [HANDLE_IDS.OUTPUT_IMAGE],
    target: [HANDLE_IDS.INPUT_PROMPT, topHandleId(HANDLE_IDS.INPUT_PROMPT), HANDLE_IDS.INPUT_REFERENCE, topHandleId(HANDLE_IDS.INPUT_REFERENCE)],
  },
  video: {
    source: [HANDLE_IDS.OUTPUT_VIDEO],
    target: [HANDLE_IDS.INPUT_PROMPT, HANDLE_IDS.INPUT_FIRST_FRAME, HANDLE_IDS.INPUT_LAST_FRAME, HANDLE_IDS.INPUT_REFERENCE],
  },
  character: {
    source: [HANDLE_IDS.OUTPUT_CHARACTER, HANDLE_IDS.OUTPUT_CHARACTER_IMAGE],
    target: [HANDLE_IDS.INPUT_CHARACTER_STYLE, HANDLE_IDS.INPUT_CHARACTER_GALLERY],
  },
  "static-text": { source: [HANDLE_IDS.OUTPUT_TEXT], target: [HANDLE_IDS.INPUT_TEXT_PARTS] },
};

function handlesFor(nodes: Node[]): HandlesOf {
  return (id) => handles[nodes.find((n) => n.id === id)?.type ?? ""] ?? { source: [], target: [] };
}

describe("listConnectCandidates", () => {
  it("desde la salida IMAGEN de un Personaje lista las entradas de imagen y video (sin gemelas)", () => {
    const nodes = [node("ch", "character"), node("img", "image", 500), node("vid", "video", 100)];
    const out = listConnectCandidates(
      { nodeId: "ch", handleId: HANDLE_IDS.OUTPUT_CHARACTER_IMAGE, handleType: "source" },
      nodes,
      [],
      handlesFor(nodes),
    );
    const keys = out.map((c) => `${c.nodeId}:${c.handleId}`);
    // El video está más cerca: va primero.
    expect(keys).toEqual([
      `vid:${HANDLE_IDS.INPUT_FIRST_FRAME}`,
      `vid:${HANDLE_IDS.INPUT_LAST_FRAME}`,
      `vid:${HANDLE_IDS.INPUT_REFERENCE}`,
      `img:${HANDLE_IDS.INPUT_REFERENCE}`,
    ]);
    expect(out[3].connection).toEqual({
      source: "ch",
      sourceHandle: HANDLE_IDS.OUTPUT_CHARACTER_IMAGE,
      target: "img",
      targetHandle: HANDLE_IDS.INPUT_REFERENCE,
    });
  });

  it("desde una entrada lista las salidas compatibles de otros nodos", () => {
    const nodes = [node("img", "image"), node("ch", "character", 300), node("other", "image", 600)];
    const out = listConnectCandidates(
      { nodeId: "img", handleId: topHandleId(HANDLE_IDS.INPUT_REFERENCE), handleType: "target" },
      nodes,
      [],
      handlesFor(nodes),
    );
    expect(out.map((c) => `${c.nodeId}:${c.handleId}`)).toEqual([
      `ch:${HANDLE_IDS.OUTPUT_CHARACTER_IMAGE}`,
      `other:${HANDLE_IDS.OUTPUT_IMAGE}`,
    ]);
    expect(out[0].connection.targetHandle).toBe(HANDLE_IDS.INPUT_REFERENCE);
  });

  it("omite conexiones repetidas, ciclos y entradas únicas ya usadas", () => {
    const nodes = [node("a", "image"), node("b", "image", 300), node("ch", "character", 600), node("t", "static-text", 900), node("t2", "static-text", 1200)];
    const edges: Edge[] = [
      { id: "e1", source: "a", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, target: "b", targetHandle: topHandleId(HANDLE_IDS.INPUT_REFERENCE) },
      { id: "e2", source: "t", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, target: "ch", targetHandle: HANDLE_IDS.INPUT_CHARACTER_STYLE },
    ];
    const fromA = listConnectCandidates({ nodeId: "a", handleId: HANDLE_IDS.OUTPUT_IMAGE, handleType: "source" }, nodes, edges, handlesFor(nodes));
    expect(fromA.map((c) => c.nodeId)).not.toContain("b"); // ya conectada
    const fromB = listConnectCandidates({ nodeId: "b", handleId: HANDLE_IDS.OUTPUT_IMAGE, handleType: "source" }, nodes, edges, handlesFor(nodes));
    expect(fromB.map((c) => c.nodeId)).not.toContain("a"); // ciclo
    const fromT2 = listConnectCandidates({ nodeId: "t2", handleId: HANDLE_IDS.OUTPUT_TEXT, handleType: "source" }, nodes, edges, handlesFor(nodes));
    expect(fromT2.some((c) => c.nodeId === "ch" && c.handleId === HANDLE_IDS.INPUT_CHARACTER_STYLE)).toBe(false); // un solo estilo
  });
});
