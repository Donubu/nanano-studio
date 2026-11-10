// Helpers puros del asistente del canvas del lado del cliente: el snapshot
// compacto que se manda a la IA, dónde ubicar los nodos nuevos y el
// registro para deshacer lo que aplicó la IA.

import type { Node, Edge } from "@xyflow/react";
import { autoLayoutPositions } from "./auto-layout";
import { REFERENCE_SOURCE_TYPES, galleryImagesOf } from "./character";
import type { AssistSnapshotEdge, AssistSnapshotNode, PlanNode } from "@/lib/canvas-ai/assist-plan";

const MAX_TEXT = 600;
const DEFAULT_W = 300;
const DEFAULT_H = 220;
const BLOCK_GAP = 160;

function textOf(data: Record<string, unknown>): string | undefined {
  const t = (data.prompt ?? data.content ?? data.text ?? data.caption) as unknown;
  if (typeof t !== "string" || !t.trim()) return undefined;
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t;
}

export function buildAssistSnapshot(nodes: Node[], edges: Edge[]): {
  nodes: AssistSnapshotNode[];
  edges: AssistSnapshotEdge[];
} {
  return {
    nodes: nodes.map((n) => {
      const d = (n.data ?? {}) as Record<string, unknown>;
      return {
        id: n.id,
        type: n.type ?? "",
        label: typeof d.label === "string" ? d.label : undefined,
        text: textOf(d),
        modelId: typeof d.modelId === "number" ? d.modelId : undefined,
        aspectRatio: typeof d.aspectRatio === "string" ? d.aspectRatio : undefined,
        resolution: typeof d.resolution === "string" ? d.resolution : undefined,
        duration: typeof d.duration === "number" ? d.duration : undefined,
        hasOutput: Boolean(d.outputUrl || d.outputText || (Array.isArray(d.images) && d.images.length > 0) || d.imageUrl),
        locked: d.locked === true,
        ...(n.type === "character" && Array.isArray(d.stages) ? { stages: d.stages as AssistSnapshotNode["stages"] } : {}),
        ...(n.type === "character" && typeof d.dna === "string" && d.dna ? { dna: d.dna } : {}),
        ...(n.type === "image" && typeof d.outputUrl === "string" && d.outputUrl ? { outputUrl: d.outputUrl } : {}),
        ...(REFERENCE_SOURCE_TYPES.has(n.type ?? "")
          ? { images: galleryImagesOf({ type: n.type, data: d }).map((i) => i.url).slice(0, 24) }
          : {}),
      };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
  };
}

function sizeOf(n: Node): { w: number; h: number } {
  return {
    w: (typeof n.width === "number" ? n.width : undefined) ?? n.measured?.width ?? DEFAULT_W,
    h: (typeof n.height === "number" ? n.height : undefined) ?? n.measured?.height ?? DEFAULT_H,
  };
}

/**
 * Posiciones para los nodos nuevos: se ordenan entre sí con el layout de
 * timeline del canvas y el bloque queda a la derecha de lo que ya existe,
 * alineado arriba con el nodo existente más alto al que se conecta (o con
 * el borde superior del canvas). Con el canvas vacío, parte en `fallback`.
 */
export function placeNewNodes(
  existing: Node[],
  newNodes: PlanNode[],
  edgesAfter: { source: string; target: string }[],
  fallback: { x: number; y: number },
): Map<string, { x: number; y: number }> {
  const newIds = new Set(newNodes.map((n) => n.id));
  const blockNodes: Node[] = newNodes.map((n) => ({ id: n.id, type: n.type, position: { x: 0, y: 0 }, data: n.data }));
  const blockEdges = edgesAfter
    .filter((e) => newIds.has(e.source) && newIds.has(e.target))
    .map((e, i) => ({ id: `tmp-${i}`, source: e.source, target: e.target }));
  const local = autoLayoutPositions(blockNodes, blockEdges as Edge[]);
  if (local.size === 0) return local;

  let minX = Infinity;
  let minY = Infinity;
  for (const p of local.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }

  let anchor = fallback;
  if (existing.length > 0) {
    let right = -Infinity;
    let top = Infinity;
    for (const n of existing) {
      right = Math.max(right, n.position.x + sizeOf(n).w);
      top = Math.min(top, n.position.y);
    }
    const linked = existing.filter((n) =>
      edgesAfter.some((e) => (e.source === n.id && newIds.has(e.target)) || (e.target === n.id && newIds.has(e.source))),
    );
    const linkedTop = linked.length ? Math.min(...linked.map((n) => n.position.y)) : top;
    anchor = { x: right + BLOCK_GAP, y: linkedTop };
  }

  const out = new Map<string, { x: number; y: number }>();
  for (const [id, p] of local) {
    out.set(id, { x: Math.round(anchor.x + p.x - minX), y: Math.round(anchor.y + p.y - minY) });
  }
  return out;
}

/**
 * Re-ordena el bloque de nodos nuevos con sus tamaños ya medidos (los de
 * texto se ensanchan con el contenido y el primer layout usó un tamaño
 * estándar), manteniendo la esquina superior izquierda del bloque. Devuelve
 * solo las posiciones que cambian.
 */
export function relayoutMeasuredBlock(
  blockNodes: Node[],
  edges: { source: string; target: string }[],
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (blockNodes.length < 2) return out;
  const ids = new Set(blockNodes.map((n) => n.id));
  const blockEdges = edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e, i) => ({ id: `tmp-${i}`, source: e.source, target: e.target }));
  const local = autoLayoutPositions(blockNodes, blockEdges as Edge[]);
  let minX = Infinity;
  let minY = Infinity;
  for (const p of local.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  const originX = Math.min(...blockNodes.map((n) => n.position.x));
  const originY = Math.min(...blockNodes.map((n) => n.position.y));
  for (const n of blockNodes) {
    const p = local.get(n.id);
    if (!p) continue;
    const next = { x: Math.round(originX + p.x - minX), y: Math.round(originY + p.y - minY) };
    if (Math.abs(next.x - n.position.x) > 1 || Math.abs(next.y - n.position.y) > 1) out.set(n.id, next);
  }
  return out;
}

// Lo necesario para revertir exactamente lo que aplicó la IA.
export interface AssistUndoRecord {
  addedNodeIds: string[];
  addedEdgeIds: string[];
  // Versión previa de los nodos editados o borrados (se re-guardan tal cual).
  previousNodes: Node[];
  // Conexiones que la IA borró, o que cayeron al borrar un nodo.
  removedEdges: Edge[];
  // Posiciones previas de los nodos que se movieron al reordenar.
  previousPositions: Record<string, { x: number; y: number }>;
}
