"use client";

import {
  Type,
  Image as ImageIcon,
  Square,
  Loader2,
  Check,
  AlertCircle,
  Palette,
  Undo2,
  Redo2,
  MousePointerClick,
  Minus,
  BadgePercent,
  Tag,
  Smile,
} from "lucide-react";
import { SaveStatus } from "@/lib/production/use-template-editor";
import { formatDateTimeLocal } from "@/lib/utils";

interface Props {
  onAddText: () => void;
  onAddImage: () => void;
  onAddShape: () => void;
  onAddIcon: () => void;
  onAddButton: () => void;
  onAddDivider: () => void;
  onAddBadge: () => void;
  onAddRibbon: () => void;
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  onOpenProjectBrandKit?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function EditorToolbar({
  onAddText,
  onAddImage,
  onAddShape,
  onAddIcon,
  onAddButton,
  onAddDivider,
  onAddBadge,
  onAddRibbon,
  saveStatus,
  lastSavedAt,
  onOpenProjectBrandKit,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-card/40">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className="flex items-center justify-center w-7 h-7 rounded-md border border-border/50 hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title="Deshacer (⌘Z)"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className="flex items-center justify-center w-7 h-7 rounded-md border border-border/50 hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title="Rehacer (⌘⇧Z)"
      >
        <Redo2 className="h-3.5 w-3.5" />
      </button>

      <div className="h-5 w-px bg-border/50 mx-1" />

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
      <button
        type="button"
        onClick={onAddIcon}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-muted transition-colors"
        title="Ícono del catálogo curado"
      >
        <Smile className="h-3.5 w-3.5" />
        Ícono
      </button>

      <div className="h-5 w-px bg-border/50 mx-1" />

      {/* Presets compuestos. Cada uno inserta múltiples capas relacionadas
          (button = shape + text, badge = ellipse + text, etc.) en una
          sola acción undo-able. */}
      <button
        type="button"
        onClick={onAddButton}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-muted transition-colors"
        title="Botón CTA (pill + texto)"
      >
        <MousePointerClick className="h-3.5 w-3.5" />
        Botón
      </button>
      <button
        type="button"
        onClick={onAddDivider}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-muted transition-colors"
        title="Línea divisoria horizontal"
      >
        <Minus className="h-3.5 w-3.5" />
        Línea
      </button>
      <button
        type="button"
        onClick={onAddBadge}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-muted transition-colors"
        title="Badge circular de descuento"
      >
        <BadgePercent className="h-3.5 w-3.5" />
        Badge
      </button>
      <button
        type="button"
        onClick={onAddRibbon}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border/50 hover:bg-muted transition-colors"
        title="Ribbon diagonal tipo cinta de oferta"
      >
        <Tag className="h-3.5 w-3.5" />
        Ribbon
      </button>

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
