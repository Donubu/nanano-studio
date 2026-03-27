"use client";

import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";
import { useCanvasContext } from "../canvas-context";

/**
 * Hook that updates node data locally AND broadcasts the change to collaborators.
 * Use this instead of raw useReactFlow().updateNodeData() in node components.
 */
export function useNodeUpdate() {
  const { updateNodeData: rfUpdate } = useReactFlow();
  const { emitNodeData } = useCanvasContext();

  const updateNodeData = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      rfUpdate(nodeId, data);
      console.log("[useNodeUpdate] emitting node:data", nodeId, Object.keys(data));
      emitNodeData(nodeId, data);
    },
    [rfUpdate, emitNodeData]
  );

  return { updateNodeData };
}
