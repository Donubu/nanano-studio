"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, BookmarkPlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SaveTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: number;
  nodeCount: number;
}

// Modal para guardar el canvas actual como template global. El snapshot lo
// toma el server desde la BD (nodos vivos), así que acá solo va nombre y
// descripción.
export function SaveTemplateModal({ isOpen, onClose, conversationId, nodeCount }: SaveTemplateModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setDescription("");
      setSaved(false);
      setError(null);
      // Focus tras el render del modal.
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/canvas-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          conversation_id: conversationId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setSaved(true);
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar el template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-popover border border-border rounded-xl shadow-2xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BookmarkPlus className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Guardar como template</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {saved ? (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-green-500">
            <Check className="h-4 w-4" />
            Template guardado
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground mb-4">
              Se guardará una copia de los {nodeCount} nodos actuales y sus conexiones.
              El template es global: cualquier usuario podrá usarlo al crear un canvas nuevo.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Nombre *</label>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                  maxLength={255}
                  placeholder="Ej: Guión → escenas → video"
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Descripción</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Para qué sirve este flow (opcional)"
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
              </div>
            </div>

            {error && <p className="text-xs text-red-500 mt-3">{error}</p>}

            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!name.trim() || saving} className="gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
                Guardar template
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
