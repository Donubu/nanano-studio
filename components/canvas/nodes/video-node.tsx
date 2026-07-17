"use client";

import { memo, useCallback, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Video, Loader2, AlertCircle, Play, ZoomIn } from "lucide-react";
import { HANDLE_IDS, topHandleId, type VideoNodeData } from "../lib/canvas-types";
import { StatusIndicator, NodeDeleteButton, AIBadge } from "./node-status";
import { NodeLabel } from "./node-label";
import { HistoryNav } from "./history-nav";
import { useNodeUpdate } from "../hooks/use-node-update";
import { useUpstreamPromptLabel } from "../hooks/use-upstream-prompt-label";
import { useCanvasContext } from "../canvas-context";
import { ResizeHandle, nodeSizeClass } from "./resize-handle";
import { MediaViewerModal, type MediaViewerEntry } from "./media-viewer-modal";

const statusColors: Record<string, string> = {
  idle: "border-border",
  generating: "border-amber-500 shadow-amber-500/20 shadow-lg",
  completed: "border-green-500",
  error: "border-red-500",
};

export const VideoNodeComponent = memo(function VideoNode({ id, data, selected, width, height }: NodeProps) {
  const nodeData = data as unknown as VideoNodeData;
  const status = nodeData.status || "idle";
  const { updateNodeData, updateNodeDataLocal } = useNodeUpdate();
  const upstreamLabel = useUpstreamPromptLabel();
  const { projectId, canEdit } = useCanvasContext();

  const history = nodeData.outputHistory || [];
  const totalOutputs = history.length;

  const activeIndex = totalOutputs > 0
    ? history.findIndex((h) => h.url === nodeData.outputUrl && h.messageId === nodeData.outputMessageId)
    : -1;
  const effectiveIndex = activeIndex >= 0 ? activeIndex : totalOutputs - 1;

  const navigateTo = useCallback((index: number) => {
    const entry = history[index];
    if (!entry) return;
    // Paginar es "ver": en solo-ver se cambia el resultado mostrado localmente.
    const apply = canEdit ? updateNodeData : updateNodeDataLocal;
    apply(id, {
      ...nodeData,
      outputUrl: entry.url,
      outputMessageId: entry.messageId,
    });
  }, [id, history, nodeData, updateNodeData, updateNodeDataLocal, canEdit]);

  const deleteFromHistory = useCallback((index: number) => {
    const updated = history.filter((_, i) => i !== index);
    if (updated.length === 0) {
      updateNodeData(id, { ...nodeData, outputHistory: [], outputUrl: undefined, outputMessageId: undefined, status: "idle" });
      return;
    }
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
  const isVertical = nodeData.aspectRatio === "9:16";
  const isResized = width != null || height != null;

  const [viewerOpen, setViewerOpen] = useState(false);
  const viewerEntries: MediaViewerEntry[] = history
    .filter((h) => !!h.url)
    .map((h) => ({
      url: h.url!,
      type: "video" as const,
      messageId: h.messageId,
      modelName: h.modelName,
      createdAt: h.createdAt,
    }));

  return (
    <div
      className={`group bg-card rounded-xl border-2 ${statusColors[status]} ${
        selected ? "ring-2 ring-primary/50" : ""
      } transition-all ${nodeSizeClass(width, height, isVertical ? "min-w-[200px] max-w-[220px]" : "min-w-[260px] max-w-[300px]")}`}
    >
      {/* Input handles */}
      <Handle type="target" position={Position.Left} id={HANDLE_IDS.INPUT_PROMPT}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background" style={{ top: "14%" }} title="Prompt (texto)" />
      <Handle type="target" position={Position.Left} id={HANDLE_IDS.INPUT_FIRST_FRAME}
        className="!w-3 !h-3 !bg-green-500 !border-2 !border-background" style={{ top: "30%" }} title="First frame (imagen)" />
      <Handle type="target" position={Position.Left} id={HANDLE_IDS.INPUT_LAST_FRAME}
        className="!w-3 !h-3 !bg-orange-500 !border-2 !border-background" style={{ top: "50%" }} title="Last frame (imagen)" />
      <Handle type="target" position={Position.Left} id={HANDLE_IDS.INPUT_REFERENCE}
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background" style={{ top: "68%" }} title="Referencia (imagen)" />
      <Handle type="target" position={Position.Left} id={HANDLE_IDS.INPUT_PARAMS}
        className="!w-3 !h-3 !border-2 !border-background" style={{ top: "86%", backgroundColor: "#fc0" }} title="Parámetros" />

      {/* Input handles (top twins — same logical inputs, reachable from above) */}
      <Handle type="target" position={Position.Top} id={topHandleId(HANDLE_IDS.INPUT_PROMPT)}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background" style={{ left: "12%" }} title="Prompt (texto)" />
      <Handle type="target" position={Position.Top} id={topHandleId(HANDLE_IDS.INPUT_FIRST_FRAME)}
        className="!w-3 !h-3 !bg-green-500 !border-2 !border-background" style={{ left: "30%" }} title="First frame (imagen)" />
      <Handle type="target" position={Position.Top} id={topHandleId(HANDLE_IDS.INPUT_LAST_FRAME)}
        className="!w-3 !h-3 !bg-orange-500 !border-2 !border-background" style={{ left: "48%" }} title="Last frame (imagen)" />
      <Handle type="target" position={Position.Top} id={topHandleId(HANDLE_IDS.INPUT_REFERENCE)}
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background" style={{ left: "66%" }} title="Referencia (imagen)" />
      <Handle type="target" position={Position.Top} id={topHandleId(HANDLE_IDS.INPUT_PARAMS)}
        className="!w-3 !h-3 !border-2 !border-background" style={{ left: "84%", backgroundColor: "#fc0" }} title="Parámetros" />

      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <Video className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <AIBadge />
        <NodeLabel value={nodeData.label || ""} placeholder="Video" onChange={(label) => updateNodeData(id, { ...nodeData, label })} />
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
      <div className={`px-3 py-2 space-y-1.5 ${isResized ? "flex-1 min-h-0 flex flex-col" : ""}`}>
        <p className={`text-xs line-clamp-2 ${nodeData.prompt ? "text-muted-foreground" : upstreamLabel ? "text-violet-400/80 italic" : "text-muted-foreground"}`}>
          {nodeData.prompt || upstreamLabel || "Sin prompt configurado"}
        </p>

        {displayUrl ? (
          <div className={`mt-1 space-y-1 ${isResized ? "flex-1 min-h-0 flex flex-col" : ""}`}>
            <div
              className={
                isResized
                  ? `rounded-md overflow-hidden bg-muted/50 relative mx-auto flex-1 min-h-0 ${isVertical ? "max-w-[60%]" : "w-full"}`
                  : `rounded-md overflow-hidden bg-muted/50 relative mx-auto max-h-[28vh] ${isVertical ? "max-w-[160px]" : "w-full"}`
              }
            >
              <video
                src={displayUrl}
                className="w-full h-full object-contain"
                style={isResized ? undefined : { aspectRatio: isVertical ? "9/16" : "16/9" }}
                muted playsInline preload="metadata"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setViewerOpen(true);
                }}
                className="nodrag absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/40 transition-colors"
                title="Reproducir en grande"
              >
                <Play className="h-8 w-8 text-white/80" />
              </button>
              {!isViewingLatest && effectiveIndex >= 0 && (
                <div className="absolute top-1 left-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded pointer-events-none">
                  {history[effectiveIndex]?.modelName || "Anterior"}
                </div>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setViewerOpen(true);
                }}
                className="nodrag absolute top-1 right-1 p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                title="Ver detalle"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>
            <HistoryNav history={history} effectiveIndex={effectiveIndex} onNavigate={navigateTo} onDelete={deleteFromHistory} />
          </div>
        ) : status === "generating" ? (
          <div
            className={`mt-1 rounded-md bg-muted/30 border border-dashed border-border/50 flex items-center justify-center ${isVertical ? "mx-auto" : ""}`}
            style={{ aspectRatio: isVertical ? "9/16" : "16/9", maxHeight: "160px" }}
          >
            <Loader2 className="h-5 w-5 text-amber-400 animate-spin" />
          </div>
        ) : status !== "error" ? (
          <div
            className={`mt-1 rounded-md bg-muted/30 border border-dashed border-border/50 flex items-center justify-center ${isVertical ? "mx-auto" : ""}`}
            style={{ aspectRatio: isVertical ? "9/16" : "16/9", maxHeight: "160px" }}
          >
            <Video className="h-5 w-5 text-muted-foreground/30" />
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
      <Handle type="source" position={Position.Right} id={HANDLE_IDS.OUTPUT_VIDEO}
        className="!w-3 !h-3 !bg-amber-500 !border-2 !border-background" title="Video output" />

      <ResizeHandle minWidth={isVertical ? 180 : 220} minHeight={140} />

      {viewerOpen && displayUrl && (
        <MediaViewerModal
          projectId={projectId}
          entries={viewerEntries.length > 0 ? viewerEntries : undefined}
          entry={
            viewerEntries.length > 0
              ? undefined
              : {
                  url: displayUrl,
                  type: "video",
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
            duration: nodeData.duration,
            audioEnabled: nodeData.audioEnabled,
            firstFrameUrl: nodeData.firstFrameUrl,
            lastFrameUrl: nodeData.lastFrameUrl,
            referenceImageUrls: nodeData.referenceImageUrls,
          }}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
});
