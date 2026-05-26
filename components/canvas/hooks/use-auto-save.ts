"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";

export interface WipeProtectionInfo {
  currentAlive: number;
  incomingCount: number;
  wouldSoftDelete: number;
  snapshotId: string;
}

interface UseAutoSaveOptions {
  conversationId: number;
  nodes: Node[];
  edges: Edge[];
  enabled: boolean;
  debounceMs?: number;
  onWipeBlocked?: (info: WipeProtectionInfo, retryWithWipe: () => Promise<void>) => void;
}

export function useAutoSave({
  conversationId,
  nodes,
  edges,
  enabled,
  debounceMs = 1500,
  onWipeBlocked,
}: UseAutoSaveOptions) {
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const saveRef = useRef<((n: Node[], e: Edge[], allowWipe?: boolean) => Promise<void>) | null>(null);

  const save = useCallback(async (currentNodes: Node[], currentEdges: Edge[], allowWipe = false) => {
    if (!conversationId) return;
    const payload = { nodes: currentNodes, edges: currentEdges, ...(allowWipe ? { allowWipe: true } : {}) };
    const stateStr = JSON.stringify(payload);
    // Comparación insensible a allowWipe — si el contenido no cambió, no re-enviar.
    const contentKey = JSON.stringify({ nodes: currentNodes, edges: currentEdges });
    if (!allowWipe && contentKey === lastSavedRef.current) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: stateStr,
        signal: controller.signal,
      });

      if (res.status === 409) {
        const info = (await res.json().catch(() => ({}))) as Partial<WipeProtectionInfo> & { error?: string };
        if (info.error === "wipe_protection" && onWipeBlocked) {
          setSaveStatus("error");
          onWipeBlocked(
            {
              currentAlive: info.currentAlive ?? 0,
              incomingCount: info.incomingCount ?? 0,
              wouldSoftDelete: info.wouldSoftDelete ?? 0,
              snapshotId: info.snapshotId ?? "",
            },
            async () => {
              await saveRef.current?.(currentNodes, currentEdges, true);
            }
          );
          return;
        }
      }

      if (res.ok) {
        lastSavedRef.current = contentKey;
        setSaveStatus("saved");
      } else {
        setSaveStatus("error");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setSaveStatus("error");
      }
    }
  }, [conversationId, onWipeBlocked]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Debounced save on changes
  useEffect(() => {
    if (!enabled || !conversationId) return;
    if (nodes.length === 0 && edges.length === 0) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      save(nodes, edges);
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [nodes, edges, enabled, debounceMs, save]);

  // Invalida la marca del último save guardado — útil cuando el canvas
  // fue restaurado externamente (papelera o snapshot) y queremos que el
  // próximo save efectivamente persista el nuevo estado.
  const invalidateLastSaved = useCallback(() => {
    lastSavedRef.current = "";
  }, []);

  return { saveStatus, invalidateLastSaved };
}
