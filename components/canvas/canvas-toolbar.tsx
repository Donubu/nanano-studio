"use client";

import { useEffect, useState } from "react";
import { ImageIcon, Video, MessageSquare, Plus, Check, Loader2, AlertCircle, Save, Zap, StickyNote, ImagePlus, Images, Type, Copy, Lock, Unlock, Settings, Bot, Sparkles, Palette, LayoutGrid, Hand, MousePointer2, History, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CanvasNodeType } from "./lib/canvas-types";

interface CanvasToolbarProps {
  onAddNode: (type: CanvasNodeType) => void;
  onClone: () => void;
  onLockAll: () => void;
  onReorder: () => void;
  isExecuting: boolean;
  isAllLocked: boolean;
  saveStatus?: "idle" | "saving" | "saved" | "error";
  lastSavedAt?: number | null;
  nodeCount: number;
  canvasMode: "pan" | "select";
  onCanvasModeChange: (mode: "pan" | "select") => void;
  onOpenHistory: () => void;
  // Lock de edición: si false, el usuario está en solo-ver y se ocultan todas
  // las herramientas de escritura, mostrando un badge con quién edita.
  canEdit: boolean;
  editorName?: string | null;
}

const nodeOptions: { type: CanvasNodeType; icon: typeof MessageSquare; label: string; isAI: boolean }[] = [
  { type: "text", icon: MessageSquare, label: "Texto", isAI: true },
  { type: "text-practicante", icon: Bot, label: "Practicante", isAI: true },
  { type: "script", icon: Sparkles, label: "Guión", isAI: true },
  { type: "image", icon: ImageIcon, label: "Imagen", isAI: true },
  { type: "video", icon: Video, label: "Video", isAI: true },
  { type: "note", icon: StickyNote, label: "Nota", isAI: false },
  { type: "static-text", icon: Type, label: "Texto", isAI: false },
  { type: "static-image", icon: ImagePlus, label: "Imagen estática", isAI: false },
  { type: "static-image-group", icon: Images, label: "Galería", isAI: false },
];

const paramsOptions: { type: CanvasNodeType; icon: typeof MessageSquare; label: string }[] = [
  { type: "params-text", icon: MessageSquare, label: "Params Texto" },
  { type: "params-image", icon: ImageIcon, label: "Params Imagen" },
  { type: "params-video", icon: Video, label: "Params Video" },
  { type: "params-scene", icon: Palette, label: "Params Escena" },
];

export function CanvasToolbar({
  onAddNode,
  onClone,
  onLockAll,
  onReorder,
  isExecuting,
  isAllLocked,
  saveStatus = "idle",
  lastSavedAt = null,
  nodeCount,
  canvasMode,
  onCanvasModeChange,
  onOpenHistory,
  canEdit,
  editorName,
}: CanvasToolbarProps) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  return (
    <div className="flex items-center gap-1.5">
      {/* Mode toggle: Pan vs Select */}
      <div className="flex items-center gap-0.5 bg-background/90 backdrop-blur-sm border border-border rounded-lg p-1 shadow-lg">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onCanvasModeChange("pan")}
          className={`h-7 w-7 p-0 ${canvasMode === "pan" ? "bg-accent text-foreground" : "text-muted-foreground"}`}
          title="Mover canvas (H)"
        >
          <Hand className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onCanvasModeChange("select")}
          className={`h-7 w-7 p-0 ${canvasMode === "select" ? "bg-accent text-foreground" : "text-muted-foreground"}`}
          title="Seleccionar con rectángulo (V)"
        >
          <MousePointer2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Solo-lectura: badge con quién está editando. No hay herramientas de escritura. */}
      {!canEdit && (
        <div className="flex items-center gap-1.5 bg-background/90 backdrop-blur-sm border border-amber-500/40 rounded-lg px-2.5 py-1.5 shadow-lg text-xs text-amber-500">
          <Eye className="h-3.5 w-3.5" />
          <span className="font-medium">Solo lectura</span>
          {editorName && (
            <span className="text-muted-foreground">· edita {editorName}</span>
          )}
        </div>
      )}

      {/* Primary toolbar: Node, Save — solo para el editor */}
      {canEdit && (
      <div className="flex items-center gap-2 bg-background/90 backdrop-blur-sm border border-border rounded-lg p-1.5 shadow-lg">
        {/* Add Node */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAddMenuOpen(!addMenuOpen)}
            className="gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Nodo
          </Button>
          {addMenuOpen && (
            <div className="absolute top-full left-0 mt-1 bg-popover border border-border rounded-lg shadow-lg p-1 min-w-[190px] z-50">
              <div className="px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wider">Generación</div>
              {nodeOptions.filter(o => o.isAI).map(({ type, icon: Icon, label }) => (
                <button
                  key={type}
                  onClick={() => { onAddNode(type); setAddMenuOpen(false); }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm rounded-md hover:bg-accent transition-colors"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-0.5 rounded bg-primary/10 text-primary ml-auto"><Zap className="h-2.5 w-2.5" />IA</span>
                </button>
              ))}
              <div className="my-1 border-t border-border/50" />
              <div className="px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wider">Estático</div>
              {nodeOptions.filter(o => !o.isAI).map(({ type, icon: Icon, label }) => (
                <button
                  key={type}
                  onClick={() => { onAddNode(type); setAddMenuOpen(false); }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm rounded-md hover:bg-accent transition-colors"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
              <div className="my-1 border-t border-border/50" />
              <div className="px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wider">Parámetros</div>
              {paramsOptions.map(({ type, icon: Icon, label }) => (
                <button
                  key={type}
                  onClick={() => { onAddNode(type); setAddMenuOpen(false); }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm rounded-md hover:bg-accent transition-colors whitespace-nowrap"
                >
                  <Settings className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-border" />

        {/* Save status */}
        <SaveStatus saveStatus={saveStatus} lastSavedAt={lastSavedAt} />
      </div>
      )}

      {/* Secondary toolbar: Reorder, Clone, Lock All — solo para el editor */}
      {canEdit && (
      <div className="flex items-center gap-1 bg-background/90 backdrop-blur-sm border border-border rounded-lg p-1.5 shadow-lg">
        <Button
          variant="ghost"
          size="sm"
          onClick={onReorder}
          disabled={isExecuting || nodeCount === 0}
          className="gap-1.5 text-xs"
          title="Reordenar todos los nodos en columnas según sus dependencias"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Reordenar
        </Button>

        <div className="w-px h-5 bg-border" />

        <Button
          variant="ghost"
          size="sm"
          onClick={onClone}
          disabled={isExecuting || nodeCount === 0}
          className="gap-1.5 text-xs"
          title="Clonar canvas en nueva conversación"
        >
          <Copy className="h-3.5 w-3.5" />
          Clonar
        </Button>

        <div className="w-px h-5 bg-border" />

        <Button
          variant="ghost"
          size="sm"
          onClick={onLockAll}
          disabled={nodeCount === 0}
          className={`gap-1.5 text-xs ${isAllLocked ? "text-amber-500" : ""}`}
          title={isAllLocked ? "Desbloquear todos los nodos" : "Bloquear todos los nodos"}
        >
          {isAllLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          {isAllLocked ? "Bloqueado" : "Bloquear"}
        </Button>

        <div className="w-px h-5 bg-border" />

        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenHistory}
          className="gap-1.5 text-xs"
          title="Papelera y snapshots del canvas"
        >
          <History className="h-3.5 w-3.5" />
          Historial
        </Button>
      </div>
      )}
    </div>
  );
}

function formatRelativeSaved(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 5) return "recién";
  if (secs < 60) return `hace ${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  return `hace ${hours} h`;
}

function SaveStatus({
  saveStatus,
  lastSavedAt,
}: {
  saveStatus: "idle" | "saving" | "saved" | "error";
  lastSavedAt: number | null;
}) {
  // Re-render periódico para refrescar el "hace Xs" mientras está en reposo.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (saveStatus === "saving") return;
    const t = setInterval(() => setTick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, [saveStatus, lastSavedAt]);

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground px-1" title="Estado de guardado del canvas">
      {saveStatus === "saving" ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Guardando...</span>
        </>
      ) : saveStatus === "error" ? (
        <>
          <AlertCircle className="h-3 w-3 text-red-500" />
          <span>Error al guardar</span>
        </>
      ) : lastSavedAt ? (
        <>
          <Check className="h-3 w-3 text-green-500" />
          <span>Guardado {formatRelativeSaved(lastSavedAt)}</span>
        </>
      ) : (
        <>
          <Save className="h-3 w-3" />
          <span>Sin cambios</span>
        </>
      )}
    </div>
  );
}
