"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Type } from "lucide-react";
import { HANDLE_IDS, type StaticTextNodeData } from "../lib/canvas-types";
import { NodeDeleteButton } from "./node-status";
import { NodeLabel } from "./node-label";
import { useNodeUpdate } from "../hooks/use-node-update";
import { useCanvasContext } from "../canvas-context";
import { ResizeHandle, nodeSizeClass } from "./resize-handle";

export const StaticTextNodeComponent = memo(function StaticTextNode({ id, data, selected, width, height }: NodeProps) {
  const nodeData = data as unknown as StaticTextNodeData;
  const { updateNodeData } = useNodeUpdate();
  const { canEdit } = useCanvasContext();

  // Local state mirrors the textarea so typing stays in sync with the DOM.
  // Without this, the controlled value can lag a keystroke while the update
  // round-trips through React Flow / collab, and React resets the caret to the
  // end — making it impossible to insert text in the middle.
  // (El label ya no necesita espejo local: NodeLabel maneja su propio draft.)
  const [localContent, setLocalContent] = useState(nodeData.content || "");

  // Sync from external updates (remote collab, undo/redo). The equality guard
  // prevents clobbering local edits before our own update has round-tripped.
  useEffect(() => {
    const incoming = nodeData.content || "";
    setLocalContent((prev) => (prev === incoming ? prev : incoming));
  }, [nodeData.content]);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!canEdit) return;
    const value = e.target.value;
    setLocalContent(value);
    updateNodeData(id, { content: value });
  }, [id, updateNodeData, canEdit]);

  return (
    <div
      className={`group bg-card rounded-xl border-2 border-blue-400/30 ${
        selected ? "ring-2 ring-blue-400/50" : ""
      } transition-all ${nodeSizeClass(width, height, "min-w-[200px] max-w-[300px]")}`}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <Type className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        <NodeLabel value={nodeData.label || ""} placeholder="Texto" onChange={(label) => updateNodeData(id, { label })} />
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Body - editable textarea */}
      <div className="px-3 py-2">
        <textarea
          value={localContent}
          onChange={handleContentChange}
          readOnly={!canEdit}
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
