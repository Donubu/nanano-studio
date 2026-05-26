"use client";

import { useCallback, useRef } from "react";
import type { Node, Edge } from "@xyflow/react";

/**
 * Hook que centraliza la persistencia granular del canvas. Cada acción
 * del usuario (crear/mover/eliminar nodo, conectar/desconectar) dispara
 * un fetch contra los endpoints granulares. El server emite por socket
 * a los demás clientes tras persistir (en fases posteriores).
 *
 * Errores se loggean a consola. Política de retry futura: encolar ops
 * fallidas y reintentar al recuperar conectividad.
 */
export function useCanvasPersist(conversationId: number | null) {
  // Batch de movimientos: agrupa los node-drag-stop simultáneos (multi-select)
  // en un solo PATCH dentro de una ventana corta. Evita N fetches paralelos.
  const moveBatchRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushMoveBatch = useCallback(async () => {
    if (!conversationId) return;
    if (moveBatchRef.current.size === 0) return;
    const updates = Array.from(moveBatchRef.current.entries()).map(([id, position]) => ({ id, position }));
    moveBatchRef.current.clear();
    try {
      await fetch(`/api/conversations/${conversationId}/canvas/nodes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
    } catch (err) {
      console.error("[canvas-persist] move batch failed", err);
    }
  }, [conversationId]);

  // Movimiento de un nodo (drag-stop). Se batchea con otros movimientos
  // simultáneos en una ventana de 80ms.
  const moveNode = useCallback((id: string, x: number, y: number) => {
    moveBatchRef.current.set(id, { x, y });
    if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
    moveTimerRef.current = setTimeout(() => {
      flushMoveBatch();
    }, 80);
  }, [flushMoveBatch]);

  // Crea o actualiza un nodo (UPSERT). El backend hace
  // INSERT ... ON DUPLICATE KEY UPDATE por (id, conversation_id).
  // Sirve tanto para `add node` como para `update node data`.
  const saveNode = useCallback(async (node: Node) => {
    if (!conversationId) return;
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error("[canvas-persist] saveNode failed", err);
    }
  }, [conversationId]);

  const deleteNodes = useCallback(async (nodeIds: string[]) => {
    if (!conversationId || nodeIds.length === 0) return;
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/nodes`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeIds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error("[canvas-persist] deleteNodes failed", err);
    }
  }, [conversationId]);

  const createEdge = useCallback(async (edge: Edge) => {
    if (!conversationId) return;
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/edges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edge }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error("[canvas-persist] createEdge failed", err);
    }
  }, [conversationId]);

  const deleteEdges = useCallback(async (edgeIds: string[]) => {
    if (!conversationId || edgeIds.length === 0) return;
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/edges`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edgeIds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error("[canvas-persist] deleteEdges failed", err);
    }
  }, [conversationId]);

  return { saveNode, moveNode, deleteNodes, createEdge, deleteEdges, flushMoveBatch };
}
