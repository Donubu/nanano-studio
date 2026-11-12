"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";
import { Images, Plus, X, FolderOpen, Loader2, ZoomIn, Link2 } from "lucide-react";
import { HANDLE_IDS, topHandleId, type StaticImageGroupNodeData } from "../lib/canvas-types";
import { galleryOutput, type OutEdge, type OutNode } from "../lib/node-outputs";
import { NodeDeleteButton } from "./node-status";
import { NodeLabel } from "./node-label";
import { useCanvasContext } from "../canvas-context";
import { useNodeUpdate } from "../hooks/use-node-update";
import { uploadFileToS3 } from "../lib/canvas-upload";
import { ResizeHandle, nodeSizeClass } from "./resize-handle";
import { MediaViewerModal, type MediaViewerEntry } from "./media-viewer-modal";
import { CanvasImg } from "./canvas-img";

export const StaticImageGroupNodeComponent = memo(function StaticImageGroupNode({ id, data, selected, width, height }: NodeProps) {
  const nodeData = data as unknown as StaticImageGroupNodeData;
  const { updateNodeData } = useNodeUpdate();
  const { openImagePicker, projectId, canEdit } = useCanvasContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const images = nodeData.images || [];
  const [uploading, setUploading] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Imágenes que llegan por la entrada (imagen, galería, etapa de un
  // Personaje…): se suman a las subidas en lo que entrega la galería. Se
  // muestran marcadas y no se borran desde aquí (se desconectan).
  const connectedJson = useStore(
    useCallback(
      (state: { nodeLookup: Map<string, OutNode>; edges: OutEdge[] }) => {
        const self = state.nodeLookup.get(id);
        if (!self || !state.edges.some((e) => e.target === id)) return "[]";
        const own = new Set(((self.data.images as { url: string }[] | undefined) ?? []).map((i) => i.url));
        const all = galleryOutput(self, (nid) => state.nodeLookup.get(nid), state.edges);
        return JSON.stringify(all.filter((i) => !own.has(i.url)).map((i) => i.url));
      },
      [id],
    ) as never,
  ) as unknown as string;
  const connected = useMemo(() => JSON.parse(connectedJson) as string[], [connectedJson]);
  const viewerEntries: MediaViewerEntry[] = [...images.map((img) => img.url), ...connected].map((url) => ({
    url,
    type: "image" as const,
  }));

  // Lista viva de imágenes. El selector agrega N fotos llamando a
  // addImageUrl N veces seguidas (sin re-render entre medio) y la subida de
  // archivos termina después de un await: ambas deben sumar sobre lo último
  // agregado, no sobre la lista que había al abrir. Con el closure, cada
  // llamada pisaba a la anterior y quedaba una sola foto.
  const imagesRef = useRef(images);
  const nodeDataRef = useRef(nodeData);
  imagesRef.current = images;
  nodeDataRef.current = nodeData;

  const appendImages = useCallback((urls: string[]) => {
    const current = imagesRef.current;
    const known = new Set(current.map((img) => img.url));
    const fresh = urls.filter((url) => url && !known.has(url) && (known.add(url), true));
    if (fresh.length === 0) return;
    const next = [...current, ...fresh.map((url) => ({ url }))];
    imagesRef.current = next;
    updateNodeData(id, { ...nodeDataRef.current, images: next });
  }, [id, updateNodeData]);

  const addImageUrl = useCallback((url: string) => appendImages([url]), [appendImages]);

  const addImages = useCallback(async (files: FileList) => {
    setUploading(true);
    try {
      const urls = await Promise.all(
        Array.from(files).map((file) => uploadFileToS3(file, projectId))
      );
      appendImages(urls);
    } catch (err) {
      console.error("Error uploading images:", err);
    } finally {
      setUploading(false);
    }
  }, [appendImages, projectId]);

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
    if (!canEdit) return;
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
  }, [addImages, canEdit]);

  return (
    <div
      className={`group bg-card rounded-xl border-2 border-border ${
        selected ? "ring-2 ring-primary/50" : ""
      } transition-all ${nodeSizeClass(width, height, "w-[260px]")}`}
      onPaste={handlePaste}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <Images className="h-[18px] w-[18px] text-teal-400 shrink-0" />
        <NodeLabel value={nodeData.label || ""} placeholder="Galería" onChange={(label) => updateNodeData(id, { ...nodeData, images: nodeData.images, label })} />
        <span className="text-[13px] text-muted-foreground" title={connected.length ? `${images.length} subidas + ${connected.length} conectadas` : undefined}>
          {images.length + connected.length}
        </span>
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Body - image grid */}
      <div className="px-2 py-2">
        {uploading && (
          <div className="flex items-center justify-center gap-1.5 py-2 text-muted-foreground mb-1.5">
            <Loader2 className="h-[18px] w-[18px] animate-spin" />
            <span className="text-[13px]">Subiendo...</span>
          </div>
        )}
        {connected.length > 0 && (
          <div className="mb-1.5 space-y-1">
            <div className="flex items-center gap-1 text-[12px] text-emerald-700 dark:text-emerald-300">
              <Link2 className="h-3.5 w-3.5" /> {connected.length} {connected.length === 1 ? "conectada" : "conectadas"}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {connected.map((url, i) => (
                <div key={url} className="relative rounded overflow-hidden bg-muted/50 ring-1 ring-emerald-500/50 group/img">
                  <CanvasImg src={url} width={384} alt="" className="w-full aspect-square object-cover" loading="lazy" />
                  <button
                    onClick={(e) => { e.stopPropagation(); setViewerIndex(images.length + i); }}
                    className="nodrag absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 opacity-0 group-hover/img:opacity-100 transition-all"
                    title="Ver en grande (llega por una conexión)"
                  >
                    <ZoomIn className="h-5 w-5 text-white drop-shadow" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {images.length > 0 ? (
          <div className="space-y-1.5">
            <div className="grid grid-cols-3 gap-1">
              {images.map((img, i) => (
                <div key={i} className="relative rounded overflow-hidden bg-muted/50 group/img">
                  <CanvasImg src={img.url} width={384} alt="" className="w-full aspect-square object-cover" loading="lazy" />
                  <button
                    onClick={(e) => { e.stopPropagation(); setViewerIndex(i); }}
                    className="nodrag absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 opacity-0 group-hover/img:opacity-100 transition-all"
                    title="Ver en grande"
                  >
                    <ZoomIn className="h-5 w-5 text-white drop-shadow" />
                  </button>
                  {canEdit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                      className="nodrag absolute top-0.5 right-0.5 p-0.5 rounded bg-black/50 text-white opacity-0 group-hover/img:opacity-100 transition-opacity"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <button
                  onClick={() => inputRef.current?.click()}
                  className="flex-1 py-1 text-[13px] rounded border border-border hover:bg-accent transition-colors flex items-center justify-center gap-1 text-muted-foreground"
                >
                  <Plus className="h-4 w-4" /> Subir
                </button>
                <button
                  onClick={() => openImagePicker(addImageUrl, "Agregar imagen desde galería")}
                  className="flex-1 py-1 text-[13px] rounded border border-border hover:bg-accent transition-colors flex items-center justify-center gap-1 text-muted-foreground"
                >
                  <FolderOpen className="h-4 w-4" /> Galería
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
              <Images className="h-5 w-5" />
              <span className="text-[13px]">Click, pegar o arrastrar</span>
            </button>
            <button
              onClick={() => openImagePicker(addImageUrl, "Agregar imagen desde galería")}
              className="w-full py-2 rounded-md border border-border hover:bg-accent transition-colors flex items-center justify-center gap-1.5 text-muted-foreground hover:text-foreground text-[14px]"
            >
              <FolderOpen className="h-[18px] w-[18px]" /> Seleccionar de galería
            </button>
          </div>
        ) : (
          <div className="py-6 text-center text-[13px] text-muted-foreground">Galería vacía</div>
        )}
        <input ref={inputRef} type="file" accept="image/*" multiple onChange={handleFileSelect} className="hidden" />
      </div>

      {/* Entrada: imágenes que se suman a la galería (izquierda + gemelo superior) */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_GALLERY_IMAGES}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background"
        title="Imágenes que se suman a la galería (imagen, galería o etapa de un Personaje)"
      />
      <Handle
        type="target"
        position={Position.Top}
        id={topHandleId(HANDLE_IDS.INPUT_GALLERY_IMAGES)}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background"
        title="Imágenes que se suman a la galería (imagen, galería o etapa de un Personaje)"
      />

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_IMAGE}
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background"
        title="Image output"
      />

      <ResizeHandle minWidth={200} minHeight={140} />

      {viewerIndex != null && viewerEntries[viewerIndex] && (
        <MediaViewerModal
          projectId={projectId}
          entries={viewerEntries}
          initialIndex={viewerIndex}
          metadata={{ label: nodeData.label }}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
});
