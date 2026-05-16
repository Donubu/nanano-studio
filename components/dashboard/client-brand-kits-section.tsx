"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Palette, Trash2, Star } from "lucide-react";
import {
  BrandKit,
  EMPTY_KIT_CONTENT,
  brandKitFromApi,
} from "@/lib/production/brand-kit";
import { BrandKitEditor } from "./brand-kit-editor";

interface Props {
  clientId: number;
}

export default function ClientBrandKitsSection({ clientId }: Props) {
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  const fetchKits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/production/brand-kits?client_id=${clientId}`);
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
  }, [clientId]);

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
    if (!confirm("¿Eliminar este brand kit? Los templates que lo usen perderán las referencias.")) return;
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

  return (
    <div className="bg-card rounded-xl border border-border/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium">Brand Kits</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tokens de diseño (colores, tipografías, logos, spacing) que los templates pueden referenciar
          </p>
        </div>
        {!showCreateForm && (
          <Button size="sm" onClick={() => setShowCreateForm(true)} className="gap-1">
            <Plus className="h-4 w-4" /> Nuevo
          </Button>
        )}
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
            const isExpanded = editingId === k.id;
            const c = k.content ?? EMPTY_KIT_CONTENT;
            const counts = `${c.colors.length} colores · ${c.fonts.length} fonts · ${c.scales.length} escalas · ${c.spacing.length} spacing · ${c.logos.length} logos`;
            return (
              <div key={k.id}>
                <div className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(isExpanded ? null : k.id)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0">
                      <Palette className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-none truncate flex items-center gap-1.5">
                        {k.name}
                        {k.is_default && (
                          <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{counts}</p>
                    </div>
                  </button>
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
