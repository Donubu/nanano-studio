"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Layers, Trash2, Pencil, Rocket, FolderPlus, FolderOpen, X } from "lucide-react";
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

interface Design {
  id: number;
  name: string;
  description: string | null;
  template_count: number;
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
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Design management state
  const [showDesignForm, setShowDesignForm] = useState(false);
  const [newDesignName, setNewDesignName] = useState("");
  const [creatingDesign, setCreatingDesign] = useState(false);
  const [assigningId, setAssigningId] = useState<number | null>(null);

  const resetForm = () => {
    setName("");
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tplRes, designsRes] = await Promise.all([
        fetch(`/api/production/templates?production_project_id=${productionProjectId}`),
        fetch(`/api/production/designs?production_project_id=${productionProjectId}`),
      ]);
      if (tplRes.ok) setTemplates(await tplRes.json());
      if (designsRes.ok) setDesigns(await designsRes.json());
    } catch (err) {
      console.error("Error obteniendo templates/designs:", err);
    } finally {
      setLoading(false);
    }
  }, [productionProjectId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleCreateDesign = async () => {
    if (!newDesignName.trim()) return;
    setCreatingDesign(true);
    try {
      const res = await fetch(`/api/production/designs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          production_project_id: productionProjectId,
          name: newDesignName.trim(),
        }),
      });
      if (res.ok) {
        setNewDesignName("");
        setShowDesignForm(false);
        fetchAll();
      }
    } finally {
      setCreatingDesign(false);
    }
  };

  const handleAssignDesign = async (templateId: number, designId: number | null) => {
    setAssigningId(templateId);
    try {
      const res = await fetch(`/api/production/templates/${templateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ design_id: designId }),
      });
      if (res.ok) fetchAll();
    } finally {
      setAssigningId(null);
    }
  };

  const handleDeleteDesign = async (designId: number) => {
    if (!confirm("¿Eliminar este design? Los templates dentro quedarán sueltos (no se borran).")) return;
    const res = await fetch(`/api/production/designs/${designId}`, { method: "DELETE" });
    if (res.ok) fetchAll();
  };

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

  // Agrupar templates por design para el render: primero un grupo por cada
  // design, luego un grupo "sueltos" con los que no tienen design_id.
  const grouped: { design: Design | null; templates: Template[] }[] = [];
  for (const d of designs) {
    grouped.push({ design: d, templates: templates.filter((t) => t.design_id === d.id) });
  }
  const loose = templates.filter((t) => t.design_id == null);
  if (loose.length > 0 || grouped.length === 0) {
    grouped.push({ design: null, templates: loose });
  }

  return (
    <div className="bg-card rounded-xl border border-border/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium">Templates</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            El template master se compone una vez y luego se replica en cada formato de salida.
            Agrupa variantes de orientación en un <span className="text-foreground">Design</span> para
            tratarlas como una pieza única.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!showDesignForm && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowDesignForm(true)}
              className="gap-1"
            >
              <FolderPlus className="h-4 w-4" /> Nuevo design
            </Button>
          )}
          {!showForm && (
            <Button size="sm" onClick={() => setShowForm(true)} className="gap-1">
              <Plus className="h-4 w-4" /> Nuevo template
            </Button>
          )}
        </div>
      </div>

      {showDesignForm && (
        <div className="mb-4 flex items-center gap-2 border border-border/50 rounded-lg p-3">
          <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={newDesignName}
            onChange={(e) => setNewDesignName(e.target.value)}
            placeholder="Nombre del design (ej: Black Friday 2026)"
            className="flex-1 bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && newDesignName.trim()) handleCreateDesign();
              if (e.key === "Escape") {
                setShowDesignForm(false);
                setNewDesignName("");
              }
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setShowDesignForm(false);
              setNewDesignName("");
            }}
            disabled={creatingDesign}
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleCreateDesign}
            disabled={!newDesignName.trim() || creatingDesign}
            className="gap-1"
          >
            {creatingDesign ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
            Crear
          </Button>
        </div>
      )}

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
      ) : templates.length === 0 && designs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          Aún no hay templates en este proyecto
        </p>
      ) : (
        <div className="space-y-5">
          {grouped.map((group, gi) => (
            <div key={group.design?.id ?? `loose-${gi}`}>
              <div className="flex items-center gap-2 mb-2">
                {group.design ? (
                  <>
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                    <h4 className="text-sm font-medium">{group.design.name}</h4>
                    <span className="text-xs text-muted-foreground">
                      ({group.templates.length}{" "}
                      {group.templates.length === 1 ? "variante" : "variantes"})
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 hover:bg-red-500/10 opacity-0 group-hover:opacity-100"
                      onClick={() => handleDeleteDesign(group.design!.id)}
                      title="Eliminar design (los templates quedan sueltos)"
                    >
                      <X className="h-3.5 w-3.5 text-red-400" />
                    </Button>
                  </>
                ) : grouped.length > 1 ? (
                  <h4 className="text-xs uppercase tracking-wider text-muted-foreground">
                    Sueltos
                  </h4>
                ) : null}
              </div>
              {group.templates.length === 0 ? (
                <p className="text-xs text-muted-foreground pl-6">
                  Sin variantes todavía. Asigna templates a este design desde su menú.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.templates.map((t) => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      designs={designs}
                      router={router}
                      deleting={deletingId === t.id}
                      assigning={assigningId === t.id}
                      onDelete={() => handleDelete(t.id)}
                      onAssignDesign={(designId) => handleAssignDesign(t.id, designId)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template: t,
  designs,
  router,
  deleting,
  assigning,
  onDelete,
  onAssignDesign,
}: {
  template: Template;
  designs: Design[];
  router: ReturnType<typeof useRouter>;
  deleting: boolean;
  assigning: boolean;
  onDelete: () => void;
  onAssignDesign: (designId: number | null) => void;
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
                  {t.variant_count === 1 ? "variante" : "variantes"}
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
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 gap-1.5"
          onClick={() => router.push(`/produccion/template/${t.id}`)}
          title="Componer el template master"
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </Button>
        <Button
          size="sm"
          className="flex-1 gap-1.5"
          onClick={() => router.push(`/produccion/template/${t.id}/producir`)}
          title="Administrar adaptaciones y exportar"
        >
          <Rocket className="h-3.5 w-3.5" />
          Producir
        </Button>
      </div>
      {(designs.length > 0 || t.design_id != null) && (
        <select
          value={t.design_id ?? ""}
          onChange={(e) => onAssignDesign(e.target.value ? Number(e.target.value) : null)}
          disabled={assigning}
          className="w-full bg-muted border border-border/50 rounded px-2 py-1 text-[11px] disabled:opacity-50"
          title="Agrupar en un design"
        >
          <option value="">Sin design</option>
          {designs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
