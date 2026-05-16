"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Layers, Trash2 } from "lucide-react";
import { formatDateLocal } from "@/lib/utils";

interface Template {
  id: number;
  production_project_id: number;
  name: string;
  description: string | null;
  base_width: number;
  base_height: number;
  thumbnail_url: string | null;
  status: "draft" | "published" | "archived";
  version: number;
  created_at: string;
  updated_at: string;
  adaptation_count: number;
}

interface Props {
  productionProjectId: number;
}

export default function ProductionTemplatesList({ productionProjectId }: Props) {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [width, setWidth] = useState("1080");
  const [height, setHeight] = useState("1080");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/production/templates?production_project_id=${productionProjectId}`
      );
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error("Error obteniendo templates:", err);
    } finally {
      setLoading(false);
    }
  }, [productionProjectId]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    const w = Number(width);
    const h = Number(height);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/production/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          production_project_id: productionProjectId,
          name: name.trim(),
          base_width: w,
          base_height: h,
        }),
      });
      if (res.ok) {
        setName("");
        setWidth("1080");
        setHeight("1080");
        setShowForm(false);
        fetchTemplates();
      }
    } catch (err) {
      console.error("Error creando template:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar este template?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/production/templates/${id}`, { method: "DELETE" });
      if (res.ok) fetchTemplates();
    } catch (err) {
      console.error("Error eliminando template:", err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium">Templates</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            El template master se compone una vez y luego se replica en cada formato de salida
          </p>
        </div>
        {!showForm && (
          <Button size="sm" onClick={() => setShowForm(true)} className="gap-1">
            <Plus className="h-4 w-4" /> Nuevo template
          </Button>
        )}
      </div>

      {showForm && (
        <div className="mb-4 space-y-2 border border-border/50 rounded-lg p-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del template"
            className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">Ancho base (px)</label>
              <input
                type="number"
                min={1}
                max={10000}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">Alto base (px)</label>
              <input
                type="number"
                min={1}
                max={10000}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                setName("");
                setWidth("1080");
                setHeight("1080");
              }}
              disabled={creating}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!name.trim() || creating}
              className="gap-1"
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Crear
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          Aún no hay templates en este proyecto
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/produccion/template/${t.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/produccion/template/${t.id}`);
                }
              }}
              className="relative bg-muted/50 hover:bg-muted rounded-lg p-3 cursor-pointer transition-colors group"
            >
              <div
                className="w-full bg-background rounded-md border border-border/30 flex items-center justify-center mb-2 overflow-hidden"
                style={{
                  aspectRatio: `${t.base_width} / ${t.base_height}`,
                  maxHeight: 200,
                }}
              >
                {t.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.thumbnail_url}
                    alt={t.name}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <Layers className="h-8 w-8 text-muted-foreground/50" />
                )}
              </div>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{t.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.base_width}×{t.base_height}
                    {" · "}
                    {t.adaptation_count}{" "}
                    {t.adaptation_count === 1 ? "adaptación" : "adaptaciones"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Actualizado {formatDateLocal(t.updated_at)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(t.id);
                  }}
                  disabled={deletingId === t.id}
                >
                  {deletingId === t.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
