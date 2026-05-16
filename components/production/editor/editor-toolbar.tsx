"use client";

import { Type, Image as ImageIcon, Square, Loader2, Check, AlertCircle, Monitor, Palette } from "lucide-react";
import { SaveStatus } from "@/lib/production/use-template-editor";
import { formatDateTimeLocal } from "@/lib/utils";

export interface PreviewPreset {
  id: string;
  label: string;
  size: { w: number; h: number } | null; // null = master
}

interface Props {
  onAddText: () => void;
  onAddImage: () => void;
  onAddShape: () => void;
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  previewPresets: PreviewPreset[];
  activePreviewId: string;
  onSelectPreview: (id: string) => void;
  onOpenProjectBrandKit?: () => void;
}

export function EditorToolbar({
  onAddText,
  onAddImage,
  onAddShape,
  saveStatus,
  lastSavedAt,
  previewPresets,
  activePreviewId,
  onSelectPreview,
  onOpenProjectBrandKit,
}: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-card/40">
      <button
        type="button"
        onClick={onAddText}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-muted transition-colors"
      >
        <Type className="h-3.5 w-3.5" />
        Texto
      </button>
      <button
        type="button"
        onClick={onAddImage}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-muted transition-colors"
      >
        <ImageIcon className="h-3.5 w-3.5" />
        Imagen
      </button>
      <button
        type="button"
        onClick={onAddShape}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-muted transition-colors"
      >
        <Square className="h-3.5 w-3.5" />
        Forma
      </button>

      <div className="h-5 w-px bg-border/50 mx-1" />

      <div className="flex items-center gap-1">
        <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
          Vista
        </span>
        {previewPresets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelectPreview(p.id)}
            className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
              activePreviewId === p.id
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            title={p.size ? `${p.size.w}×${p.size.h}` : "Master"}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {onOpenProjectBrandKit && (
        <button
          type="button"
          onClick={onOpenProjectBrandKit}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Tokens custom solo para este proyecto"
        >
          <Palette className="h-3.5 w-3.5" />
          Brand kit del proyecto
        </button>
      )}

      <SaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} />
    </div>
  );
}

function SaveIndicator({
  status,
  lastSavedAt,
}: {
  status: SaveStatus;
  lastSavedAt: Date | null;
}) {
  if (status === "saving") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Guardando…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-red-400">
        <AlertCircle className="h-3.5 w-3.5" />
        Error al guardar
      </div>
    );
  }
  if (status === "dirty") {
    return <div className="text-xs text-muted-foreground">Cambios sin guardar</div>;
  }
  if (status === "saved" && lastSavedAt) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-green-500" />
        Guardado {formatDateTimeLocal(lastSavedAt.toISOString())}
      </div>
    );
  }
  return null;
}
