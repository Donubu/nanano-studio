"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandKit, brandKitFromApi } from "@/lib/production/brand-kit";
import { BrandKitEditor } from "@/components/dashboard/brand-kit-editor";

interface Props {
  clientId: number;
  projectId: number;
  existingKits: BrandKit[];
  onClose: () => void;
  onChanged: () => void;
}

// Modal that lets the user add or edit a brand kit scoped to the current
// production project. The kit is created on first open if none exists.
export function ProjectBrandKitModal({
  clientId,
  projectId,
  existingKits,
  onClose,
  onChanged,
}: Props) {
  const projectKit = existingKits.find((k) => k.production_project_id === projectId);
  const [kit, setKit] = useState<BrandKit | null>(projectKit ?? null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If there is no project-scoped kit yet, create one with a sensible default
  // name as soon as the modal opens. Avoids forcing the user to choose a name
  // before they even start editing tokens.
  const ensureProjectKit = useCallback(async () => {
    if (kit) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/production/brand-kits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          production_project_id: projectId,
          name: "Tokens del proyecto",
          colors_json: { tokens: [] },
          typography_json: { fonts: [], scales: [] },
          logos_json: { logos: [] },
          spacing_json: { tokens: [] },
        }),
      });
      if (!res.ok) {
        setError("No se pudo crear el brand kit del proyecto");
        return;
      }
      const created = await res.json();
      // Reload via GET to get the full row consistent with the editor's shape
      const listRes = await fetch(
        `/api/production/brand-kits?client_id=${clientId}&production_project_id=${projectId}`
      );
      if (listRes.ok) {
        const rows: unknown[] = await listRes.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsed = rows.map((r: any) => brandKitFromApi(r));
        const fresh = parsed.find((k) => k.id === created.id) ?? null;
        setKit(fresh);
      }
      onChanged();
    } catch (err) {
      console.error("Error creando brand kit del proyecto:", err);
      setError("Error inesperado");
    } finally {
      setCreating(false);
    }
  }, [clientId, projectId, kit, onChanged]);

  useEffect(() => {
    if (!kit && !creating) ensureProjectKit();
  }, [kit, creating, ensureProjectKit]);

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border/50 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
          <div>
            <h2 className="text-sm font-semibold">Brand kit del proyecto</h2>
            <p className="text-xs text-muted-foreground">
              Estos tokens son visibles únicamente en este proyecto y se cargan
              encima de los tokens del cliente.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <p className="text-xs text-red-400 mb-3">{error}</p>
          )}
          {creating || !kit ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <BrandKitEditor
              kit={kit}
              onCancel={onClose}
              onSaved={(content, name, isDefault) => {
                setKit({ ...kit, content, name, is_default: isDefault });
                onChanged();
                onClose();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
