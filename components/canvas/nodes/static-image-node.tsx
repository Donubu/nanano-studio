"use client";

import { memo, useCallback, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ImagePlus, Upload, FolderOpen, Loader2, ZoomIn } from "lucide-react";
import { HANDLE_IDS, type StaticImageNodeData } from "../lib/canvas-types";
import { NodeDeleteButton } from "./node-status";
import { NodeLabel } from "./node-label";
import { useCanvasContext } from "../canvas-context";
import { useNodeUpdate } from "../hooks/use-node-update";
import { uploadFileToS3 } from "../lib/canvas-upload";
import { ResizeHandle, nodeSizeClass } from "./resize-handle";
import { MediaViewerModal } from "./media-viewer-modal";

export const StaticImageNodeComponent = memo(function StaticImageNode({ id, data, selected, width, height }: NodeProps) {
  const nodeData = data as unknown as StaticImageNodeData;
  const { updateNodeData } = useNodeUpdate();
  const { openImagePicker, projectId, canEdit } = useCanvasContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const isResized = width != null || height != null;

  const setImage = useCallback((url: string) => {
    updateNodeData(id, { ...nodeData, imageUrl: url });
  }, [id, nodeData, updateNodeData]);

  const uploadAndSetImage = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadFileToS3(file, projectId);
      setImage(url);
    } catch (err) {
      console.error("Error uploading image:", err);
    } finally {
      setUploading(false);
    }
  }, [projectId, setImage]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadAndSetImage(file);
  }, [uploadAndSetImage]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!canEdit) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        uploadAndSetImage(file);
        break;
      }
    }
  }, [uploadAndSetImage, canEdit]);

  return (
    <div
      className={`group bg-card rounded-xl border-2 border-border ${
        selected ? "ring-2 ring-primary/50" : ""
      } transition-all ${nodeSizeClass(width, height, "min-w-[200px] max-w-[300px]")}`}
      onPaste={handlePaste}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <ImagePlus className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        <NodeLabel value={nodeData.label || ""} placeholder="Imagen" onChange={(label) => updateNodeData(id, { ...nodeData, imageUrl: nodeData.imageUrl, label })} />
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Body */}
      <div className={`px-3 py-2 ${isResized ? "flex-1 min-h-0 flex flex-col" : ""}`}>
        {uploading ? (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mb-1" />
            <span className="text-[10px]">Subiendo...</span>
          </div>
        ) : nodeData.imageUrl ? (
          <div className={`space-y-1.5 ${isResized ? "flex-1 min-h-0 flex flex-col" : ""}`}>
            <div className={`group/img relative rounded-md overflow-hidden bg-muted/50 ${isResized ? "flex-1 min-h-0" : ""}`}>
              <img
                src={nodeData.imageUrl}
                alt={nodeData.caption || "Static"}
                className={
                  isResized
                    ? "w-full h-full object-contain rounded-md"
                    : "max-w-full max-h-[28vh] mx-auto object-contain rounded-md"
                }
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setViewerOpen(true);
                }}
                className="nodrag absolute top-1 right-1 p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover/img:opacity-100 transition-opacity"
                title="Ver en grande"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <button
                  onClick={() => inputRef.current?.click()}
                  className="flex-1 py-1 text-[10px] rounded border border-border hover:bg-accent transition-colors flex items-center justify-center gap-1 text-muted-foreground"
                >
                  <Upload className="h-3 w-3" /> Subir
                </button>
                <button
                  onClick={() => openImagePicker(setImage)}
                  className="flex-1 py-1 text-[10px] rounded border border-border hover:bg-accent transition-colors flex items-center justify-center gap-1 text-muted-foreground"
                >
                  <FolderOpen className="h-3 w-3" /> Galería
                </button>
              </div>
            )}
          </div>
        ) : canEdit ? (
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full py-4 rounded-md border-2 border-dashed border-border hover:border-primary/50 transition-colors flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <Upload className="h-4 w-4" />
              <span className="text-[10px]">Click, pegar o arrastrar</span>
            </button>
            <button
              onClick={() => openImagePicker(setImage)}
              className="w-full py-2 rounded-md border border-border hover:bg-accent transition-colors flex items-center justify-center gap-1.5 text-muted-foreground hover:text-foreground text-[11px]"
            >
              <FolderOpen className="h-3.5 w-3.5" /> Seleccionar de galería
            </button>
          </div>
        ) : (
          <div className="py-6 text-center text-[10px] text-muted-foreground">Sin imagen</div>
        )}
        <input ref={inputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_IMAGE}
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background"
        title="Image output"
      />

      <ResizeHandle minWidth={180} minHeight={140} />

      {viewerOpen && nodeData.imageUrl && (
        <MediaViewerModal
          projectId={projectId}
          entry={{ url: nodeData.imageUrl, type: "image" }}
          metadata={{
            label: nodeData.label,
            caption: nodeData.caption,
          }}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
});
