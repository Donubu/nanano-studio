"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Palette, Trash2, Star, RotateCcw } from "lucide-react";
import {
  BrandKit,
  EMPTY_KIT_CONTENT,
  brandKitFromApi,
} from "@/lib/production/brand-kit";
import { BrandKitEditor } from "./brand-kit-editor";
import { cn, formatDateLocal } from "@/lib/utils";

interface Props {
  clientId: number;
}

export default function ClientBrandKitsSection({ clientId }: Props) {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  // Toggle "Mostrar eliminados". Cuando está en true, fetcheamos con
  // include_deleted=true así el admin ve los kits soft-deleted y puede
  // reactivarlos. Por default off — la vista normal solo muestra activos.
  const [showDeleted, setShowDeleted] = useState(false);

  const fetchKits = useCallback(async () => {
    setLoading(true);
    try {
      const qs = showDeleted ? "&include_deleted=true" : "";
      const res = await fetch(
        `/api/production/brand-kits?client_id=${clientId}${qs}`,
      );
      if (res.ok) {
        const rows: unknown[] = await res.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setKits(rows.map((r: any) => brandKitFromApi(r)));
      }
    } catch (err) {
      console.error("Error listando brand kits:", err);
    } finally {
      setLoading(false);
    }
  }, [clientId, showDeleted]);

  useEffect(() => {
    fetchKits();
  }, [fetchKits]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/production/brand-kits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          name: newName.trim(),
          colors_json: { tokens: [] },
          typography_json: { fonts: [], scales: [] },
          logos_json: { logos: [] },
          spacing_json: { tokens: [] },
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setNewName("");
        setShowCreateForm(false);
        await fetchKits();
        setEditingId(created.id);
      }
    } catch (err) {
      console.error("Error creando brand kit:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (
      !confirm(
        "¿Eliminar este brand kit? Queda como eliminado y se puede reactivar después desde la sección 'Mostrar eliminados'.",
      )
    )
      return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/production/brand-kits/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchKits();
        if (editingId === id) setEditingId(null);
      }
    } catch (err) {
      console.error("Error eliminando brand kit:", err);
    } finally {
      setDeletingId(null);
    }
  };

  // Reactiva un brand kit soft-deleted: PUT con restore=true vuelve deleted_at
  // a NULL. Los templates que tenían brand_kit_id apuntando a este lo
  // recuperan automáticamente (el FK no se rompió porque el delete era soft).
  const handleRestore = async (id: number) => {
    setRestoringId(id);
    try {
      const res = await fetch(`/api/production/brand-kits/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore: true }),
      });
      if (res.ok) {
        await fetchKits();
      }
    } catch (err) {
      console.error("Error reactivando brand kit:", err);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium">Brand Kits</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tokens de diseño (colores, tipografías, logos, spacing) que los templates pueden referenciar
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label
            className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer"
            title="Muestra también los brand kits soft-deleted para poder reactivarlos"
          >
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => setShowDeleted(e.target.checked)}
            />
            Mostrar eliminados
          </label>
          {!showCreateForm && (
            <Button size="sm" onClick={() => setShowCreateForm(true)} className="gap-1">
              <Plus className="h-4 w-4" /> Nuevo
            </Button>
          )}
        </div>
      </div>

      {showCreateForm && (
        <div className="mb-4 flex items-center gap-2 border border-border/50 rounded-lg p-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nombre del brand kit"
            className="flex-1 bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
            autoFocus
          />
          <Button variant="ghost" size="sm" onClick={() => { setShowCreateForm(false); setNewName(""); }} disabled={creating}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || creating} className="gap-1">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Crear
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : kits.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">Aún no hay brand kits para este cliente</p>
      ) : (
        <div className="space-y-3">
          {kits.map((k) => {
            const isDeleted = !!k.deleted_at;
            const isExpanded = !isDeleted && editingId === k.id;
            const c = k.content ?? EMPTY_KIT_CONTENT;
            const counts = `${c.colors.length} colores · ${c.fonts.length} fonts · ${c.scales.length} escalas · ${c.spacing.length} spacing · ${c.logos.length} logos`;
            return (
              <div key={k.id}>
                <div
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2",
                    isDeleted
                      ? "bg-muted/20 border border-dashed border-border/50"
                      : "bg-muted/50",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (isDeleted) return;
                      setEditingId(isExpanded ? null : k.id);
                    }}
                    disabled={isDeleted}
                    className={cn(
                      "flex items-center gap-3 min-w-0 flex-1 text-left",
                      isDeleted && "opacity-60 cursor-default",
                    )}
                  >
                    <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0">
                      <Palette className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-none truncate flex items-center gap-1.5">
                        {k.name}
                        {k.is_default && !isDeleted && (
                          <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        )}
                        {isDeleted && (
                          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30">
                            Eliminado
                          </span>
                        )}
                        {k.production_project_id != null && (
                          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            proyecto
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {counts}
                        {isDeleted && k.deleted_at && (
                          <> · eliminado {formatDateLocal(k.deleted_at)}</>
                        )}
                      </p>
                    </div>
                  </button>
                  {isDeleted ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-emerald-400 hover:bg-emerald-500/10"
                      onClick={() => handleRestore(k.id)}
                      disabled={restoringId === k.id}
                      title="Reactivar este brand kit"
                    >
                      {restoringId === k.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      Reactivar
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:bg-red-500/10"
                      onClick={() => handleDelete(k.id)}
                      disabled={deletingId === k.id}
                    >
                      {deletingId === k.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5 text-red-400" />
                      )}
                    </Button>
                  )}
                </div>
                {isExpanded && (
                  <div className="mt-2">
                    <BrandKitEditor
                      kit={k}
                      onCancel={() => setEditingId(null)}
                      onSaved={(updatedContent, updatedName, updatedDefault) => {
                        setKits((prev) =>
                          prev.map((x) =>
                            x.id === k.id
                              ? { ...x, name: updatedName, is_default: updatedDefault, content: updatedContent }
                              : updatedDefault ? { ...x, is_default: false } : x
                          )
                        );
                        setEditingId(null);
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
