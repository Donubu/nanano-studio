"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { Loader2, AlertCircle, Brain, Sparkles, FileText } from "lucide-react";
import { HANDLE_IDS, type TextNodeData } from "../lib/canvas-types";
import { StatusIndicator, NodeDeleteButton, AIBadge } from "./node-status";

const statusColors: Record<string, string> = {
  idle: "border-border",
  generating: "border-blue-500 shadow-blue-500/20 shadow-lg",
  completed: "border-green-500",
  error: "border-red-500",
};

export const TextNodeComponent = memo(function TextNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as TextNodeData;
  const status = nodeData.status || "idle";
  const { updateNodeData } = useReactFlow();

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
        style={{ top: "25%" }}
        title="Prompt (texto)"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_MEDIA}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background"
        style={{ top: "55%" }}
        title="Media (imagen/video)"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_PARAMS}
        className="!w-3 !h-3 !border-2 !border-background"
        style={{ top: "85%", backgroundColor: "#fc0" }}
        title="Parámetros"
      />

      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        {nodeData.outputAsPrompt !== false ? (
          <Sparkles className="h-3.5 w-3.5 text-purple-400 shrink-0" />
        ) : (
          <FileText className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        )}
        <AIBadge />
        <input value={nodeData.label || ""} onChange={(e) => updateNodeData(id, { ...nodeData, label: e.target.value })} placeholder="Texto" className="text-xs font-medium flex-1 min-w-0 bg-transparent border-none outline-none truncate placeholder:text-muted-foreground/50" />
        {nodeData.modelName && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{nodeData.modelName}</span>
        )}
        <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${
          nodeData.outputAsPrompt !== false
            ? "bg-purple-500/15 text-purple-400"
            : "bg-blue-500/15 text-blue-400"
        }`}>
          {nodeData.outputAsPrompt !== false ? "prompt" : "libre"}
        </span>
        {nodeData.thinkingLevel && nodeData.thinkingLevel !== "none" && (
          <Brain className="h-3 w-3 text-purple-400 shrink-0" />
        )}
        <StatusIndicator status={status} />
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1.5">
        <p className="text-xs text-muted-foreground line-clamp-2">
          {nodeData.prompt || "Sin prompt configurado"}
        </p>

        {status === "completed" && nodeData.outputText && (
          <div className="bg-muted/50 rounded-md p-2 mt-1">
            <p className="text-xs line-clamp-3">{nodeData.outputText}</p>
          </div>
        )}

        {status === "generating" && (
          <div className="flex items-center gap-1.5 text-xs text-blue-400">
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
        id={HANDLE_IDS.OUTPUT_TEXT}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background"
        title="Text output"
      />
    </div>
  );
});
