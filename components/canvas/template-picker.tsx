"use client";

import { useEffect, useState } from "react";
import { X, Loader2, LayoutTemplate, Trash2, Workflow, MessageSquare, ImageIcon, Video, Bot, Sparkles, Film, StickyNote, Type, ImagePlus, Images, Settings, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface CanvasTemplateSummary {
  id: number;
  name: string;
  description: string | null;
  nodeCount: number;
  edgeCount: number;
  nodeTypes: Record<string, number>;
  createdByName: string | null;
  createdAt: string;
  canManage: boolean;
}

interface TemplatePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onUseTemplate: (templateId: number) => Promise<void>;
  // Ajusta los textos: en canvas vacío se ofrece como punto de partida,
  // con contenido se ofrece como snippet a insertar.
  emptyCanvas: boolean;
}

const typeIconMap: Record<string, typeof MessageSquare> = {
  text: MessageSquare,
  "text-practicante": Bot,
  image: ImageIcon,
  video: Video,
  note: StickyNote,
  "static-text": Type,
  "static-image": ImagePlus,
  "static-image-group": Images,
  "params-text": Settings,
  "params-image": Settings,
  "params-video": Settings,
  "params-scene": Palette,
  script: Sparkles,
  scene: Film,
};

// Overlay de templates: se auto-abre en canvas vacío (punto de partida) y se
// abre desde el toolbar sobre canvas con contenido (insertar como snippet).
// El server remapea IDs, así que insertar nunca colisiona con lo existente.
export function TemplatePicker({ isOpen, onClose, onUseTemplate, emptyCanvas }: TemplatePickerProps) {
  const [templates, setTemplates] = useState<CanvasTemplateSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setLoading(true);
    fetch("/api/canvas-templates")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => setTemplates(data.templates || []))
      .catch((err) => {
        console.error("Error loading canvas templates:", err);
        setError("No se pudieron cargar los templates");
        setTemplates([]);
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleUse = async (templateId: number) => {
    if (applyingId !== null) return;
    setApplyingId(templateId);
    setError(null);
    try {
      await onUseTemplate(templateId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al aplicar el template");
    } finally {
      setApplyingId(null);
    }
  };

  const handleDelete = async (template: CanvasTemplateSummary) => {
    if (!window.confirm(`¿Eliminar el template "${template.name}"?`)) return;
    try {
      const res = await fetch(`/api/canvas-templates/${template.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTemplates((prev) => (prev ? prev.filter((t) => t.id !== template.id) : prev));
    } catch (err) {
      console.error("Error deleting canvas template:", err);
      setError("No se pudo eliminar el template");
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-popover border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col m-4">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">
              {emptyCanvas ? "Empezar desde un template" : "Insertar template"}
            </h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando templates...
            </div>
          ) : templates && templates.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              <Workflow className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Aún no hay templates guardados.
              <p className="text-xs mt-1">
                Arma un canvas y usa &quot;Guardar template&quot; en la barra de herramientas.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {templates?.map((template) => (
                <div
                  key={template.id}
                  className="group border border-border rounded-lg p-3 hover:border-primary/50 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{template.name}</p>
                      {template.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{template.description}</p>
                      )}
                      <div className="flex items-center flex-wrap gap-1.5 mt-2">
                        {Object.entries(template.nodeTypes).map(([type, count]) => {
                          const Icon = typeIconMap[type] || Workflow;
                          return (
                            <span
                              key={type}
                              title={type}
                              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                            >
                              <Icon className="h-2.5 w-2.5" />
                              {count}
                            </span>
                          );
                        })}
                      </div>
                      {template.createdByName && (
                        <p className="text-[10px] text-muted-foreground mt-1.5">
                          por {template.createdByName}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {template.canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(template)}
                          className="h-7 w-7 p-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-500"
                          title="Eliminar template"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => handleUse(template.id)}
                        disabled={applyingId !== null}
                        className="gap-1.5 text-xs h-7"
                      >
                        {applyingId === template.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <LayoutTemplate className="h-3 w-3" />
                        )}
                        {emptyCanvas ? "Usar" : "Insertar"}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {error && <p className="text-xs text-red-500 mt-3 px-1">{error}</p>}
        </div>

        <div className="p-3 border-t border-border flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
            {emptyCanvas ? "Empezar de cero" : "Cerrar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
