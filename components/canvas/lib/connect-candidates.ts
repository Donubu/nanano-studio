// "Conectar con…": al hacer clic en un conector, la lista de conectores de
// OTROS nodos del canvas con los que se puede conectar (para no tener que
// arrastrar la conexión a través de todo el canvas). Puro: recibe los
// conectores que cada nodo realmente muestra (medidos por React Flow) y
// valida con las mismas reglas que el arrastre.

import type { Connection, Node } from "@xyflow/react";
import { HANDLE_IDS, baseHandleId, type CanvasEdge } from "./canvas-types";
import { isValidConnection, wouldCreateCycle } from "./connection-rules";

export interface HandleRef {
  nodeId: string;
  handleId: string;
  handleType: "source" | "target";
}

export interface ConnectCandidate {
  nodeId: string;
  /** Conector del otro nodo (id base, sin el gemelo superior). */
  handleId: string;
  connection: Connection;
  /** Distancia entre los nodos (para ordenar: los más cercanos primero). */
  distance: number;
}

/** Ids de los conectores que muestra un nodo, por tipo. */
export type HandlesOf = (nodeId: string) => { source: string[]; target: string[] };

const NODE_TYPE_LABELS: Record<string, string> = {
  text: "Texto IA",
  "text-practicante": "Practicante",
  image: "Imagen",
  video: "Video",
  "static-text": "Texto",
  "static-image": "Imagen estática",
  "static-image-group": "Galería",
  "params-text": "Params Texto",
  "params-image": "Params Imagen",
  "params-video": "Params Video",
  "params-scene": "Params Escena",
  script: "Guión",
  scene: "Escena",
  character: "Personaje",
  linked: "Vinculado",
};

export function nodeTypeLabel(type: string | undefined): string {
  return (type && NODE_TYPE_LABELS[type]) || type || "Nodo";
}

const HANDLE_NAMES: Record<string, string> = {
  [HANDLE_IDS.OUTPUT_TEXT]: "Texto",
  [HANDLE_IDS.OUTPUT_IMAGE]: "Imagen",
  [HANDLE_IDS.OUTPUT_VIDEO]: "Video",
  [HANDLE_IDS.OUTPUT_PARAMS]: "Params",
  [HANDLE_IDS.OUTPUT_SCRIPT_CHAIN]: "Cadena",
  [HANDLE_IDS.OUTPUT_CHARACTER]: "Prompt",
  [HANDLE_IDS.OUTPUT_CHARACTER_IMAGE]: "Imagen de etapa",
  [HANDLE_IDS.OUTPUT_CHARACTER_DNA]: "ADN",
  [HANDLE_IDS.OUTPUT_CHARACTER_STYLE]: "Estilo",
  [HANDLE_IDS.INPUT_PROMPT]: "Prompt",
  [HANDLE_IDS.INPUT_REFERENCE]: "Referencia",
  [HANDLE_IDS.INPUT_FIRST_FRAME]: "Primer fotograma",
  [HANDLE_IDS.INPUT_LAST_FRAME]: "Último fotograma",
  [HANDLE_IDS.INPUT_MEDIA]: "Media",
  [HANDLE_IDS.INPUT_PARAMS]: "Params",
  [HANDLE_IDS.INPUT_SCRIPT_CHAIN]: "Cadena",
  [HANDLE_IDS.INPUT_SCENE_PARAMS]: "Params Escena",
  [HANDLE_IDS.INPUT_VISUAL_REFERENCE]: "Referencia visual",
  [HANDLE_IDS.INPUT_PARAMS_SCENE_REF]: "Params Escena",
  [HANDLE_IDS.INPUT_RULES]: "Reglas",
  [HANDLE_IDS.INPUT_CHARACTER_STYLE]: "Estilo global",
  [HANDLE_IDS.INPUT_CHARACTER_GALLERY]: "Galerías",
  [HANDLE_IDS.INPUT_TEXT_PARTS]: "Textos",
  [HANDLE_IDS.INPUT_GALLERY_IMAGES]: "Galería",
};

export function handleName(handleId: string | null | undefined): string {
  const base = baseHandleId(handleId);
  return (base && HANDLE_NAMES[base]) || base || "";
}

function center(n: Node): { x: number; y: number } {
  const w = n.measured?.width ?? n.width ?? 0;
  const h = n.measured?.height ?? n.height ?? 0;
  return { x: n.position.x + w / 2, y: n.position.y + h / 2 };
}

/**
 * Conectores de otros nodos que se pueden conectar con `origin`: válidos según
 * las reglas (tipos, entradas únicas), sin ciclos y sin repetir una conexión
 * que ya existe. Ordenados del nodo más cercano al más lejano.
 */
export function listConnectCandidates(
  origin: HandleRef,
  nodes: Node[],
  edges: CanvasEdge[],
  handlesOf: HandlesOf,
): ConnectCandidate[] {
  const originNode = nodes.find((n) => n.id === origin.nodeId);
  if (!originNode) return [];
  const originHandle = baseHandleId(origin.handleId)!;
  const from = center(originNode);
  const out: ConnectCandidate[] = [];

  for (const node of nodes) {
    if (node.id === origin.nodeId) continue;
    // El otro extremo: si hice clic en una salida, busco entradas, y al revés.
    const ids = origin.handleType === "source" ? handlesOf(node.id).target : handlesOf(node.id).source;
    const seen = new Set<string>();
    for (const raw of ids) {
      const handleId = baseHandleId(raw)!;
      if (seen.has(handleId)) continue; // entrada izquierda y su gemela superior
      seen.add(handleId);
      const connection: Connection = origin.handleType === "source"
        ? { source: origin.nodeId, sourceHandle: originHandle, target: node.id, targetHandle: handleId }
        : { source: node.id, sourceHandle: handleId, target: origin.nodeId, targetHandle: originHandle };
      if (!isValidConnection(connection, nodes, edges)) continue;
      if (wouldCreateCycle(edges, connection.source, connection.target)) continue;
      const exists = edges.some(
        (e) =>
          e.source === connection.source &&
          e.target === connection.target &&
          baseHandleId(e.sourceHandle) === connection.sourceHandle &&
          baseHandleId(e.targetHandle) === connection.targetHandle,
      );
      if (exists) continue;
      const c = center(node);
      out.push({ nodeId: node.id, handleId, connection, distance: Math.hypot(c.x - from.x, c.y - from.y) });
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}
