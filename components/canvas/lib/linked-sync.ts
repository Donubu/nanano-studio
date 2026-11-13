// Sincroniza los nodos vinculados con su origen: pide al servidor la vista
// resuelta de cada uno y devuelve solo los cambios (por hash y estado).

import type { LinkedNodeData, LinkedSnapshot, LinkState } from "./canvas-types";

interface Resolution {
  conversationId: number;
  nodeId: string;
  state: LinkState;
  sourceCanvasTitle?: string;
  snapshot?: LinkedSnapshot;
  hash?: string;
}

type NodeLike = { id: string; type?: string; data: Record<string, unknown> };

export function isLinkedNode(n: NodeLike): boolean {
  const d = n.data as Partial<LinkedNodeData>;
  return n.type === "linked" && !!d.sourceConversationId && !!d.sourceNodeId;
}

/** Pide la vista de varios orígenes (sin duplicados). */
export async function fetchLinkResolutions(
  conversationId: number,
  refs: { conversationId: number; nodeId: string }[],
): Promise<Resolution[]> {
  const seen = new Set<string>();
  const unique = refs.filter((r) => {
    const k = `${r.conversationId}|${r.nodeId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length === 0) return [];
  // En tandas: el servidor resuelve hasta 200 por llamada (un montaje puede
  // tener muchos videos vinculados).
  const out: Resolution[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const res = await fetch(`/api/conversations/${conversationId}/canvas/links/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs: unique.slice(i, i + 100) }),
    });
    if (!res.ok) throw new Error(`No se pudo actualizar los vinculados (HTTP ${res.status})`);
    const data = await res.json();
    out.push(...((data.results ?? []) as Resolution[]));
  }
  return out;
}

/** Cambios de data que corresponden a un nodo vinculado según su resolución (null = nada cambió). */
export function linkPatch(data: Partial<LinkedNodeData>, r: Resolution | undefined): Partial<LinkedNodeData> | null {
  if (!r) return null;
  if (r.state === "ok" && r.snapshot) {
    if (data.linkState === "ok" && data.linkHash === r.hash && data.sourceCanvasTitle === r.sourceCanvasTitle) return null;
    return {
      linkSnapshot: r.snapshot,
      linkHash: r.hash,
      linkState: "ok",
      sourceCanvasTitle: r.sourceCanvasTitle,
      label: r.snapshot.label,
      linkSyncedAt: new Date().toISOString(),
    };
  }
  // Borrado o sin acceso: se conserva la última vista, solo cambia el estado.
  if (data.linkState === r.state) return null;
  return { linkState: r.state, ...(r.sourceCanvasTitle ? { sourceCanvasTitle: r.sourceCanvasTitle } : {}) };
}

/** Cambios por id de nodo para los vinculados de `nodes`. */
export async function computeLinkPatches(
  conversationId: number,
  nodes: NodeLike[],
): Promise<Map<string, Partial<LinkedNodeData>>> {
  const linked = nodes.filter(isLinkedNode);
  const patches = new Map<string, Partial<LinkedNodeData>>();
  if (!conversationId || linked.length === 0) return patches;
  const results = await fetchLinkResolutions(
    conversationId,
    linked.map((n) => {
      const d = n.data as unknown as LinkedNodeData;
      return { conversationId: d.sourceConversationId, nodeId: d.sourceNodeId };
    }),
  );
  const byKey = new Map(results.map((r) => [`${r.conversationId}|${r.nodeId}`, r]));
  for (const n of linked) {
    const d = n.data as unknown as LinkedNodeData;
    const patch = linkPatch(d, byKey.get(`${d.sourceConversationId}|${d.sourceNodeId}`));
    if (patch) patches.set(n.id, patch);
  }
  return patches;
}
