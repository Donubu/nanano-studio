// "Generar escenas" del Guión, incremental (como "Generar etapas" del
// Personaje). Puro: sin React, fetch ni BD; el workspace aplica el plan con
// la persistencia granular y los eventos de colaboración de siempre.
//
// - Escenas: una por escena del análisis, con id fijo `scene-<guion>-<N>`. Si
//   ya existe se actualiza su data (texto, info del guion, tipo destino) sin
//   moverla; si no, se crea.
// - Destino de cada escena (imagen / video / Practicante): se reusa si sigue
//   siendo del mismo tipo (con sus resultados). Si el tipo cambió o la escena
//   ya no existe, el destino viejo se elimina solo si está vacío y nadie más
//   lo usa; si no, se conserva y se avisa.
// - Conexiones: solo se reconcilian las que pone este plan (ids fijos por
//   escena); las del usuario no se tocan.
// - Nunca se borra un nodo con resultados.

import type { Edge, Node } from "@xyflow/react";
import {
  HANDLE_IDS,
  baseHandleId,
  type SceneTargetNodeType,
  type ScriptAnalysis,
  type ScriptNodeData,
} from "./canvas-types";
import { wouldCreateCycle } from "./connection-rules";

// Layout (relativo al Guión): Guión | Params Escena | Escenas | Destinos.
const PARAMS_SCENE_X_OFFSET = 460;
const SCENE_X_OFFSET = 860;
const TARGET_FROM_SCENE_X = 380;
const SCENE_Y_SPACING = 340;

export const sceneIdFor = (scriptId: string, idx: number) => `scene-${scriptId}-${idx}`;
const defaultTargetIdFor = (scriptId: string, idx: number) => `dst-${scriptId}-${idx}`;

/** Prefijos de las conexiones que pone "Generar escenas" para un Guión. */
export function managedEdgePrefixes(scriptId: string): string[] {
  return [
    `edge-chain-${scriptId}-`,
    `edge-target-${scriptId}-`,
    `edge-params-scene-${scriptId}-`,
    `edge-link-${scriptId}-`,
    `edge-visual-ref-${scriptId}`,
  ];
}

function isManagedEdge(id: string, scriptId: string): boolean {
  return managedEdgePrefixes(scriptId).some((p) => id.startsWith(p));
}

function defaultDataForTarget(type: SceneTargetNodeType, label: string): Record<string, unknown> {
  switch (type) {
    case "image":
      return { type: "image", label, status: "idle", prompt: "", aspectRatio: "16:9", resolution: "1K", numberOfImages: 1 };
    case "video":
      return { type: "video", label, status: "idle", prompt: "", duration: 8, aspectRatio: "16:9", resolution: "720p", audioEnabled: true };
    case "text-practicante":
      return { type: "text-practicante", label, status: "idle", prompt: "", dryRun: false, outputAsPrompt: true };
    default:
      return {};
  }
}

function targetLabel(type: SceneTargetNodeType, idx: number): string {
  return type === "image" ? `Imagen ${idx}` : type === "video" ? `Video ${idx}` : `Practicante ${idx}`;
}

function hasResults(n: Node): boolean {
  const d = n.data as Record<string, unknown>;
  return !!(d.outputUrl || d.outputText || (Array.isArray(d.outputHistory) && d.outputHistory.length > 0));
}

export interface ScriptMaterializePlan {
  addNodes: Node[];
  // Data nueva (completa) de nodos existentes: escenas cuyo texto cambió.
  updateNodes: { id: string; data: Record<string, unknown> }[];
  removeNodeIds: string[];
  addEdges: Edge[];
  // Conexiones del plan que existen pero cambiaron de extremos (upsert).
  updateEdges: Edge[];
  removeEdgeIds: string[];
  // Data nueva del Guión (destino de cada escena).
  scriptData: ScriptNodeData;
  warnings: string[];
  counts: { scenesAdded: number; scenesUpdated: number; scenesRemoved: number; targetsAdded: number };
}

interface DesiredEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export function planScriptMaterialize(
  script: Node,
  nodes: Node[],
  edges: Edge[],
  opts: {
    linkPreviousOutput?: boolean;
    // Galería / imagen conectada a la referencia visual del Guión.
    visualReferenceSourceId?: string | null;
    // Params Escena propio conectado al Guión (si no, se usa/crea el automático).
    paramsSceneSourceId?: string | null;
    idPrefix?: string;
  } = {},
): ScriptMaterializePlan {
  const sid = script.id;
  const data = script.data as unknown as ScriptNodeData;
  const analysis = data.scriptAnalysis as ScriptAnalysis | undefined;
  const scenes = (analysis?.scenes ?? []).map((s) => ({ ...s, targetNodeType: (s.targetNodeType ?? "image") as SceneTargetNodeType }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const prefix = opts.idPrefix ?? `s${Date.now().toString(36)}`;
  const warnings: string[] = [];
  const addNodes: Node[] = [];
  const updateNodes: { id: string; data: Record<string, unknown> }[] = [];
  const removeNodeIds = new Set<string>();
  const counts = { scenesAdded: 0, scenesUpdated: 0, scenesRemoved: 0, targetsAdded: 0 };
  const totalScenes = scenes.length;
  const sceneTargets: Record<string, string> = {};
  const prevTargets = (data.sceneTargetIds as Record<string, string> | undefined) ?? {};
  const targetIdOf = (idx: number) => prevTargets[String(idx)] ?? defaultTargetIdFor(sid, idx);

  // Conexiones que no puso este plan, para no borrar nodos que el usuario usa.
  const userEdges = edges.filter((e) => !isManagedEdge(e.id, sid));
  const userLinked = (nodeId: string) => userEdges.some((e) => e.source === nodeId || e.target === nodeId);

  // Elimina (si está vacío y sin conexiones del usuario) o conserva con aviso.
  const retire = (node: Node, reason: string) => {
    if (!hasResults(node) && !userLinked(node.id)) removeNodeIds.add(node.id);
    else warnings.push(`"${String((node.data as Record<string, unknown>).label || node.id)}" ${reason}; se conservó porque tiene resultados o conexiones.`);
  };

  // 1. Escenas y destinos.
  const scenePos = new Map<number, { x: number; y: number }>();
  const targetOf = new Map<number, string>();
  scenes.forEach((scene, i) => {
    const idx = scene.index;
    const id = sceneIdFor(sid, idx);
    const existing = byId.get(id);
    const desired = {
      type: "scene",
      label: `Escena ${idx}`,
      status: "completed",
      sceneIndex: idx,
      totalScenes,
      text: scene.text,
      scriptNodeId: sid,
      generalInfo: analysis?.generalInfo,
      targetNodeType: scene.targetNodeType,
    };
    if (existing && existing.type === "scene") {
      const cur = existing.data as Record<string, unknown>;
      const changed = (Object.keys(desired) as (keyof typeof desired)[]).some(
        (k) => JSON.stringify(cur[k]) !== JSON.stringify(desired[k]),
      );
      if (changed) {
        updateNodes.push({ id, data: { ...cur, ...desired } });
        counts.scenesUpdated++;
      }
      scenePos.set(idx, existing.position);
    } else {
      // Debajo de la escena anterior si existe; si no, en el layout base.
      const prev = i > 0 ? scenePos.get(scenes[i - 1].index) : undefined;
      const pos = prev
        ? { x: prev.x, y: prev.y + SCENE_Y_SPACING }
        : { x: script.position.x + SCENE_X_OFFSET, y: script.position.y + i * SCENE_Y_SPACING };
      addNodes.push({ id, type: "scene", position: pos, data: desired });
      scenePos.set(idx, pos);
      counts.scenesAdded++;
    }

    // Destino.
    const type = scene.targetNodeType;
    const currentTarget = byId.get(targetIdOf(idx));
    if (type === "none") {
      if (currentTarget) retire(currentTarget, "ya no es destino de su escena");
      return;
    }
    if (currentTarget && currentTarget.type === type) {
      targetOf.set(idx, currentTarget.id);
      sceneTargets[String(idx)] = currentTarget.id;
      return;
    }
    if (currentTarget) retire(currentTarget, `cambió de tipo en la escena ${idx}`);
    // Si el id fijo está ocupado (o se elimina en este mismo plan: borrar y
    // crear el mismo id a la vez es frágil), el nuevo destino lleva sufijo.
    const def = defaultTargetIdFor(sid, idx);
    const newId = byId.has(def) ? `${def}-${prefix}` : def;
    const sp = scenePos.get(idx)!;
    addNodes.push({
      id: newId,
      type,
      position: { x: sp.x + TARGET_FROM_SCENE_X, y: sp.y },
      data: defaultDataForTarget(type, targetLabel(type, idx)),
    });
    targetOf.set(idx, newId);
    sceneTargets[String(idx)] = newId;
    counts.targetsAdded++;
  });

  // 2. Escenas de este Guión que ya no están en el análisis (y sus destinos).
  const wanted = new Set(scenes.map((s) => sceneIdFor(sid, s.index)));
  for (const n of nodes) {
    if (n.type !== "scene" || wanted.has(n.id)) continue;
    const d = n.data as Record<string, unknown>;
    if (d.scriptNodeId !== sid && !n.id.startsWith(`scene-${sid}-`)) continue;
    removeNodeIds.add(n.id);
    counts.scenesRemoved++;
    const idx = Number(d.sceneIndex);
    const t = Number.isFinite(idx) ? byId.get(targetIdOf(idx)) : undefined;
    if (t && !Object.values(sceneTargets).includes(t.id)) retire(t, `quedó sin escena (la escena ${idx} ya no existe)`);
  }

  // 3. Params Escena: el propio del usuario o el automático (se crea si falta).
  const paramsSceneId = opts.paramsSceneSourceId || `params-scene-${sid}`;
  if (!opts.paramsSceneSourceId && !byId.has(paramsSceneId) && scenes.length > 0) {
    addNodes.push({
      id: paramsSceneId,
      type: "params-scene",
      position: { x: script.position.x + PARAMS_SCENE_X_OFFSET, y: script.position.y },
      data: { type: "params-scene", label: "Params Escena", status: "completed", content: "" },
    });
  }

  // 4. Conexiones deseadas (ids fijos por escena).
  const desired: DesiredEdge[] = [];
  scenes.forEach((scene, i) => {
    const idx = scene.index;
    const sceneId = sceneIdFor(sid, idx);
    desired.push({
      id: `edge-chain-${sid}-${idx}`,
      source: i === 0 ? sid : sceneIdFor(sid, scenes[i - 1].index),
      sourceHandle: HANDLE_IDS.OUTPUT_SCRIPT_CHAIN,
      target: sceneId,
      targetHandle: HANDLE_IDS.INPUT_SCRIPT_CHAIN,
    });
    desired.push({
      id: `edge-params-scene-${sid}-${idx}`,
      source: paramsSceneId,
      sourceHandle: HANDLE_IDS.OUTPUT_PARAMS,
      target: sceneId,
      targetHandle: HANDLE_IDS.INPUT_SCENE_PARAMS,
    });
    const t = targetOf.get(idx);
    if (t) {
      desired.push({ id: `edge-target-${sid}-${idx}`, source: sceneId, sourceHandle: HANDLE_IDS.OUTPUT_TEXT, target: t, targetHandle: HANDLE_IDS.INPUT_PROMPT });
    }
  });
  // Referencia visual del Guión → destino de la primera escena.
  const first = scenes[0];
  const firstTarget = first ? targetOf.get(first.index) : undefined;
  if (opts.visualReferenceSourceId && first && firstTarget) {
    const handle =
      first.targetNodeType === "image" ? HANDLE_IDS.INPUT_REFERENCE :
      first.targetNodeType === "video" ? HANDLE_IDS.INPUT_FIRST_FRAME :
      first.targetNodeType === "text-practicante" ? HANDLE_IDS.INPUT_MEDIA : null;
    if (handle) {
      desired.push({ id: `edge-visual-ref-${sid}`, source: opts.visualReferenceSourceId, sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, target: firstTarget, targetHandle: handle });
    }
  }
  // Continuidad entre destinos (opcional).
  if (opts.linkPreviousOutput) {
    for (let i = 1; i < scenes.length; i++) {
      const prev = scenes[i - 1];
      const curr = scenes[i];
      const a = targetOf.get(prev.index);
      const b = targetOf.get(curr.index);
      if (!a || !b) continue;
      let sourceHandle: string | null = null;
      let targetHandle: string | null = null;
      if (prev.targetNodeType === "image" && curr.targetNodeType === "image") {
        sourceHandle = HANDLE_IDS.OUTPUT_IMAGE;
        targetHandle = HANDLE_IDS.INPUT_REFERENCE;
      } else if (prev.targetNodeType === "image" && curr.targetNodeType === "video") {
        sourceHandle = HANDLE_IDS.OUTPUT_IMAGE;
        targetHandle = HANDLE_IDS.INPUT_FIRST_FRAME;
      } else if ((prev.targetNodeType === "image" || prev.targetNodeType === "video") && curr.targetNodeType === "text-practicante") {
        sourceHandle = prev.targetNodeType === "image" ? HANDLE_IDS.OUTPUT_IMAGE : HANDLE_IDS.OUTPUT_VIDEO;
        targetHandle = HANDLE_IDS.INPUT_MEDIA;
      }
      if (sourceHandle && targetHandle) {
        desired.push({ id: `edge-link-${sid}-${curr.index}`, source: a, sourceHandle, target: b, targetHandle });
      }
    }
  }

  // 5. Reconciliar conexiones del plan con lo existente.
  const desiredIds = new Set(desired.map((d) => d.id));
  const removeEdgeIds = new Set<string>();
  for (const e of edges) {
    if (isManagedEdge(e.id, sid) && !desiredIds.has(e.id)) removeEdgeIds.add(e.id);
    if (removeNodeIds.has(e.source) || removeNodeIds.has(e.target)) removeEdgeIds.add(e.id);
  }
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  const addEdges: Edge[] = [];
  const updateEdges: Edge[] = [];
  let working: Edge[] = edges.filter((e) => !removeEdgeIds.has(e.id));
  for (const d of desired) {
    const cur = edgeById.get(d.id);
    const same =
      cur && cur.source === d.source && cur.target === d.target &&
      baseHandleId(cur.targetHandle) === d.targetHandle && (cur.sourceHandle ?? null) === d.sourceHandle;
    if (same && !removeEdgeIds.has(d.id)) continue;
    // El usuario ya tiene esa misma conexión con otro id: no se duplica.
    if (!cur && working.some((e) => e.source === d.source && e.target === d.target && baseHandleId(e.targetHandle) === d.targetHandle)) continue;
    const others = working.filter((e) => e.id !== d.id);
    if (wouldCreateCycle(others, d.source, d.target)) {
      warnings.push(`Se omitió una conexión que formaba un ciclo (${d.source} → ${d.target}).`);
      continue;
    }
    const edge: Edge = { id: d.id, source: d.source, sourceHandle: d.sourceHandle, target: d.target, targetHandle: d.targetHandle, animated: false };
    if (cur && !removeEdgeIds.has(d.id)) updateEdges.push(edge);
    else {
      addEdges.push(edge);
      removeEdgeIds.delete(d.id);
    }
    working = [...others, edge];
  }

  return {
    addNodes,
    updateNodes,
    removeNodeIds: [...removeNodeIds],
    addEdges,
    updateEdges,
    removeEdgeIds: [...removeEdgeIds],
    scriptData: { ...data, sceneTargetIds: sceneTargets },
    warnings,
    counts,
  };
}
