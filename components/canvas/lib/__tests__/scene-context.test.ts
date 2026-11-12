import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { HANDLE_IDS } from "../canvas-types";
import { collectSceneContext, composeScriptContext, resolveScriptContext } from "../scene-context";

const generalInfo = { synopsis: "Una familia viaja", tone: "cálido", genre: "drama", visualStyle: "acuarela", characters: [{ name: "Ana", description: "niña" }], settings: [] };
const scene = (id: string, i: number, text: string): Node => ({
  id, type: "scene", position: { x: 0, y: 0 },
  data: { type: "scene", label: `Escena ${i}`, status: "completed", sceneIndex: i, totalScenes: 3, text, scriptNodeId: "script", generalInfo },
});
const nodes: Node[] = [
  { id: "script", type: "script", position: { x: 0, y: 0 }, data: { label: "Guión", status: "completed" } },
  { id: "rules", type: "static-text", position: { x: 0, y: 0 }, data: { content: "sin animales", status: "completed" } },
  { id: "ps", type: "params-scene", position: { x: 0, y: 0 }, data: { content: "luz de tarde", status: "completed" } },
  scene("s1", 1, "ACCIÓN: llegan"),
  scene("s2", 2, "ACCIÓN: comen"),
  scene("s3", 3, "ACCIÓN: duermen"),
  { id: "img", type: "image", position: { x: 0, y: 0 }, data: { status: "idle" } },
];
const chain = (s: string, t: string): Edge => ({ id: `${s}-${t}`, source: s, target: t, sourceHandle: HANDLE_IDS.OUTPUT_SCRIPT_CHAIN, targetHandle: HANDLE_IDS.INPUT_SCRIPT_CHAIN });
const edges: Edge[] = [
  chain("script", "s1"), chain("s1", "s2"), chain("s2", "s3"),
  { id: "r", source: "rules", target: "script", targetHandle: HANDLE_IDS.INPUT_RULES },
  // Gemelo superior del handle: debe contar igual.
  { id: "p", source: "ps", target: "s3", targetHandle: `${HANDLE_IDS.INPUT_SCENE_PARAMS}__top` },
  { id: "x", source: "s3", target: "img", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetHandle: HANDLE_IDS.INPUT_PROMPT },
];

describe("contexto de escena", () => {
  it("junta escenas anteriores, reglas del guion y Params Escena", () => {
    expect(collectSceneContext("s3", nodes, edges)).toEqual({
      sceneIndex: 3,
      totalScenes: 3,
      generalInfo,
      previousScenes: [{ sceneIndex: 1, text: "ACCIÓN: llegan" }, { sceneIndex: 2, text: "ACCIÓN: comen" }],
      sceneParamsContent: "luz de tarde",
      rulesText: "sin animales",
    });
  });

  it("arma el contexto con todas las secciones en orden", () => {
    const ctx = resolveScriptContext("img", nodes, edges)!;
    const order = ["[Información general del guion]", "[Escenas anteriores", "[Estilo / Visual / Técnica]\nluz de tarde", "[Reglas adicionales del usuario]", "[Reglas obligatorias", "[Tu tarea]\nVas a generar contenido para la Escena 3 de 3"];
    let last = -1;
    for (const part of order) {
      const at = ctx.indexOf(part);
      expect(at, part).toBeGreaterThan(last);
      last = at;
    }
  });

  it("una escena vinculada da el mismo contexto que la local", () => {
    const local = resolveScriptContext("img", nodes, edges);
    const linkedNodes: Node[] = [
      { id: "lnk", type: "linked", position: { x: 0, y: 0 }, data: { status: "completed", linkSnapshot: { kind: "scene", label: "Escena 3", scriptLabel: "Guión", text: "ACCIÓN: duermen", context: collectSceneContext("s3", nodes, edges) } } },
      { id: "img", type: "image", position: { x: 0, y: 0 }, data: { status: "idle" } },
    ];
    const linkedEdges: Edge[] = [{ id: "y", source: "lnk", target: "img", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetHandle: HANDLE_IDS.INPUT_PROMPT }];
    expect(resolveScriptContext("img", linkedNodes, linkedEdges)).toBe(local);
  });

  it("sin nada más que las reglas fijas no inyecta contexto", () => {
    expect(composeScriptContext({ sceneIndex: 1, totalScenes: 1, previousScenes: [], sceneParamsContent: null, rulesText: null })).toBeNull();
  });
});
