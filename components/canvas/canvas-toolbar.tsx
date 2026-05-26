"use client";

import { useState } from "react";
import { ImageIcon, Video, MessageSquare, Play, Plus, Check, Loader2, AlertCircle, Save, Zap, StickyNote, ImagePlus, Images, Type, Copy, Lock, Unlock, Settings, Bot, Sparkles, Palette, LayoutGrid, Hand, MousePointer2, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CanvasNodeType, ExecutionProgress } from "./lib/canvas-types";

interface CanvasToolbarProps {
  onAddNode: (type: CanvasNodeType) => void;
  onRunAll: () => void;
  onClone: () => void;
  onLockAll: () => void;
  onReorder: () => void;
  isExecuting: boolean;
  isAllLocked: boolean;
  executionProgress: ExecutionProgress | null;
  saveStatus?: "idle" | "saving" | "saved" | "error";
  nodeCount: number;
  canvasMode: "pan" | "select";
  onCanvasModeChange: (mode: "pan" | "select") => void;
  onOpenHistory: () => void;
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
  onRunAll,
  onClone,
  onLockAll,
  onReorder,
  isExecuting,
  isAllLocked,
  executionProgress,
  saveStatus = "idle",
  nodeCount,
  canvasMode,
  onCanvasModeChange,
  onOpenHistory,
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

      {/* Primary toolbar: Node, Run, Save */}
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

        {/* Run All */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onRunAll}
          disabled={isExecuting || nodeCount === 0}
          className="gap-1.5 text-xs"
        >
          {isExecuting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {isExecuting && executionProgress
            ? executionProgress.message || "Ejecutando..."
            : "Run All"}
        </Button>

        <div className="w-px h-5 bg-border" />

        {/* Save status */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground px-1">
          {saveStatus === "saving" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Guardando...</span>
            </>
          )}
          {saveStatus === "saved" && (
            <>
              <Check className="h-3 w-3 text-green-500" />
              <span>Guardado</span>
            </>
          )}
          {saveStatus === "error" && (
            <>
              <AlertCircle className="h-3 w-3 text-red-500" />
              <span>Error</span>
            </>
          )}
          {saveStatus === "idle" && (
            <>
              <Save className="h-3 w-3" />
            </>
          )}
        </div>
      </div>

      {/* Secondary toolbar: Reorder, Clone, Lock All */}
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
    </div>
  );
}
