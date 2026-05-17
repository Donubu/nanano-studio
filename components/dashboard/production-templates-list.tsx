"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Layers, Trash2, Rocket } from "lucide-react";
import { formatDateLocal } from "@/lib/utils";

// Master arranca siempre en 16:9 (1920×1080). El productor agrega variantes
// (cuadrado, vertical, custom) desde el editor; ya no se selecciona el
// formato al crear el template.
const DEFAULT_MASTER_WIDTH = 1920;
const DEFAULT_MASTER_HEIGHT = 1080;

interface Template {
  id: number;
  production_project_id: number;
  design_id: number | null;
  design_name: string | null;
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
  // Otros templates del mismo design (variantes) que se ven en el editor.
  variant_count: number;
}

interface Props {
  productionProjectId: number;
}

// Etiqueta legible para la orientación de un template, así el usuario sabe
// rápido qué variante es cuál dentro de un design.
function orientationLabel(w: number, h: number): string {
  const ratio = w / h;
  if (Math.abs(ratio - 1) < 0.05) return "Cuadrado";
  if (ratio > 1.5) return "Horizontal";
  if (ratio < 0.7) return "Vertical";
  return "Mixto";
}

export default function ProductionTemplatesList({ productionProjectId }: Props) {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const resetForm = () => {
    setName("");
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const tplRes = await fetch(
        `/api/production/templates?production_project_id=${productionProjectId}`
      );
      if (tplRes.ok) setTemplates(await tplRes.json());
    } catch (err) {
      console.error("Error obteniendo templates:", err);
    } finally {
      setLoading(false);
    }
  }, [productionProjectId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/production/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          production_project_id: productionProjectId,
          name: name.trim(),
          base_width: DEFAULT_MASTER_WIDTH,
          base_height: DEFAULT_MASTER_HEIGHT,
        }),
      });
      if (res.ok) {
        resetForm();
        setShowForm(false);
        fetchAll();
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
      if (res.ok) fetchAll();
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
            Cada template es un master 16:9. Adentro puedes agregar otras
            orientaciones (cuadrado, vertical) y producir adaptaciones.
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

          <p className="text-xs text-muted-foreground">
            Se crea en 16:9 (1920×1080). Después puedes agregar variantes
            (cuadrado, vertical, custom) desde el editor.
          </p>

          <div className="flex items-center gap-2 justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                resetForm();
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
        // Listado plano: 1 card por master. El concepto "design" sigue
        // existiendo en el backend (agrupando las orientaciones) pero el
        // productor no lo ve — cada card es un master completo.
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              router={router}
              deleting={deletingId === t.id}
              onDelete={() => handleDelete(t.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template: t,
  router,
  deleting,
  onDelete,
}: {
  template: Template;
  router: ReturnType<typeof useRouter>;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="relative bg-muted/50 rounded-lg p-3 transition-colors group flex flex-col gap-2">
      <div
        className="w-full bg-background rounded-md border border-border/30 flex items-center justify-center overflow-hidden"
        style={{
          aspectRatio: `${t.base_width} / ${t.base_height}`,
          maxHeight: 200,
        }}
      >
        {t.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.thumbnail_url} alt={t.name} className="w-full h-full object-contain" />
        ) : (
          <Layers className="h-8 w-8 text-muted-foreground/50" />
        )}
      </div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{t.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {orientationLabel(t.base_width, t.base_height)} · {t.base_width}×{t.base_height}
            {t.variant_count > 0 && (
              <>
                {" · "}
                <span className="text-emerald-300">
                  +{t.variant_count}{" "}
                  {t.variant_count === 1 ? "orientación" : "orientaciones"}
                </span>
              </>
            )}
            {" · "}
            {t.adaptation_count} {t.adaptation_count === 1 ? "adaptación" : "adaptaciones"}
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
            onDelete();
          }}
          disabled={deleting}
          title="Eliminar template"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          )}
        </Button>
      </div>
      <Button
        size="sm"
        className="gap-1.5 w-full"
        onClick={() => router.push(`/produccion/template/${t.id}/producir`)}
        title="Abrir el master para componer y producir adaptaciones"
      >
        <Rocket className="h-3.5 w-3.5" />
        Producir
      </Button>
    </div>
  );
}
