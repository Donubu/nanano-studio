"use client";

import { memo, useCallback, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Images, Plus, X, FolderOpen, Loader2 } from "lucide-react";
import { HANDLE_IDS, type StaticImageGroupNodeData } from "../lib/canvas-types";
import { NodeDeleteButton } from "./node-status";
import { useCanvasContext } from "../canvas-context";
import { useNodeUpdate } from "../hooks/use-node-update";
import { uploadFileToS3 } from "../lib/canvas-upload";
import { ResizeHandle, nodeSizeClass } from "./resize-handle";

export const StaticImageGroupNodeComponent = memo(function StaticImageGroupNode({ id, data, selected, width, height }: NodeProps) {
  const nodeData = data as unknown as StaticImageGroupNodeData;
  const { updateNodeData } = useNodeUpdate();
  const { openImagePicker, projectId } = useCanvasContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const images = nodeData.images || [];
  const [uploading, setUploading] = useState(false);

  const existingUrls = new Set(images.map((img) => img.url));

  const addImageUrl = useCallback((url: string) => {
    if (existingUrls.has(url)) return;
    const newImages = [...images, { url }];
    updateNodeData(id, { ...nodeData, images: newImages });
  }, [id, nodeData, images, updateNodeData, existingUrls]);

  const addImages = useCallback(async (files: FileList) => {
    setUploading(true);
    try {
      const urls = await Promise.all(
        Array.from(files).map((file) => uploadFileToS3(file, projectId))
      );
      const deduped = urls.filter((url) => !existingUrls.has(url));
      if (deduped.length === 0) return;
      const newImages = [...images, ...deduped.map((url) => ({ url }))];
      updateNodeData(id, { ...nodeData, images: newImages });
    } catch (err) {
      console.error("Error uploading images:", err);
    } finally {
      setUploading(false);
    }
  }, [id, nodeData, images, updateNodeData, existingUrls, projectId]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addImages(e.target.files);
      e.target.value = "";
    }
  }, [addImages]);

  const removeImage = useCallback((index: number) => {
    const newImages = images.filter((_, i) => i !== index);
    updateNodeData(id, { ...nodeData, images: newImages });
  }, [id, nodeData, images, updateNodeData]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      const dt = new DataTransfer();
      imageFiles.forEach((f) => dt.items.add(f));
      addImages(dt.files);
    }
  }, [addImages]);

  return (
    <div
      className={`group bg-card rounded-xl border-2 border-border ${
        selected ? "ring-2 ring-primary/50" : ""
      } transition-all ${nodeSizeClass(width, height, "min-w-[220px] max-w-[340px]")}`}
      onPaste={handlePaste}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <Images className="h-3.5 w-3.5 text-teal-400 shrink-0" />
        <input value={nodeData.label || ""} onChange={(e) => updateNodeData(id, { ...nodeData, images: nodeData.images, label: e.target.value })} placeholder="Galería" className="text-xs font-medium flex-1 min-w-0 bg-transparent border-none outline-none truncate placeholder:text-muted-foreground/50" />
        <span className="text-[10px] text-muted-foreground">{images.length}</span>
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Body - image grid */}
      <div className="px-2 py-2">
        {uploading && (
          <div className="flex items-center justify-center gap-1.5 py-2 text-muted-foreground mb-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-[10px]">Subiendo...</span>
          </div>
        )}
        {images.length > 0 ? (
          <div className="space-y-1.5">
            <div className="grid grid-cols-3 gap-1">
              {images.map((img, i) => (
                <div key={i} className="relative rounded overflow-hidden bg-muted/50 group/img">
                  <img src={img.url} alt="" className="w-full aspect-square object-cover" />
                  <button
                    onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                    className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/50 text-white opacity-0 group-hover/img:opacity-100 transition-opacity"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => inputRef.current?.click()}
                className="flex-1 py-1 text-[10px] rounded border border-border hover:bg-accent transition-colors flex items-center justify-center gap-1 text-muted-foreground"
              >
                <Plus className="h-3 w-3" /> Subir
              </button>
              <button
                onClick={() => openImagePicker(addImageUrl, "Agregar imagen desde galería")}
                className="flex-1 py-1 text-[10px] rounded border border-border hover:bg-accent transition-colors flex items-center justify-center gap-1 text-muted-foreground"
              >
                <FolderOpen className="h-3 w-3" /> Galería
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full py-4 rounded-md border-2 border-dashed border-border hover:border-primary/50 transition-colors flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <Images className="h-4 w-4" />
              <span className="text-[10px]">Click, pegar o arrastrar</span>
            </button>
            <button
              onClick={() => openImagePicker(addImageUrl, "Agregar imagen desde galería")}
              className="w-full py-2 rounded-md border border-border hover:bg-accent transition-colors flex items-center justify-center gap-1.5 text-muted-foreground hover:text-foreground text-[11px]"
            >
              <FolderOpen className="h-3.5 w-3.5" /> Seleccionar de galería
            </button>
          </div>
        )}
        <input ref={inputRef} type="file" accept="image/*" multiple onChange={handleFileSelect} className="hidden" />
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_IMAGE}
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background"
        title="Image output"
      />

      <ResizeHandle minWidth={200} minHeight={140} />
    </div>
  );
});
