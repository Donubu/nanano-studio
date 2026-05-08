"use client";

import { memo, useCallback, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ImageIcon, Loader2, AlertCircle, ZoomIn } from "lucide-react";
import { HANDLE_IDS, type ImageNodeData } from "../lib/canvas-types";
import { StatusIndicator, NodeDeleteButton, AIBadge } from "./node-status";
import { HistoryNav } from "./history-nav";
import { useNodeUpdate } from "../hooks/use-node-update";
import { useUpstreamPromptLabel } from "../hooks/use-upstream-prompt-label";
import { ResizeHandle, nodeSizeClass } from "./resize-handle";
import { MediaViewerModal, type MediaViewerEntry } from "./media-viewer-modal";

const statusColors: Record<string, string> = {
  idle: "border-border",
  generating: "border-purple-500 shadow-purple-500/20 shadow-lg",
  completed: "border-green-500",
  error: "border-red-500",
};

export const ImageNodeComponent = memo(function ImageNode({ id, data, selected, width, height }: NodeProps) {
  const nodeData = data as unknown as ImageNodeData;
  const status = nodeData.status || "idle";
  const { updateNodeData } = useNodeUpdate();
  const upstreamLabel = useUpstreamPromptLabel();

  const history = nodeData.outputHistory || [];
  const totalOutputs = history.length;

  const activeIndex = totalOutputs > 0
    ? history.findIndex((h) => h.url === nodeData.outputUrl && h.messageId === nodeData.outputMessageId)
    : -1;
  const effectiveIndex = activeIndex >= 0 ? activeIndex : totalOutputs - 1;

  const navigateTo = useCallback((index: number) => {
    const entry = history[index];
    if (!entry) return;
    updateNodeData(id, {
      ...nodeData,
      outputUrl: entry.url,
      outputMessageId: entry.messageId,
    });
  }, [id, history, nodeData, updateNodeData]);

  const deleteFromHistory = useCallback((index: number) => {
    const updated = history.filter((_, i) => i !== index);
    if (updated.length === 0) {
      updateNodeData(id, { ...nodeData, outputHistory: [], outputUrl: undefined, outputMessageId: undefined, status: "idle" });
      return;
    }
    // Navigate to nearest valid entry
    const newIndex = Math.min(index, updated.length - 1);
    const entry = updated[newIndex];
    updateNodeData(id, {
      ...nodeData,
      outputHistory: updated,
      outputUrl: entry.url,
      outputMessageId: entry.messageId,
    });
  }, [id, history, nodeData, updateNodeData]);

  const displayUrl = nodeData.outputUrl;
  const isViewingLatest = effectiveIndex === totalOutputs - 1;
  const isResized = width != null || height != null;

  const [viewerOpen, setViewerOpen] = useState(false);
  const viewerEntries: MediaViewerEntry[] = history
    .filter((h) => !!h.url)
    .map((h) => ({
      url: h.url!,
      type: "image" as const,
      messageId: h.messageId,
      modelName: h.modelName,
      createdAt: h.createdAt,
    }));

  return (
    <div
      className={`group bg-card rounded-xl border-2 ${statusColors[status]} ${
        selected ? "ring-2 ring-primary/50" : ""
      } transition-all ${nodeSizeClass(width, height, "min-w-[260px] max-w-[300px]")}`}
    >
      {/* Input handles */}
      <Handle type="target" position={Position.Left} id={HANDLE_IDS.INPUT_PROMPT}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background" style={{ top: "22%" }} title="Prompt input" />
      <Handle type="target" position={Position.Left} id={HANDLE_IDS.INPUT_REFERENCE}
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background" style={{ top: "55%" }} title="Reference image" />
      <Handle type="target" position={Position.Left} id={HANDLE_IDS.INPUT_PARAMS}
        className="!w-3 !h-3 !border-2 !border-background" style={{ top: "85%", backgroundColor: "#fc0" }} title="Parámetros" />

      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <ImageIcon className="h-3.5 w-3.5 text-purple-400 shrink-0" />
        <AIBadge />
        <input value={nodeData.label || ""} onChange={(e) => updateNodeData(id, { ...nodeData, label: e.target.value })} placeholder="Imagen" className="text-xs font-medium flex-1 min-w-0 bg-transparent border-none outline-none truncate placeholder:text-muted-foreground/50" />
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          {nodeData.modelName && <span className="truncate max-w-[80px]">{nodeData.modelName}</span>}
          <span>{nodeData.aspectRatio}</span>
          <span>{nodeData.resolution}</span>
        </div>
        <StatusIndicator status={status} />
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Body */}
      <div className={`px-3 py-2 space-y-1.5 ${isResized ? "flex-1 min-h-0 flex flex-col" : ""}`}>
        <p className={`text-xs line-clamp-2 ${nodeData.prompt ? "text-muted-foreground" : upstreamLabel ? "text-violet-400/80 italic" : "text-muted-foreground"}`}>
          {nodeData.prompt || upstreamLabel || "Sin prompt configurado"}
        </p>

        {displayUrl ? (
          <div className={`mt-1 space-y-1 ${isResized ? "flex-1 min-h-0 flex flex-col" : ""}`}>
            <div className={`rounded-md overflow-hidden bg-muted/50 relative ${isResized ? "flex-1 min-h-0" : ""}`}>
              <img
                src={displayUrl}
                alt="Generated"
                className={
                  isResized
                    ? "w-full h-full object-contain rounded-md"
                    : "max-w-full max-h-[28vh] mx-auto object-contain rounded-md"
                }
              />
              {!isViewingLatest && effectiveIndex >= 0 && (
                <div className="absolute top-1 left-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded">
                  {history[effectiveIndex]?.modelName || "Anterior"}
                </div>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setViewerOpen(true);
                }}
                className="nodrag absolute top-1 right-1 p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                title="Ver en grande"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>
            <HistoryNav history={history} effectiveIndex={effectiveIndex} onNavigate={navigateTo} onDelete={deleteFromHistory} />
          </div>
        ) : status === "generating" ? (
          <div className="flex items-center gap-1.5 text-xs text-purple-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Generando...
          </div>
        ) : null}

        {status === "error" && nodeData.errorMessage && (
          <div className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertCircle className="h-3 w-3" />
            <span className="truncate">{nodeData.errorMessage}</span>
          </div>
        )}
      </div>

      {/* Output handle */}
      <Handle type="source" position={Position.Right} id={HANDLE_IDS.OUTPUT_IMAGE}
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background" title="Image output" />

      <ResizeHandle minWidth={220} minHeight={140} />

      {viewerOpen && displayUrl && (
        <MediaViewerModal
          entries={viewerEntries.length > 0 ? viewerEntries : undefined}
          entry={
            viewerEntries.length > 0
              ? undefined
              : {
                  url: displayUrl,
                  type: "image",
                  messageId: nodeData.outputMessageId,
                  modelName: nodeData.modelName,
                }
          }
          initialIndex={effectiveIndex >= 0 ? effectiveIndex : 0}
          metadata={{
            label: nodeData.label,
            prompt: nodeData.prompt,
            negativePrompt: nodeData.negativePrompt,
            aspectRatio: nodeData.aspectRatio,
            resolution: nodeData.resolution,
            seed: nodeData.seed,
          }}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
});
