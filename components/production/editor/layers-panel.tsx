"use client";

import { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, useState } from "react";
import { cn } from "@/lib/utils";
import { Trash2, Type, Image as ImageIcon, Square, Layers as LayersIcon, GripVertical, Lock, Unlock } from "lucide-react";
import {
  TemplateDefinition,
  TemplateLayer,
  flattenLayers,
} from "@/lib/production/types";

interface Props {
  definition: TemplateDefinition;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onReorder: (sourceId: string, targetId: string, position: "before" | "after") => void;
  onToggleLock: (id: string) => void;
  onLayerContextMenu?: (clientX: number, clientY: number, layerId: string) => void;
}

function defaultName(layer: TemplateLayer): string {
  if (layer.name) return layer.name;
  switch (layer.type) {
    case "frame":
      return "Frame";
    case "text":
      return layer.content.split("\n")[0].slice(0, 40) || "Texto";
    case "image":
      return "Imagen";
    case "shape":
      return layer.shape === "ellipse" ? "Elipse" : "Rectángulo";
  }
}

function iconFor(layer: TemplateLayer) {
  const cls = "h-3.5 w-3.5 text-muted-foreground shrink-0";
  switch (layer.type) {
    case "frame":
      return <LayersIcon className={cls} />;
    case "text":
      return <Type className={cls} />;
    case "image":
      return <ImageIcon className={cls} />;
    case "shape":
      return <Square className={cls} />;
  }
}

export function LayersPanel({
  definition,
  selectedId,
  onSelect,
  onDelete,
  onReorder,
  onToggleLock,
  onLayerContextMenu,
}: Props) {
  const flat = flattenLayers(definition);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; position: "before" | "after" } | null>(null);

  // Reorder is only enabled for root-level children in this slice. The panel
  // shows nested children indented but those rows do not participate in DnD.
  const isRootChild = (id: string) =>
    definition.children.some((c) => c.id === id);

  const handleDragStart = (e: ReactDragEvent<HTMLDivElement>, id: string, locked: boolean) => {
    if (!isRootChild(id) || locked) {
      e.preventDefault();
      return;
    }
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleContextMenu = (e: ReactMouseEvent<HTMLDivElement>, id: string) => {
    if (!onLayerContextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(id);
    onLayerContextMenu(e.clientX, e.clientY, id);
  };

  const handleDragOver = (e: ReactDragEvent<HTMLDivElement>, id: string) => {
    if (!dragId || dragId === id || !isRootChild(id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const position: "before" | "after" =
      e.clientY - rect.top < rect.height / 2 ? "before" : "after";
    setDropHint((cur) =>
      cur && cur.id === id && cur.position === position ? cur : { id, position }
    );
  };

  const handleDragLeave = (e: ReactDragEvent<HTMLDivElement>, id: string) => {
    // Only clear if leaving the row entirely, not when entering a child element.
    const next = e.relatedTarget as Node | null;
    if (!next || !e.currentTarget.contains(next)) {
      setDropHint((cur) => (cur && cur.id === id ? null : cur));
    }
  };

  const handleDrop = (e: ReactDragEvent<HTMLDivElement>, id: string) => {
    if (!dragId || dragId === id) return;
    e.preventDefault();
    const position = dropHint && dropHint.id === id ? dropHint.position : "after";
    onReorder(dragId, id, position);
    setDragId(null);
    setDropHint(null);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDropHint(null);
  };

  return (
    <aside className="w-56 shrink-0 border-r border-border/50 bg-card/40 overflow-y-auto">
      <div className="p-3 border-b border-border/50">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Capas
        </h3>
      </div>
      <div className="p-1">
        {/* Root entry */}
        <button
          type="button"
          onClick={() => onSelect("tpl_root")}
          className={cn(
            "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors",
            selectedId === "tpl_root"
              ? "bg-blue-500/15 text-foreground"
              : "hover:bg-accent text-muted-foreground"
          )}
        >
          <LayersIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate flex-1">Canvas</span>
        </button>

        {flat.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Aún no hay capas. Usa la barra superior para agregar.
          </p>
        ) : (
          flat.map(({ layer, depth }) => {
            const isLocked = !!layer.locked;
            const canDrag = isRootChild(layer.id) && !isLocked;
            const showBefore = dropHint?.id === layer.id && dropHint.position === "before";
            const showAfter = dropHint?.id === layer.id && dropHint.position === "after";
            return (
              <div
                key={layer.id}
                draggable={canDrag}
                onDragStart={(e) => handleDragStart(e, layer.id, isLocked)}
                onDragOver={(e) => handleDragOver(e, layer.id)}
                onDragLeave={(e) => handleDragLeave(e, layer.id)}
                onDrop={(e) => handleDrop(e, layer.id)}
                onDragEnd={handleDragEnd}
                onContextMenu={(e) => handleContextMenu(e, layer.id)}
                className={cn(
                  "group relative flex items-center gap-1 rounded-md transition-colors",
                  selectedId === layer.id ? "bg-blue-500/15" : "hover:bg-accent",
                  dragId === layer.id && "opacity-50"
                )}
                style={{ paddingLeft: depth * 12 }}
              >
                {/* Drop indicator lines */}
                {showBefore && (
                  <span className="absolute left-0 right-0 -top-0.5 h-0.5 bg-blue-500 rounded pointer-events-none" />
                )}
                {showAfter && (
                  <span className="absolute left-0 right-0 -bottom-0.5 h-0.5 bg-blue-500 rounded pointer-events-none" />
                )}

                {canDrag ? (
                  <span
                    className="px-1 text-muted-foreground/60 cursor-grab active:cursor-grabbing"
                    title="Arrastrar para reordenar"
                  >
                    <GripVertical className="h-3 w-3" />
                  </span>
                ) : (
                  <span className="px-1 w-5" />
                )}
                <button
                  type="button"
                  onClick={() => onSelect(layer.id)}
                  className={cn(
                    "flex-1 flex items-center gap-2 px-2 py-1.5 text-left text-sm",
                    selectedId === layer.id ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {iconFor(layer)}
                  <span className={cn("truncate flex-1", isLocked && "italic")}>
                    {defaultName(layer)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleLock(layer.id);
                  }}
                  className={cn(
                    "px-1.5 py-1 transition-all",
                    isLocked
                      ? "opacity-100 text-foreground"
                      : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                  )}
                  title={isLocked ? "Desbloquear" : "Bloquear"}
                >
                  {isLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(layer.id);
                  }}
                  className="px-1.5 py-1 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
                  title="Eliminar"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
