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

// Versión B de una escena: ids y clave propios ("3b"), mismo número.
export const sceneBIdFor = (scriptId: string, idx: number) => `scene-${scriptId}-${idx}-b`;
const defaultTargetBIdFor = (scriptId: string, idx: number) => `dst-${scriptId}-${idx}-b`;

/**
 * Una escena del análisis produce una unidad (A) o dos (A y B). Cada unidad
 * es un nodo Escena con su destino; `key` identifica el destino en
 * `sceneTargetIds` ("3" o "3b") y el sufijo de sus conexiones.
 */
interface SceneUnit {
  key: string;
  idx: number;
  variant?: "A" | "B";
  sceneId: string;
  defaultTargetId: string;
  text: string;
  targetNodeType: SceneTargetNodeType;
}

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

function targetLabel(type: SceneTargetNodeType, idx: number, variant?: "A" | "B"): string {
  const n = `${idx}${variant ?? ""}`;
  return type === "image" ? `Imagen ${n}` : type === "video" ? `Video ${n}` : `Practicante ${n}`;
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

  // Conexiones que no puso este plan, para no borrar nodos que el usuario usa.
  const userEdges = edges.filter((e) => !isManagedEdge(e.id, sid));
  const userLinked = (nodeId: string) => userEdges.some((e) => e.source === nodeId || e.target === nodeId);

  // Elimina (si está vacío y sin conexiones del usuario) o conserva con aviso.
  const retire = (node: Node, reason: string) => {
    if (!hasResults(node) && !userLinked(node.id)) removeNodeIds.add(node.id);
    else warnings.push(`"${String((node.data as Record<string, unknown>).label || node.id)}" ${reason}; se conservó porque tiene resultados o conexiones.`);
  };

  // 1. Escenas y destinos (una unidad por escena, dos si tiene versión B).
  const units: SceneUnit[] = scenes.flatMap((scene) => {
    const idx = scene.index;
    const hasB = !!scene.variantB;
    const a: SceneUnit = {
      key: String(idx),
      idx,
      variant: hasB ? "A" : undefined,
      sceneId: sceneIdFor(sid, idx),
      defaultTargetId: defaultTargetIdFor(sid, idx),
      text: scene.text,
      targetNodeType: scene.targetNodeType,
    };
    if (!hasB) return [a];
    const b: SceneUnit = {
      key: `${idx}b`,
      idx,
      variant: "B",
      sceneId: sceneBIdFor(sid, idx),
      defaultTargetId: defaultTargetBIdFor(sid, idx),
      text: scene.variantB!.text ?? "",
      targetNodeType: (scene.variantB!.targetNodeType ?? scene.targetNodeType) as SceneTargetNodeType,
    };
    return [a, b];
  });
  const scenePos = new Map<string, { x: number; y: number }>();
  const targetOf = new Map<string, string>();
  const unitTargetId = (u: { key: string; defaultTargetId: string }) => prevTargets[u.key] ?? u.defaultTargetId;
  units.forEach((unit) => {
    const { idx, key } = unit;
    const id = unit.sceneId;
    const existing = byId.get(id);
    const name = `${idx}${unit.variant ?? ""}`;
    const desired: Record<string, unknown> = {
      type: "scene",
      label: `Escena ${name}`,
      status: "completed",
      sceneIndex: idx,
      totalScenes,
      text: unit.text,
      scriptNodeId: sid,
      generalInfo: analysis?.generalInfo,
      targetNodeType: unit.targetNodeType,
      variant: unit.variant,
    };
    if (existing && existing.type === "scene") {
      const cur = existing.data as Record<string, unknown>;
      const changed = Object.keys(desired).some((k) => JSON.stringify(cur[k]) !== JSON.stringify(desired[k]));
      if (changed) {
        const next: Record<string, unknown> = { ...cur, ...desired };
        if (unit.variant === undefined) delete next.variant;
        updateNodes.push({ id, data: next });
        counts.scenesUpdated++;
      }
      scenePos.set(key, existing.position);
    } else {
      if (unit.variant === undefined) delete desired.variant;
      // La B, a la derecha del destino de su A; la A (o sin versiones),
      // debajo de la escena anterior si existe; si no, en el layout base.
      let pos: { x: number; y: number };
      const posA = scenePos.get(String(idx));
      if (unit.variant === "B" && posA) {
        pos = { x: posA.x + TARGET_FROM_SCENE_X * 2, y: posA.y };
      } else {
        const i = scenes.findIndex((sc) => sc.index === idx);
        const prev = i > 0 ? scenePos.get(String(scenes[i - 1].index)) : undefined;
        pos = prev
          ? { x: prev.x, y: prev.y + SCENE_Y_SPACING }
          : { x: script.position.x + SCENE_X_OFFSET, y: script.position.y + Math.max(0, i) * SCENE_Y_SPACING };
      }
      addNodes.push({ id, type: "scene", position: pos, data: desired });
      scenePos.set(key, pos);
      counts.scenesAdded++;
    }

    // Destino.
    const type = unit.targetNodeType;
    const currentTarget = byId.get(unitTargetId(unit));
    if (type === "none") {
      if (currentTarget) retire(currentTarget, "ya no es destino de su escena");
      return;
    }
    if (currentTarget && currentTarget.type === type) {
      targetOf.set(key, currentTarget.id);
      sceneTargets[key] = currentTarget.id;
      return;
    }
    if (currentTarget) retire(currentTarget, `cambió de tipo en la escena ${name}`);
    // Si el id fijo está ocupado (o se elimina en este mismo plan: borrar y
    // crear el mismo id a la vez es frágil), el nuevo destino lleva sufijo.
    const def = unit.defaultTargetId;
    const newId = byId.has(def) ? `${def}-${prefix}` : def;
    const sp = scenePos.get(key)!;
    addNodes.push({
      id: newId,
      type,
      position: { x: sp.x + TARGET_FROM_SCENE_X, y: sp.y },
      data: defaultDataForTarget(type, targetLabel(type, idx, unit.variant)),
    });
    targetOf.set(key, newId);
    sceneTargets[key] = newId;
    counts.targetsAdded++;
  });

  // 2. Escenas de este Guión que ya no están en el análisis (y sus destinos).
  const wanted = new Set(units.map((u) => u.sceneId));
  for (const n of nodes) {
    if (n.type !== "scene" || wanted.has(n.id)) continue;
    const d = n.data as Record<string, unknown>;
    if (d.scriptNodeId !== sid && !n.id.startsWith(`scene-${sid}-`)) continue;
    removeNodeIds.add(n.id);
    counts.scenesRemoved++;
    const idx = Number(d.sceneIndex);
    if (!Number.isFinite(idx)) continue;
    const isB = d.variant === "B" || n.id === sceneBIdFor(sid, idx);
    const key = isB ? `${idx}b` : String(idx);
    const t = byId.get(unitTargetId({ key, defaultTargetId: isB ? defaultTargetBIdFor(sid, idx) : defaultTargetIdFor(sid, idx) }));
    if (t && !Object.values(sceneTargets).includes(t.id)) {
      retire(t, isB ? `quedó sin escena (se quitó la versión B de la escena ${idx})` : `quedó sin escena (la escena ${idx} ya no existe)`);
    }
  }

  // 3. Params Escena, en este orden: el conectado al Guión; el que YA alimenta
  // las escenas de este Guión (uno propio del usuario aunque no esté conectado
  // al Guión, o el de una corrida anterior); el automático (se crea si falta).
  // Antes se usaba siempre el automático: si el usuario tenía el suyo, se
  // creaba uno vacío y las escenas quedaban apuntando a él.
  const scriptSceneIds = new Set(
    nodes
      .filter((n) => n.type === "scene" && ((n.data as Record<string, unknown>).scriptNodeId === sid || n.id.startsWith(`scene-${sid}-`)))
      .map((n) => n.id),
  );
  const isSceneParamsEdge = (e: Edge) => scriptSceneIds.has(e.target) && baseHandleId(e.targetHandle) === HANDLE_IDS.INPUT_SCENE_PARAMS;
  const feedingCount = new Map<string, number>();
  for (const e of edges) {
    if (!isSceneParamsEdge(e) || byId.get(e.source)?.type !== "params-scene") continue;
    feedingCount.set(e.source, (feedingCount.get(e.source) ?? 0) + 1);
  }
  const feeding = [...feedingCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const paramsSceneId = opts.paramsSceneSourceId || feeding || `params-scene-${sid}`;
  // Escenas a las que el usuario les puso su propio Params Escena (otro nodo,
  // conexión que no es del plan): se respeta, no se agrega un segundo.
  const ownSceneParams = new Set(
    edges.filter((e) => isSceneParamsEdge(e) && !isManagedEdge(e.id, sid) && e.source !== paramsSceneId).map((e) => e.target),
  );
  if (!opts.paramsSceneSourceId && !byId.has(paramsSceneId) && scenes.length > 0) {
    addNodes.push({
      id: paramsSceneId,
      type: "params-scene",
      position: { x: script.position.x + PARAMS_SCENE_X_OFFSET, y: script.position.y },
      data: { type: "params-scene", label: "Params Escena", status: "completed", content: "" },
    });
  }

  // 4. Conexiones deseadas (ids fijos por unidad). La cadena sigue por las A:
  // la B recibe el contexto de las escenas anteriores pero no lo pasa.
  const desired: DesiredEdge[] = [];
  units.forEach((unit) => {
    const i = scenes.findIndex((sc) => sc.index === unit.idx);
    desired.push({
      id: `edge-chain-${sid}-${unit.key}`,
      source: i === 0 ? sid : sceneIdFor(sid, scenes[i - 1].index),
      sourceHandle: HANDLE_IDS.OUTPUT_SCRIPT_CHAIN,
      target: unit.sceneId,
      targetHandle: HANDLE_IDS.INPUT_SCRIPT_CHAIN,
    });
    if (!ownSceneParams.has(unit.sceneId)) {
      desired.push({
        id: `edge-params-scene-${sid}-${unit.key}`,
        source: paramsSceneId,
        sourceHandle: HANDLE_IDS.OUTPUT_PARAMS,
        target: unit.sceneId,
        targetHandle: HANDLE_IDS.INPUT_SCENE_PARAMS,
      });
    }
    const t = targetOf.get(unit.key);
    if (t) {
      desired.push({ id: `edge-target-${sid}-${unit.key}`, source: unit.sceneId, sourceHandle: HANDLE_IDS.OUTPUT_TEXT, target: t, targetHandle: HANDLE_IDS.INPUT_PROMPT });
    }
  });
  // Referencia visual del Guión → destino de la primera escena.
  const first = scenes[0];
  const firstTarget = first ? targetOf.get(String(first.index)) : undefined;
  if (opts.visualReferenceSourceId && first && firstTarget) {
    const handle =
      first.targetNodeType === "image" ? HANDLE_IDS.INPUT_REFERENCE :
      first.targetNodeType === "video" ? HANDLE_IDS.INPUT_FIRST_FRAME :
      first.targetNodeType === "text-practicante" ? HANDLE_IDS.INPUT_MEDIA : null;
    if (handle) {
      desired.push({ id: `edge-visual-ref-${sid}`, source: opts.visualReferenceSourceId, sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, target: firstTarget, targetHandle: handle });
    }
  }
  // Continuidad entre destinos (opcional): del destino de la escena anterior
  // (su A) al de esta, y también al de su versión B.
  if (opts.linkPreviousOutput) {
    for (let i = 1; i < scenes.length; i++) {
      const prev = scenes[i - 1];
      const a = targetOf.get(String(prev.index));
      if (!a) continue;
      for (const unit of units.filter((u) => u.idx === scenes[i].index)) {
        const b = targetOf.get(unit.key);
        if (!b) continue;
        let sourceHandle: string | null = null;
        let targetHandle: string | null = null;
        if (prev.targetNodeType === "image" && unit.targetNodeType === "image") {
          sourceHandle = HANDLE_IDS.OUTPUT_IMAGE;
          targetHandle = HANDLE_IDS.INPUT_REFERENCE;
        } else if (prev.targetNodeType === "image" && unit.targetNodeType === "video") {
          sourceHandle = HANDLE_IDS.OUTPUT_IMAGE;
          targetHandle = HANDLE_IDS.INPUT_FIRST_FRAME;
        } else if ((prev.targetNodeType === "image" || prev.targetNodeType === "video") && unit.targetNodeType === "text-practicante") {
          sourceHandle = prev.targetNodeType === "image" ? HANDLE_IDS.OUTPUT_IMAGE : HANDLE_IDS.OUTPUT_VIDEO;
          targetHandle = HANDLE_IDS.INPUT_MEDIA;
        }
        if (sourceHandle && targetHandle) {
          desired.push({ id: `edge-link-${sid}-${unit.key}`, source: a, sourceHandle, target: b, targetHandle });
        }
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
