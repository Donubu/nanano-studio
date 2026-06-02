"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";

export type CanvasSaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Hook que centraliza la persistencia granular del canvas. Cada acción
 * del usuario (crear/mover/eliminar nodo, editar datos, conectar/desconectar)
 * dispara un fetch contra los endpoints granulares. El server emite por socket
 * a los demás clientes tras persistir.
 *
 * Dos rutas de UPSERT de nodo:
 *   - `saveNode`     → inmediato. Para acciones discretas (crear nodo,
 *                      drop-connect, lock-all) donde el nodo debe existir
 *                      server-side cuanto antes.
 *   - `saveNodeData` → con debounce (latest-wins por id). Para ediciones de
 *                      datos del nodo (label, content, imágenes de galería,
 *                      params) que vienen de inputs/textareas y dispararían un
 *                      POST por cada tecla.
 *
 * Expone además `saveStatus` + `lastSavedAt` para el indicador visual del
 * toolbar. Errores se loggean a consola.
 */
export function useCanvasPersist(conversationId: number | null) {
  // Batch de movimientos: agrupa los node-drag-stop simultáneos (multi-select)
  // en un solo PATCH dentro de una ventana corta. Evita N fetches paralelos.
  const moveBatchRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Batch de updates de datos por nodo: coalesce el tecleo en inputs/textareas
  // de los nodos en un solo POST por ventana. latest-wins por id.
  const saveBatchRef = useRef<Map<string, Node>>(new Map());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Estado de guardado para el indicador visual del toolbar.
  const [saveStatus, setSaveStatus] = useState<CanvasSaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const pendingRef = useRef(0);

  const beginSave = useCallback(() => {
    pendingRef.current += 1;
    setSaveStatus("saving");
  }, []);

  const endSave = useCallback((ok: boolean) => {
    pendingRef.current = Math.max(0, pendingRef.current - 1);
    if (pendingRef.current > 0) return; // siguen habiendo writes en vuelo
    if (ok) {
      setSaveStatus("saved");
      setLastSavedAt(Date.now());
    } else {
      setSaveStatus("error");
    }
  }, []);

  const flushMoveBatch = useCallback(async () => {
    if (!conversationId) return;
    if (moveBatchRef.current.size === 0) return;
    const updates = Array.from(moveBatchRef.current.entries()).map(([id, position]) => ({ id, position }));
    moveBatchRef.current.clear();
    beginSave();
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/nodes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
        keepalive: true,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      endSave(true);
    } catch (err) {
      console.error("[canvas-persist] move batch failed", err);
      endSave(false);
    }
  }, [conversationId, beginSave, endSave]);

  // Movimiento de un nodo (drag-stop). Se batchea con otros movimientos
  // simultáneos en una ventana de 80ms.
  const moveNode = useCallback((id: string, x: number, y: number) => {
    moveBatchRef.current.set(id, { x, y });
    if (moveTimerRef.current) clearTimeout(moveTimerRef.current);
    moveTimerRef.current = setTimeout(() => {
      flushMoveBatch();
    }, 80);
  }, [flushMoveBatch]);

  const flushSaveBatch = useCallback(async () => {
    if (!conversationId) return;
    if (saveBatchRef.current.size === 0) return;
    const nodesToSave = Array.from(saveBatchRef.current.values());
    saveBatchRef.current.clear();
    beginSave();
    try {
      await Promise.all(
        nodesToSave.map(async (node) => {
          const res = await fetch(`/api/conversations/${conversationId}/canvas/nodes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ node }),
            keepalive: true,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        })
      );
      endSave(true);
    } catch (err) {
      console.error("[canvas-persist] saveNodeData batch failed", err);
      endSave(false);
    }
  }, [conversationId, beginSave, endSave]);

  // UPSERT con debounce. Para ediciones de datos del nodo. El backend hace
  // INSERT ... ON DUPLICATE KEY UPDATE por (id, conversation_id).
  const saveNodeData = useCallback((node: Node) => {
    if (!conversationId) return;
    saveBatchRef.current.set(node.id, node);
    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      flushSaveBatch();
    }, 600);
  }, [conversationId, flushSaveBatch]);

  // UPSERT inmediato. Para `add node` y otras acciones discretas.
  const saveNode = useCallback(async (node: Node) => {
    if (!conversationId) return;
    beginSave();
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      endSave(true);
    } catch (err) {
      console.error("[canvas-persist] saveNode failed", err);
      endSave(false);
    }
  }, [conversationId, beginSave, endSave]);

  // Persiste el tamaño tras un resize manual (PATCH de width/height). Se llama
  // sólo al soltar el resize (resizing === false), no en las mediciones
  // automáticas del montaje. Sin esto, el resize vivía sólo en el state local
  // y se perdía al refrescar.
  const resizeNode = useCallback(async (id: string, width: number, height: number) => {
    if (!conversationId) return;
    beginSave();
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/nodes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: id, updates: { width: Math.round(width), height: Math.round(height) } }),
        keepalive: true,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      endSave(true);
    } catch (err) {
      console.error("[canvas-persist] resizeNode failed", err);
      endSave(false);
    }
  }, [conversationId, beginSave, endSave]);

  const deleteNodes = useCallback(async (nodeIds: string[]) => {
    if (!conversationId || nodeIds.length === 0) return;
    // Cancela cualquier save de datos pendiente de estos nodos: si no, el
    // flush debounced reviviría (deleted_at = NULL) un nodo recién borrado.
    for (const id of nodeIds) saveBatchRef.current.delete(id);
    beginSave();
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/nodes`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeIds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      endSave(true);
    } catch (err) {
      console.error("[canvas-persist] deleteNodes failed", err);
      endSave(false);
    }
  }, [conversationId, beginSave, endSave]);

  const createEdge = useCallback(async (edge: Edge) => {
    if (!conversationId) return;
    beginSave();
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/edges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edge }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      endSave(true);
    } catch (err) {
      console.error("[canvas-persist] createEdge failed", err);
      endSave(false);
    }
  }, [conversationId, beginSave, endSave]);

  const deleteEdges = useCallback(async (edgeIds: string[]) => {
    if (!conversationId || edgeIds.length === 0) return;
    beginSave();
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/edges`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edgeIds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      endSave(true);
    } catch (err) {
      console.error("[canvas-persist] deleteEdges failed", err);
      endSave(false);
    }
  }, [conversationId, beginSave, endSave]);

  // Flush de pendientes al ocultar/cerrar la pestaña. `keepalive` en los POST/
  // PATCH asegura que el último write sobreviva la navegación.
  useEffect(() => {
    const flushAll = () => {
      flushMoveBatch();
      flushSaveBatch();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushAll();
    };
    window.addEventListener("pagehide", flushAll);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushAll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushMoveBatch, flushSaveBatch]);

  return { saveNode, saveNodeData, moveNode, resizeNode, deleteNodes, createEdge, deleteEdges, flushMoveBatch, saveStatus, lastSavedAt };
}
