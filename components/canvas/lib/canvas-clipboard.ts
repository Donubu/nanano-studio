import type { Node, Edge } from "@xyflow/react";

// Clipboard de nodos del canvas. Vive en localStorage (no en el clipboard del
// sistema) para poder pegar en el mismo canvas, en otro canvas o en otra
// pestaña del mismo origen, sin pedir permisos de portapapeles.
const CLIPBOARD_KEY = "canvas-clipboard-v1";

export interface ClipboardNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  data: Record<string, unknown>;
}

export interface ClipboardEdge {
  id: string;
  source: string;
  sourceHandle: string | null;
  target: string;
  targetHandle: string | null;
}

export interface CanvasClipboardPayload {
  nodes: ClipboardNode[];
  edges: ClipboardEdge[];
  copiedAt: string;
}

// Campos que referencian la conversación origen y no sobreviven un paste
// (mismo criterio que la sanitización de templates en lib/canvas-templates.ts).
const DATA_FIELDS_TO_STRIP = [
  "outputHistory",
  "conversationId",
  "tokensUsed",
  "estimatedCost",
  "dryRunResponse",
  "files",
  "toolsUsed",
  "delegatedTo",
] as const;

function sanitizeDataForCopy(data: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...data };
  for (const field of DATA_FIELDS_TO_STRIP) {
    delete copy[field];
  }
  copy.outputMessageId = null;
  copy.errorMessage = null;
  if (copy.status === "generating" || copy.status === "error") {
    copy.status = "idle";
  }
  return copy;
}

/** Serializa los nodos a copiar + los edges internos entre ellos. */
export function buildClipboardPayload(nodesToCopy: Node[], allEdges: Edge[]): CanvasClipboardPayload {
  const ids = new Set(nodesToCopy.map((n) => n.id));
  return {
    nodes: nodesToCopy.map((n) => ({
      id: n.id,
      type: n.type || "text",
      position: { x: n.position.x, y: n.position.y },
      ...(n.width && n.height ? { width: n.width, height: n.height } : {}),
      data: sanitizeDataForCopy(n.data as Record<string, unknown>),
    })),
    edges: allEdges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle ?? null,
        target: e.target,
        targetHandle: e.targetHandle ?? null,
      })),
    copiedAt: new Date().toISOString(),
  };
}

export function writeCanvasClipboard(payload: CanvasClipboardPayload): void {
  try {
    localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(payload));
  } catch {
    // localStorage lleno o bloqueado: el copy simplemente no persiste.
  }
}

export function readCanvasClipboard(): CanvasClipboardPayload | null {
  try {
    const raw = localStorage.getItem(CLIPBOARD_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as CanvasClipboardPayload;
    if (!Array.isArray(payload?.nodes) || payload.nodes.length === 0) return null;
    if (!Array.isArray(payload?.edges)) payload.edges = [];
    return payload;
  } catch {
    return null;
  }
}

/**
 * Remapea el payload a IDs frescos para pegar sin colisiones (mismo esquema
 * que la inserción de templates: sufijo no numérico que el contador node-N
 * del cliente ignora). `anchor` (coords de flow) ancla la esquina
 * superior-izquierda del bounding box; el layout relativo se preserva.
 */
export function remapClipboardForPaste(
  payload: CanvasClipboardPayload,
  anchor: { x: number; y: number } | null
): { nodes: Node[]; edges: Edge[] } {
  const stamp = Date.now().toString(36);
  const idMap = new Map<string, string>();
  payload.nodes.forEach((node, i) => {
    idMap.set(node.id, `node-clip${stamp}-${i + 1}`);
  });

  let dx = 0;
  let dy = 0;
  if (anchor && payload.nodes.length > 0) {
    const minX = Math.min(...payload.nodes.map((n) => n.position.x));
    const minY = Math.min(...payload.nodes.map((n) => n.position.y));
    dx = anchor.x - minX;
    dy = anchor.y - minY;
  }

  const nodes: Node[] = payload.nodes.map((node) => {
    const data = { ...node.data };
    // Referencia interna escena → guión. Si el guión no viene en el copy,
    // se conserva el ID original (sigue siendo válido dentro del mismo canvas).
    if (typeof data.scriptNodeId === "string" && idMap.has(data.scriptNodeId)) {
      data.scriptNodeId = idMap.get(data.scriptNodeId)!;
    }
    return {
      ...node,
      id: idMap.get(node.id)!,
      position: { x: node.position.x + dx, y: node.position.y + dy },
      data,
      // Los nodos pegados quedan seleccionados para moverlos de inmediato.
      selected: true,
    };
  });

  const edges: Edge[] = payload.edges.map((edge, i) => ({
    ...edge,
    id: `e-clip${stamp}-${i + 1}`,
    source: idMap.get(edge.source)!,
    target: idMap.get(edge.target)!,
  }));

  return { nodes, edges };
}
