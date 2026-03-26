"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";

interface UseAutoSaveOptions {
  conversationId: number;
  nodes: Node[];
  edges: Edge[];
  enabled: boolean;
  debounceMs?: number;
}

export function useAutoSave({
  conversationId,
  nodes,
  edges,
  enabled,
  debounceMs = 1500,
}: UseAutoSaveOptions) {
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const save = useCallback(async (currentNodes: Node[], currentEdges: Edge[]) => {
    // Build serializable state to compare
    if (!conversationId) return;
    const stateStr = JSON.stringify({ nodes: currentNodes, edges: currentEdges });
    if (stateStr === lastSavedRef.current) return;

    // Cancel any in-flight save
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
      if (res.ok) {
        lastSavedRef.current = stateStr;
        setSaveStatus("saved");
      } else {
        setSaveStatus("error");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setSaveStatus("error");
      }
    }
  }, [conversationId]);

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

  return { saveStatus };
}
