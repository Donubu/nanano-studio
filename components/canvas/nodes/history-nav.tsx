"use client";

import { useCallback } from "react";
import { ChevronLeft, ChevronRight, Download, Trash2 } from "lucide-react";
import type { OutputHistoryEntry } from "../lib/canvas-types";
import { useCanvasContext } from "../canvas-context";

interface HistoryNavProps {
  history: OutputHistoryEntry[];
  effectiveIndex: number;
  onNavigate: (index: number) => void;
  onDelete: (index: number) => void;
}

export function HistoryNav({ history, effectiveIndex, onNavigate, onDelete }: HistoryNavProps) {
  const { canEdit } = useCanvasContext();
  const total = history.length;
  if (total === 0) return null;
  const isSingle = total === 1;

  const current = history[effectiveIndex];

  const handleDownload = useCallback(async () => {
    const url = current?.url || current?.text;
    if (!url) return;

    if (current.text && !current.url) {
      // Text node: download as .txt
      const blob = new Blob([current.text], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `output-${effectiveIndex + 1}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    }

    // Image/Video: fetch and download
    try {
      const res = await fetch(current.url!);
      const blob = await res.blob();
      const ext = blob.type.includes("video") ? "mp4" : blob.type.includes("png") ? "png" : "jpg";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `output-${effectiveIndex + 1}.${ext}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      // Fallback: open in new tab
      window.open(current.url!, "_blank");
    }
  }, [current, effectiveIndex]);

  const handleDelete = useCallback(() => {
    if (!window.confirm("¿Eliminar esta generación del historial?")) return;
    onDelete(effectiveIndex);
  }, [effectiveIndex, onDelete]);

  return (
    <div className="flex items-center justify-center gap-2 py-1">
      <button
        onClick={handleDownload}
        className="nodrag p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        title="Descargar"
      >
        <Download className="h-4 w-4" />
      </button>
      {!isSingle && (
        <>
          <button
            onClick={() => onNavigate(effectiveIndex - 1)}
            disabled={effectiveIndex <= 0}
            className="nodrag p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-default transition-colors"
            title="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs font-medium text-muted-foreground tabular-nums min-w-[32px] text-center">
            {effectiveIndex + 1}/{total}
          </span>
          <button
            onClick={() => onNavigate(effectiveIndex + 1)}
            disabled={effectiveIndex >= total - 1}
            className="nodrag p-1.5 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-default transition-colors"
            title="Siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}
      {canEdit && (
        <button
          onClick={handleDelete}
          className="nodrag p-1.5 rounded hover:bg-red-500/15 text-muted-foreground hover:text-red-400 transition-colors"
          title={isSingle ? "Eliminar generación" : "Eliminar del historial"}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
