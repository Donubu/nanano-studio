"use client";

import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Loader2, AlertCircle, Bot, Paperclip, FlaskConical } from "lucide-react";
import { HANDLE_IDS, topHandleId, type TextPracticanteNodeData } from "../lib/canvas-types";
import { StatusIndicator, NodeDeleteButton } from "./node-status";
import { HistoryNav } from "./history-nav";
import { useNodeUpdate } from "../hooks/use-node-update";
import { useUpstreamPromptLabel } from "../hooks/use-upstream-prompt-label";
import { useCanvasContext } from "../canvas-context";
import { ResizeHandle, nodeSizeClass } from "./resize-handle";

const statusColors: Record<string, string> = {
  idle: "border-border",
  generating: "border-amber-500 shadow-amber-500/20 shadow-lg",
  completed: "border-green-500",
  error: "border-red-500",
};

export const TextPracticanteNodeComponent = memo(function TextPracticanteNode({ id, data, selected, width, height }: NodeProps) {
  const nodeData = data as unknown as TextPracticanteNodeData;
  const status = nodeData.status || "idle";
  const { updateNodeData, updateNodeDataLocal } = useNodeUpdate();
  const upstreamLabel = useUpstreamPromptLabel();
  const { canEdit } = useCanvasContext();

  const history = nodeData.outputHistory || [];
  const totalOutputs = history.length;

  const activeIndex = totalOutputs > 0
    ? history.findIndex((h) => h.text === nodeData.outputText && h.messageId === nodeData.outputMessageId)
    : -1;
  const effectiveIndex = activeIndex >= 0 ? activeIndex : totalOutputs - 1;

  const navigateTo = useCallback((index: number) => {
    const entry = history[index];
    if (!entry) return;
    // Paginar es "ver": en solo-ver se cambia el resultado mostrado localmente.
    const apply = canEdit ? updateNodeData : updateNodeDataLocal;
    apply(id, {
      ...nodeData,
      outputText: entry.text,
      outputMessageId: entry.messageId,
    });
  }, [id, history, nodeData, updateNodeData, updateNodeDataLocal, canEdit]);

  const deleteFromHistory = useCallback((index: number) => {
    const updated = history.filter((_, i) => i !== index);
    if (updated.length === 0) {
      updateNodeData(id, { ...nodeData, outputHistory: [], outputText: undefined, outputMessageId: undefined, status: "idle" });
      return;
    }
    const newIndex = Math.min(index, updated.length - 1);
    const entry = updated[newIndex];
    updateNodeData(id, {
      ...nodeData,
      outputHistory: updated,
      outputText: entry.text,
      outputMessageId: entry.messageId,
    });
  }, [id, history, nodeData, updateNodeData]);

  const displayText = nodeData.outputText;
  const isViewingLatest = effectiveIndex === totalOutputs - 1;
  const files = nodeData.files || [];
  const agentLabel = nodeData.agentName || "Orquestador";

  return (
    <div
      className={`group bg-card rounded-xl border-2 ${statusColors[status]} ${
        selected ? "ring-2 ring-primary/50" : ""
      } transition-all ${nodeSizeClass(width, height, "min-w-[260px] max-w-[300px]")}`}
    >
      {/* Input handles */}
      <Handle type="target" position={Position.Left} id={HANDLE_IDS.INPUT_PROMPT}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background" style={{ top: "30%" }} title="Prompt (texto)" />
      <Handle type="target" position={Position.Left} id={HANDLE_IDS.INPUT_MEDIA}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background" style={{ top: "70%" }} title="Media (imagen/video) como files[]" />

      {/* Input handles (top twins — same logical inputs, reachable from above) */}
      <Handle type="target" position={Position.Top} id={topHandleId(HANDLE_IDS.INPUT_PROMPT)}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background" style={{ left: "30%" }} title="Prompt (texto)" />
      <Handle type="target" position={Position.Top} id={topHandleId(HANDLE_IDS.INPUT_MEDIA)}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background" style={{ left: "70%" }} title="Media (imagen/video) como files[]" />

      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <Bot className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 shrink-0">practicante</span>
        <input
          value={nodeData.label || ""}
          onChange={(e) => updateNodeData(id, { ...nodeData, label: e.target.value })}
          placeholder="Practicante"
          className="text-xs font-medium flex-1 min-w-0 bg-transparent border-none outline-none truncate placeholder:text-muted-foreground/50"
        />
        <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${
          nodeData.outputAsPrompt !== false
            ? "bg-purple-500/15 text-purple-400"
            : "bg-blue-500/15 text-blue-400"
        }`}>
          {nodeData.outputAsPrompt !== false ? "prompt" : "libre"}
        </span>
        {nodeData.dryRun && (
          <FlaskConical className="h-3 w-3 text-purple-400 shrink-0" aria-label="Dry-run" />
        )}
        <StatusIndicator status={status} />
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground truncate">
            Agente: <span className="text-foreground">{agentLabel}</span>
          </span>
          {nodeData.delegatedTo && nodeData.delegatedTo !== agentLabel && (
            <span className="text-[9px] text-muted-foreground truncate">→ {nodeData.delegatedTo}</span>
          )}
        </div>

        <p className={`text-xs line-clamp-2 ${nodeData.prompt ? "text-muted-foreground" : upstreamLabel ? "text-violet-400/80 italic" : "text-muted-foreground"}`}>
          {nodeData.prompt || upstreamLabel || "Sin prompt configurado"}
        </p>

        {displayText ? (
          <div className="mt-1 space-y-1">
            <div className="bg-muted/50 rounded-md p-2 relative">
              <p className="text-xs line-clamp-3 whitespace-pre-wrap">{displayText}</p>
              {!isViewingLatest && effectiveIndex >= 0 && (
                <span className="absolute top-1 right-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded">
                  {history[effectiveIndex]?.modelName || "Anterior"}
                </span>
              )}
            </div>
            <HistoryNav history={history} effectiveIndex={effectiveIndex} onNavigate={navigateTo} onDelete={deleteFromHistory} />
          </div>
        ) : status === "generating" ? (
          <div className="flex items-center gap-1.5 text-xs text-amber-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Ejecutando...
          </div>
        ) : null}

        {files.length > 0 && (
          <div className="mt-1 space-y-0.5">
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Paperclip className="h-2.5 w-2.5" />
              Archivos ({files.length})
            </div>
            <ul className="space-y-0.5">
              {files.map((f, i) => (
                <li key={i} className="text-[10px] truncate">
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                    title={f.name}
                  >
                    {f.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {nodeData.toolsUsed && nodeData.toolsUsed.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {nodeData.toolsUsed.map((t, i) => (
              <span key={i} className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-300 truncate max-w-[120px]">
                {t}
              </span>
            ))}
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
      <Handle type="source" position={Position.Right} id={HANDLE_IDS.OUTPUT_TEXT}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background" title="Text output" />

      <ResizeHandle minWidth={220} minHeight={140} />
    </div>
  );
});
