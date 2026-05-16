"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, FileImage, Trash2 } from "lucide-react";
import { formatDateLocal } from "@/lib/utils";

interface ProductionProject {
  id: number;
  client_id: number;
  title: string;
  description: string | null;
  status: "active" | "paused" | "completed" | "archived";
  hidden: number;
  created_at: string;
  updated_at: string;
  template_count: number;
}

interface Props {
  clientId: number;
}

export default function ClientProductionSection({ clientId }: Props) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProductionProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/production/projects?client_id=${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (err) {
      console.error("Error obteniendo proyectos de producción:", err);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/production/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          title: newTitle.trim(),
          description: newDescription.trim() || null,
        }),
      });
      if (res.ok) {
        setNewTitle("");
        setNewDescription("");
        setShowForm(false);
        fetchProjects();
      }
    } catch (err) {
      console.error("Error creando proyecto de producción:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar este proyecto de producción?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/production/projects/${id}`, { method: "DELETE" });
      if (res.ok) fetchProjects();
    } catch (err) {
      console.error("Error eliminando proyecto:", err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium">Proyectos de producción</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Templates master con adaptaciones para producir banners en lote
          </p>
        </div>
        {!showForm && (
          <Button size="sm" onClick={() => setShowForm(true)} className="gap-1">
            <Plus className="h-4 w-4" /> Nuevo
          </Button>
        )}
      </div>

      {showForm && (
        <div className="mb-4 space-y-2 border border-border/50 rounded-lg p-3">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nombre del proyecto"
            className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
            autoFocus
          />
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Descripción (opcional)"
            rows={2}
            className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-2 justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                setNewTitle("");
                setNewDescription("");
              }}
              disabled={creating}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!newTitle.trim() || creating}
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
      ) : projects.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          Aún no hay proyectos de producción para este cliente
        </p>
      ) : (
        <div className="space-y-2">
          {projects.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/produccion/proyecto/${p.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/produccion/proyecto/${p.id}`);
                }
              }}
              className="flex items-center justify-between bg-muted/50 hover:bg-muted rounded-lg px-3 py-2 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0">
                  <FileImage className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-none truncate">{p.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {p.template_count} {p.template_count === 1 ? "template" : "templates"}
                    {" · "}actualizado {formatDateLocal(p.updated_at)}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-red-500/10"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(p.id);
                }}
                disabled={deletingId === p.id}
              >
                {deletingId === p.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
