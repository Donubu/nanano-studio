"use client";

import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Type } from "lucide-react";
import { HANDLE_IDS, type StaticTextNodeData } from "../lib/canvas-types";
import { NodeDeleteButton } from "./node-status";
import { useNodeUpdate } from "../hooks/use-node-update";
import { ResizeHandle, nodeSizeClass } from "./resize-handle";

export const StaticTextNodeComponent = memo(function StaticTextNode({ id, data, selected, width, height }: NodeProps) {
  const nodeData = data as unknown as StaticTextNodeData;
  const { updateNodeData } = useNodeUpdate();

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData(id, { ...nodeData, content: e.target.value });
  }, [id, nodeData, updateNodeData]);

  return (
    <div
      className={`group bg-card rounded-xl border-2 border-blue-400/30 ${
        selected ? "ring-2 ring-blue-400/50" : ""
      } transition-all ${nodeSizeClass(width, height, "min-w-[200px] max-w-[300px]")}`}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <Type className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        <input value={nodeData.label || ""} onChange={(e) => updateNodeData(id, { ...nodeData, label: e.target.value })} placeholder="Texto" className="text-xs font-medium flex-1 min-w-0 bg-transparent border-none outline-none truncate placeholder:text-muted-foreground/50" />
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Body - editable textarea */}
      <div className="px-3 py-2">
        <textarea
          value={nodeData.content || ""}
          onChange={handleChange}
          placeholder="Escribe texto que se usará como input..."
          className="w-full text-xs bg-transparent border-none outline-none resize-y min-h-[50px] max-h-[200px] placeholder:text-muted-foreground/50"
          rows={3}
        />
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_TEXT}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background"
        title="Text output"
      />

      <ResizeHandle minWidth={180} minHeight={100} />
    </div>
  );
});
