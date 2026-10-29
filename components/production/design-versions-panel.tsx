"use client";

// Versiones del design en el paso Descargar: crear una (congela master,
// orientaciones y adaptaciones), aprobar o pedir cambios, y restaurar. La
// última versión manual es la que nombra los archivos (vN) y la que se
// entrega; si hubo guardados después, se avisa antes de descargar.

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, History, Loader2, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatDateTimeLocal } from "@/lib/utils";
import type { DesignVersionStatus, DesignVersionSummary } from "@/lib/production/design-versions";

export interface VersionsState {
  versions: DesignVersionSummary[];
  latest: DesignVersionSummary | null;
  changed_since_latest: boolean;
}

export const STATUS_LABEL: Record<DesignVersionStatus, string> = {
  en_revision: "En revisión",
  aprobada: "Aprobada",
  con_cambios: "Con cambios",
};
const STATUS_CLASS: Record<DesignVersionStatus, string> = {
  en_revision: "text-amber-300 border-amber-500/40",
  aprobada: "text-emerald-400 border-emerald-500/40",
  con_cambios: "text-red-300 border-red-500/40",
};

export function StatusChip({ status }: { status: DesignVersionStatus }) {
  return <span className={cn("text-[10px] border rounded px-1.5 py-0.5", STATUS_CLASS[status])}>{STATUS_LABEL[status]}</span>;
}

export function DesignVersionsPanel({
  designId,
  state,
  onChange,
  onRestored,
}: {
  designId: number;
  state: VersionsState | null;
  // Se llama con el estado nuevo después de cada operación (el padre lo
  // guarda: los nombres de archivo usan la última versión).
  onChange: (s: VersionsState) => void;
  // Después de restaurar: el padre recarga templates y adaptaciones.
  onRestored: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/production/designs/${designId}/versions`);
    if (res.ok) onChange(await res.json());
  }, [designId, onChange]);

  useEffect(() => {
    if (state == null) void reload();
  }, [state, reload]);

  const create = async () => {
    setBusy("create");
    setError(null);
    try {
      const res = await fetch(`/api/production/designs/${designId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Error ${res.status}`);
      setLabel("");
      setCreating(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const review = async (v: DesignVersionSummary, status: DesignVersionStatus) => {
    setBusy(`review-${v.id}`);
    setError(null);
    try {
      const notes = status === "con_cambios" ? window.prompt("¿Qué hay que cambiar?", v.review_notes ?? "") : null;
      if (status === "con_cambios" && notes === null) return;
      const res = await fetch(`/api/production/designs/${designId}/versions/${v.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, review_notes: notes }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Error ${res.status}`);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (v: DesignVersionSummary) => {
    if (!window.confirm(`¿Volver el master, las orientaciones y las adaptaciones a la v${v.number}? Se guarda un respaldo del estado actual antes.`)) return;
    setBusy(`restore-${v.id}`);
    setError(null);
    try {
      const res = await fetch(`/api/production/designs/${designId}/versions/${v.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Error ${res.status}`);
      await reload();
      onRestored();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const latest = state?.latest ?? null;
  const manual = (state?.versions ?? []).filter((v) => v.kind === "manual");
  const backups = (state?.versions ?? []).filter((v) => v.kind === "pre_restore");

  return (
    <div className="rounded-lg border border-border/50 text-xs">
      <div className="flex items-center gap-3 px-3 py-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <History className="h-3.5 w-3.5 text-violet-400 shrink-0" />
          {state == null ? (
            <span className="text-muted-foreground">Cargando versiones…</span>
          ) : latest ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="font-medium">v{latest.number}</span>
              {latest.label && <span className="truncate text-muted-foreground">{latest.label}</span>}
              <StatusChip status={latest.status} />
              <span className="text-muted-foreground truncate">
                {latest.created_by_name ?? "—"} · {formatDateTimeLocal(latest.created_at)}
              </span>
              {state.changed_since_latest && (
                <span className="text-amber-300">· hay cambios después de la v{latest.number}</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">Sin versiones: crea la v1 cuando el set esté listo para revisar.</span>
          )}
        </button>
        {!creating ? (
          <Button size="sm" variant={latest && !state?.changed_since_latest ? "ghost" : "outline"} onClick={() => setCreating(true)} className="h-7 gap-1 shrink-0">
            <Plus className="h-3.5 w-3.5" />
            Crear v{(latest?.number ?? 0) + 1}
          </Button>
        ) : (
          <form
            className="flex items-center gap-1.5 shrink-0"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Etiqueta (ej: para revisión del cliente)"
              className="bg-muted border border-border/50 rounded-md px-2 py-1 text-xs w-56"
              maxLength={150}
            />
            <Button size="sm" type="submit" disabled={busy === "create"} className="h-7 gap-1">
              {busy === "create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Guardar
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setCreating(false)} className="h-7">
              Cancelar
            </Button>
          </form>
        )}
      </div>
      {error && <p className="px-3 pb-2 text-red-300">{error}</p>}
      {open && state && (
        <ul className="border-t border-border/40 divide-y divide-border/30">
          {manual.length === 0 && <li className="px-3 py-2 text-muted-foreground">Todavía no hay versiones.</li>}
          {manual.map((v) => (
            <li key={v.id} className="px-3 py-2 flex items-start gap-3">
              <span className="font-mono w-8 shrink-0 pt-0.5">v{v.number}</span>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusChip status={v.status} />
                  {v.label && <span className="font-medium">{v.label}</span>}
                  <span className="text-muted-foreground">
                    {v.templates_count} {v.templates_count === 1 ? "master" : "masters"} · {v.adaptations_count} piezas · {v.created_by_name ?? "—"} ·{" "}
                    {formatDateTimeLocal(v.created_at)}
                  </span>
                </div>
                {v.reviewed_at && (
                  <p className="text-muted-foreground">
                    {STATUS_LABEL[v.status]} por {v.reviewed_by_name ?? "—"} · {formatDateTimeLocal(v.reviewed_at)}
                    {v.review_notes ? ` · ${v.review_notes}` : ""}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {v.status !== "aprobada" && (
                  <Button size="sm" variant="ghost" onClick={() => review(v, "aprobada")} disabled={busy != null} className="h-7 gap-1 text-emerald-400">
                    <Check className="h-3.5 w-3.5" /> Aprobar
                  </Button>
                )}
                {v.status !== "con_cambios" && (
                  <Button size="sm" variant="ghost" onClick={() => review(v, "con_cambios")} disabled={busy != null} className="h-7 text-amber-300">
                    Pedir cambios
                  </Button>
                )}
                {v.status !== "en_revision" && (
                  <Button size="sm" variant="ghost" onClick={() => review(v, "en_revision")} disabled={busy != null} className="h-7 text-muted-foreground">
                    A revisión
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => restore(v)} disabled={busy != null} className="h-7 gap-1" title="Vuelve el design a esta versión (guarda un respaldo antes)">
                  {busy === `restore-${v.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  Restaurar
                </Button>
              </div>
            </li>
          ))}
          {backups.length > 0 && (
            <li className="px-3 py-2 text-muted-foreground">
              {backups.length} {backups.length === 1 ? "respaldo automático" : "respaldos automáticos"} (antes de restaurar):{" "}
              {backups.map((b) => (
                <button key={b.id} type="button" onClick={() => restore(b)} disabled={busy != null} className="underline underline-offset-2 mr-2 hover:text-foreground">
                  {b.label} ({formatDateTimeLocal(b.created_at)})
                </button>
              ))}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
