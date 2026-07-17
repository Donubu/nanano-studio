"use client";

import { memo, useCallback } from "react";
import { type NodeProps } from "@xyflow/react";
import { StickyNote } from "lucide-react";
import type { NoteNodeData } from "../lib/canvas-types";
import { NodeDeleteButton } from "./node-status";
import { NodeLabel } from "./node-label";
import { useNodeUpdate } from "../hooks/use-node-update";
import { useCanvasContext } from "../canvas-context";
import { ResizeHandle, nodeSizeClass } from "./resize-handle";

export const NoteNodeComponent = memo(function NoteNode({ id, data, selected, width, height }: NodeProps) {
  const nodeData = data as unknown as NoteNodeData;
  const { updateNodeData } = useNodeUpdate();
  const { canEdit } = useCanvasContext();

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { ...nodeData, content: e.target.value });
  }, [id, nodeData, updateNodeData]);

  return (
    <div
      className={`group bg-amber-50 dark:bg-amber-950/30 rounded-xl border-2 border-amber-300/50 dark:border-amber-700/50 ${
        selected ? "ring-2 ring-amber-400/50" : ""
      } transition-all ${nodeSizeClass(width, height, "min-w-[180px] max-w-[280px]")}`}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-amber-300/30 dark:border-amber-700/30">
        <StickyNote className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <NodeLabel value={nodeData.label || ""} placeholder="Nota" onChange={(label) => updateNodeData(id, { ...nodeData, content: nodeData.content, label })} className="text-amber-700 dark:text-amber-400" />
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <textarea
          value={nodeData.content || ""}
          onChange={handleChange}
          readOnly={!canEdit}
          placeholder="Escribe una nota..."
          className="w-full text-xs bg-transparent border-none outline-none resize-y min-h-[40px] max-h-[200px] text-amber-900 dark:text-amber-200 placeholder:text-amber-400/50"
          rows={2}
        />
      </div>

      {/* No handles - notes don't connect to anything */}
      <ResizeHandle minWidth={160} minHeight={80} />
    </div>
  );
});
