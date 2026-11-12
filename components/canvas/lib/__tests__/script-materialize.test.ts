import { describe, it, expect } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { HANDLE_IDS } from "../canvas-types";
import { planScriptMaterialize, type ScriptMaterializePlan } from "../script-materialize";

const generalInfo = { synopsis: "s", tone: "t", genre: "g", visualStyle: "v", characters: [], settings: [] };
type SceneSpec = { index: number; text: string; targetNodeType: "image" | "video" | "text-practicante" | "none" };
const script = (scenes: SceneSpec[], extra: Record<string, unknown> = {}): Node => ({
  id: "g", type: "script", position: { x: 0, y: 0 },
  data: { type: "script", label: "Guión", status: "completed", prompt: "", scriptAnalysis: { generalInfo, scenes }, ...extra },
});
const three: SceneSpec[] = [
  { index: 1, text: "uno", targetNodeType: "image" },
  { index: 2, text: "dos", targetNodeType: "image" },
  { index: 3, text: "tres", targetNodeType: "video" },
];

function apply(nodes: Node[], edges: Edge[], plan: ScriptMaterializePlan) {
  const rmN = new Set(plan.removeNodeIds);
  const rmE = new Set(plan.removeEdgeIds);
  const upN = new Map(plan.updateNodes.map((u) => [u.id, u.data]));
  const upE = new Map(plan.updateEdges.map((e) => [e.id, e]));
  return {
    nodes: [
      ...nodes.filter((n) => !rmN.has(n.id)).map((n) => (n.id === "g" ? { ...n, data: plan.scriptData as unknown as Record<string, unknown> } : upN.has(n.id) ? { ...n, data: upN.get(n.id)! } : n)),
      ...plan.addNodes,
    ],
    edges: [...edges.filter((e) => !rmE.has(e.id)).map((e) => upE.get(e.id) ?? e), ...plan.addEdges],
  };
}
const withOutput = (nodes: Node[], id: string) => nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, outputUrl: "https://x/out.png" } } : n));

describe("planScriptMaterialize", () => {
  it("la primera vez crea escenas encadenadas, destinos, Params Escena y sus conexiones", () => {
    const s = script(three);
    const plan = planScriptMaterialize(s, [s], [], { idPrefix: "a" });
    expect(plan.addNodes.map((n) => n.id).sort()).toEqual(["dst-g-1", "dst-g-2", "dst-g-3", "params-scene-g", "scene-g-1", "scene-g-2", "scene-g-3"]);
    expect(plan.addEdges.find((e) => e.id === "edge-chain-g-1")).toMatchObject({ source: "g", target: "scene-g-1" });
    expect(plan.addEdges.find((e) => e.id === "edge-chain-g-2")).toMatchObject({ source: "scene-g-1", target: "scene-g-2" });
    expect(plan.addEdges.find((e) => e.id === "edge-target-g-3")).toMatchObject({ source: "scene-g-3", target: "dst-g-3", targetHandle: HANDLE_IDS.INPUT_PROMPT });
    expect(plan.removeNodeIds).toEqual([]);
  });

  it("regenerar sin cambios no toca nada y conserva conexiones y resultados del usuario", () => {
    const s = script(three);
    let st = apply([s], [], planScriptMaterialize(s, [s], [], { idPrefix: "a" }));
    st = { nodes: withOutput(st.nodes, "dst-g-1"), edges: [...st.edges, { id: "user", source: "dst-g-1", target: "otro", targetHandle: HANDLE_IDS.INPUT_REFERENCE }] };
    st.nodes.push({ id: "otro", type: "image", position: { x: 0, y: 0 }, data: {} });
    const again = planScriptMaterialize(st.nodes.find((n) => n.id === "g")!, st.nodes, st.edges, { idPrefix: "b" });
    expect(again.addNodes).toEqual([]);
    expect(again.updateNodes).toEqual([]);
    expect(again.removeNodeIds).toEqual([]);
    expect(again.addEdges).toEqual([]);
    expect(again.removeEdgeIds).toEqual([]);
  });

  it("cambiar el texto actualiza la escena en su lugar", () => {
    const s = script(three);
    const st = apply([s], [], planScriptMaterialize(s, [s], [], { idPrefix: "a" }));
    const moved = st.nodes.map((n) => (n.id === "scene-g-2" ? { ...n, position: { x: 999, y: 999 } } : n));
    const edited = script(three.map((sc) => (sc.index === 2 ? { ...sc, text: "dos nuevo" } : sc)));
    const plan = planScriptMaterialize(edited, moved.map((n) => (n.id === "g" ? edited : n)), st.edges, { idPrefix: "b" });
    expect(plan.addNodes).toEqual([]);
    expect(plan.updateNodes).toHaveLength(1);
    expect(plan.updateNodes[0]).toMatchObject({ id: "scene-g-2", data: { text: "dos nuevo" } });
    expect(plan.removeNodeIds).toEqual([]);
  });

  it("cambiar el tipo de destino: el vacío se reemplaza, el que tiene resultado se conserva con aviso", () => {
    const s = script(three);
    let st = apply([s], [], planScriptMaterialize(s, [s], [], { idPrefix: "a" }));
    st = { ...st, nodes: withOutput(st.nodes, "dst-g-2") };
    const edited = script(three.map((sc) => (sc.index <= 2 ? { ...sc, targetNodeType: "video" as const } : sc)));
    const plan = planScriptMaterialize(edited, st.nodes.map((n) => (n.id === "g" ? edited : n)), st.edges, { idPrefix: "b" });
    expect(plan.removeNodeIds).toEqual(["dst-g-1"]);
    expect(plan.addNodes.map((n) => [n.id, n.type])).toEqual([["dst-g-1-b", "video"], ["dst-g-2-b", "video"]]);
    expect(plan.warnings.join(" ")).toContain("Imagen 2");
    // La conexión escena → destino se re-apunta al nuevo (misma id, upsert).
    expect(plan.updateEdges.find((e) => e.target === "dst-g-2-b")).toMatchObject({ id: "edge-target-g-2", source: "scene-g-2" });
    expect(plan.addEdges.find((e) => e.target === "dst-g-1-b")).toMatchObject({ id: "edge-target-g-1", source: "scene-g-1" });
    expect(plan.updateEdges.concat(plan.addEdges).some((e) => e.target === "dst-g-2")).toBe(false);
    expect(plan.scriptData.sceneTargetIds).toMatchObject({ "1": "dst-g-1-b", "2": "dst-g-2-b", "3": "dst-g-3" });
  });

  it("escenas que desaparecen se eliminan; su destino vacío también", () => {
    const s = script(three);
    const st = apply([s], [], planScriptMaterialize(s, [s], [], { idPrefix: "a" }));
    const edited = script(three.slice(0, 2));
    const plan = planScriptMaterialize(edited, st.nodes.map((n) => (n.id === "g" ? edited : n)), st.edges, { idPrefix: "b" });
    expect(plan.removeNodeIds.sort()).toEqual(["dst-g-3", "scene-g-3"]);
    expect(plan.removeEdgeIds).toEqual(expect.arrayContaining(["edge-chain-g-3", "edge-target-g-3", "edge-params-scene-g-3"]));
    // Las demás escenas se actualizan por el total de escenas.
    expect(plan.updateNodes.map((u) => u.id).sort()).toEqual(["scene-g-1", "scene-g-2"]);
  });
});
