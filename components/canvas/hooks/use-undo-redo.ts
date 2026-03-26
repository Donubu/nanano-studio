"use client";

import { useCallback, useRef } from "react";
import type { Node, Edge } from "@xyflow/react";

interface Snapshot {
  nodes: Node[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

export function useUndoRedo(
  nodes: Node[],
  edges: Edge[],
  setNodes: (updater: Node[] | ((nds: Node[]) => Node[])) => void,
  setEdges: (updater: Edge[] | ((eds: Edge[]) => Edge[])) => void
) {
  const pastRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const skipNextRef = useRef(false);

  /**
   * Take a snapshot of the current state and push to history.
   * Call this BEFORE any state change (nodes/edges modification).
   */
  const takeSnapshot = useCallback(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return;
    }
    pastRef.current.push({
      nodes: nodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: edges.map((e) => ({ ...e })),
    });
    if (pastRef.current.length > MAX_HISTORY) {
      pastRef.current.shift();
    }
    // Any new action clears the future (no redo after new change)
    futureRef.current = [];
  }, [nodes, edges]);

  const undo = useCallback(() => {
    const prev = pastRef.current.pop();
    if (!prev) return;

    // Save current state to future
    futureRef.current.push({
      nodes: nodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: edges.map((e) => ({ ...e })),
    });

    // Restore previous state
    skipNextRef.current = true;
    setNodes(prev.nodes);
    setEdges(prev.edges);
  }, [nodes, edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;

    // Save current state to past
    pastRef.current.push({
      nodes: nodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: edges.map((e) => ({ ...e })),
    });

    // Restore next state
    skipNextRef.current = true;
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [nodes, edges, setNodes, setEdges]);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  return { takeSnapshot, undo, redo, canUndo, canRedo };
}
