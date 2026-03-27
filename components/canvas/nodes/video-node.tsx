"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Video, Loader2, AlertCircle, Play } from "lucide-react";
import { HANDLE_IDS, type VideoNodeData } from "../lib/canvas-types";
import { StatusIndicator, NodeDeleteButton, AIBadge } from "./node-status";
import { useNodeUpdate } from "../hooks/use-node-update";

const statusColors: Record<string, string> = {
  idle: "border-border",
  generating: "border-amber-500 shadow-amber-500/20 shadow-lg",
  completed: "border-green-500",
  error: "border-red-500",
};

export const VideoNodeComponent = memo(function VideoNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as VideoNodeData;
  const status = nodeData.status || "idle";
  const { updateNodeData } = useNodeUpdate();

  return (
    <div
      className={`group bg-card rounded-xl border-2 ${statusColors[status]} ${
        selected ? "ring-2 ring-primary/50" : ""
      } min-w-[260px] max-w-[300px] transition-all`}
    >
      {/* Input handles */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_PROMPT}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background"
        style={{ top: "14%" }}
        title="Prompt (texto)"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_FIRST_FRAME}
        className="!w-3 !h-3 !bg-green-500 !border-2 !border-background"
        style={{ top: "30%" }}
        title="First frame (imagen)"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_LAST_FRAME}
        className="!w-3 !h-3 !bg-orange-500 !border-2 !border-background"
        style={{ top: "50%" }}
        title="Last frame (imagen)"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_REFERENCE}
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background"
        style={{ top: "68%" }}
        title="Referencia (imagen)"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_PARAMS}
        className="!w-3 !h-3 !border-2 !border-background"
        style={{ top: "86%", backgroundColor: "#fc0" }}
        title="Parámetros"
      />

      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <Video className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <AIBadge />
        <input value={nodeData.label || ""} onChange={(e) => updateNodeData(id, { ...nodeData, label: e.target.value })} placeholder="Video" className="text-xs font-medium flex-1 min-w-0 bg-transparent border-none outline-none truncate placeholder:text-muted-foreground/50" />
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          {nodeData.modelName && <span className="truncate max-w-[80px]">{nodeData.modelName}</span>}
          <span>{nodeData.duration}s</span>
          <span>{nodeData.aspectRatio}</span>
          <span>{nodeData.resolution}</span>
        </div>
        <StatusIndicator status={status} />
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Handle labels */}
      <div className="px-3 pt-1.5 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/70">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />Prompt
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 ml-2" />First
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0 ml-2" />Last
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0 ml-2" />Ref
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1.5">
        <p className="text-xs text-muted-foreground line-clamp-2">
          {nodeData.prompt || "Sin prompt configurado"}
        </p>

        {status === "completed" && nodeData.outputUrl && (
          <div className="mt-1 rounded-md overflow-hidden bg-muted/50 relative">
            <video
              src={nodeData.outputUrl}
              className="w-full h-auto max-h-[160px] object-cover"
              muted
              playsInline
              preload="metadata"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <Play className="h-8 w-8 text-white/80" />
            </div>
          </div>
        )}

        {status === "generating" && (
          <div className="flex items-center gap-1.5 text-xs text-amber-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Generando...
          </div>
        )}

        {status === "error" && nodeData.errorMessage && (
          <div className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertCircle className="h-3 w-3" />
            <span className="truncate">{nodeData.errorMessage}</span>
          </div>
        )}
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_VIDEO}
        className="!w-3 !h-3 !bg-amber-500 !border-2 !border-background"
        title="Video output"
      />
    </div>
  );
});
