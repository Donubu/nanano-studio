"use client";

import { cn } from "@/lib/utils";
import { Trash2, Type, Image as ImageIcon, Square, Layers as LayersIcon } from "lucide-react";
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

export function LayersPanel({ definition, selectedId, onSelect, onDelete }: Props) {
  const flat = flattenLayers(definition);

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
          flat.map(({ layer, depth }) => (
            <div
              key={layer.id}
              className={cn(
                "group flex items-center gap-1 rounded-md transition-colors",
                selectedId === layer.id
                  ? "bg-blue-500/15"
                  : "hover:bg-accent"
              )}
              style={{ paddingLeft: depth * 12 }}
            >
              <button
                type="button"
                onClick={() => onSelect(layer.id)}
                className={cn(
                  "flex-1 flex items-center gap-2 px-2 py-1.5 text-left text-sm",
                  selectedId === layer.id ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {iconFor(layer)}
                <span className="truncate flex-1">{defaultName(layer)}</span>
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
          ))
        )}
      </div>
    </aside>
  );
}
