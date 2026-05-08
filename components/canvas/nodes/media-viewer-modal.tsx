"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Download, ChevronLeft, ChevronRight } from "lucide-react";

export interface MediaViewerEntry {
  url: string;
  type: "image" | "video";
  modelName?: string;
  createdAt?: string;
}

interface MediaViewerModalProps {
  /** Single-entry mode: one URL, no navigation. */
  entry?: MediaViewerEntry;
  /** Multi-entry mode: navigate with arrows / arrow keys. */
  entries?: MediaViewerEntry[];
  /** Index into `entries` (multi-entry mode). */
  initialIndex?: number;
  /** Generation metadata to show in the side info panel. */
  metadata?: {
    prompt?: string;
    modelName?: string;
    aspectRatio?: string;
    resolution?: string;
    duration?: number;
    label?: string;
    caption?: string;
  };
  onClose: () => void;
}

/**
 * Lightweight fullscreen viewer for canvas-generated images and videos.
 * Mirrors the chat-interface viewer (ESC to close, backdrop click closes,
 * download button) but adds a sidebar with the generation metadata
 * (prompt, model, aspect ratio, resolution, duration) and history
 * navigation when multiple outputs are passed in.
 */
export function MediaViewerModal({
  entry,
  entries,
  initialIndex = 0,
  metadata,
  onClose,
}: MediaViewerModalProps) {
  const list: MediaViewerEntry[] =
    entries && entries.length > 0 ? entries : entry ? [entry] : [];
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, list.length - 1))
  );
  const total = list.length;
  const current = list[index];

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(total - 1, i + 1));
  }, [total]);

  // Keyboard navigation: ESC closes, arrows navigate (only when multiple).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (total <= 1) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose, goPrev, goNext, total]);

  const handleDownload = useCallback(async () => {
    if (!current) return;
    try {
      const res = await fetch(current.url);
      const blob = await res.blob();
      const ext =
        current.type === "video"
          ? blob.type.includes("webm") ? "webm" : "mp4"
          : blob.type.includes("png") ? "png" : "jpg";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${metadata?.label || "canvas"}-${index + 1}.${ext}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(current.url, "_blank");
    }
  }, [current, index, metadata?.label]);

  if (!current) return null;
  if (typeof document === "undefined") return null;

  const formattedDate = current.createdAt
    ? new Date(current.createdAt).toLocaleString()
    : null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center"
      onClick={onClose}
    >
      {/* Top bar */}
      <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-3 z-10">
        <div className="flex flex-col gap-1 max-w-[60%]">
          {metadata?.label && (
            <span className="text-sm text-white/90 font-medium truncate">
              {metadata.label}
            </span>
          )}
          {metadata?.caption && (
            <span className="text-xs text-white/70 line-clamp-2">
              {metadata.caption}
            </span>
          )}
          {(current.modelName || metadata?.modelName) && (
            <span className="text-xs text-white/50">
              {current.modelName || metadata?.modelName}
              {formattedDate ? ` · ${formattedDate}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDownload();
            }}
            className="p-2.5 bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
            title="Descargar"
          >
            <Download className="h-5 w-5 text-white" />
          </button>
          <button
            onClick={onClose}
            className="p-2.5 bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
            title="Cerrar"
          >
            <X className="h-5 w-5 text-white" />
          </button>
        </div>
      </div>

      {/* Media container */}
      <div
        className="relative max-w-[90vw] max-h-[85vh] flex items-center justify-center mt-16"
        onClick={(e) => e.stopPropagation()}
      >
        {current.type === "image" ? (
          <img
            src={current.url}
            alt=""
            className="max-w-full max-h-[80vh] object-contain rounded-lg"
          />
        ) : (
          <video
            key={current.url}
            src={current.url}
            controls
            autoPlay
            className="max-w-full max-h-[80vh] object-contain rounded-lg"
          />
        )}
      </div>

      {/* History nav (prev / counter / next) */}
      {total > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            disabled={index <= 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/40 hover:bg-black/70 disabled:opacity-30 disabled:cursor-default rounded-full transition-colors z-10"
            title="Anterior"
          >
            <ChevronLeft className="h-6 w-6 text-white" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            disabled={index >= total - 1}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/40 hover:bg-black/70 disabled:opacity-30 disabled:cursor-default rounded-full transition-colors z-10"
            title="Siguiente"
          >
            <ChevronRight className="h-6 w-6 text-white" />
          </button>
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/60 rounded-full text-xs text-white/80 tabular-nums z-10">
            {index + 1} / {total}
          </div>
        </>
      )}

      {/* Metadata footer */}
      {metadata && (metadata.prompt || metadata.aspectRatio || metadata.resolution || metadata.duration != null) && (
        <div
          className="absolute bottom-4 left-4 right-4 max-w-3xl mx-auto bg-black/60 backdrop-blur-sm rounded-lg p-3 text-xs text-white/80 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          {metadata.prompt && (
            <p className="mb-2 line-clamp-3 whitespace-pre-wrap">{metadata.prompt}</p>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-white/60">
            {metadata.aspectRatio && <span>Aspecto: {metadata.aspectRatio}</span>}
            {metadata.resolution && <span>Resolución: {metadata.resolution}</span>}
            {metadata.duration != null && <span>Duración: {metadata.duration}s</span>}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
