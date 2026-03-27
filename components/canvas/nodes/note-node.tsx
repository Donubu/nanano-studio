"use client";

import { memo, useCallback } from "react";
import { type NodeProps } from "@xyflow/react";
import { StickyNote } from "lucide-react";
import type { NoteNodeData } from "../lib/canvas-types";
import { NodeDeleteButton } from "./node-status";
import { useNodeUpdate } from "../hooks/use-node-update";

export const NoteNodeComponent = memo(function NoteNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as NoteNodeData;
  const { updateNodeData } = useNodeUpdate();

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { ...nodeData, content: e.target.value });
  }, [id, nodeData, updateNodeData]);

  return (
    <div
      className={`group bg-amber-50 dark:bg-amber-950/30 rounded-xl border-2 border-amber-300/50 dark:border-amber-700/50 ${
        selected ? "ring-2 ring-amber-400/50" : ""
      } min-w-[180px] max-w-[280px] transition-all`}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-amber-300/30 dark:border-amber-700/30">
        <StickyNote className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <input value={nodeData.label || ""} onChange={(e) => updateNodeData(id, { ...nodeData, content: nodeData.content, label: e.target.value })} placeholder="Nota" className="text-xs font-medium flex-1 min-w-0 bg-transparent border-none outline-none truncate text-amber-700 dark:text-amber-400 placeholder:text-amber-400/50" />
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <textarea
          value={nodeData.content || ""}
          onChange={handleChange}
          placeholder="Escribe una nota..."
          className="w-full text-xs bg-transparent border-none outline-none resize-y min-h-[40px] max-h-[200px] text-amber-900 dark:text-amber-200 placeholder:text-amber-400/50"
          rows={2}
        />
      </div>

      {/* No handles - notes don't connect to anything */}
    </div>
  );
});
