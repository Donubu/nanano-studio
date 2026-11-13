"use client";

// Pestaña "Videos" de "Vincular de otro canvas": los videos finales de cada
// escena de los otros canvas (en orden) y los demás videos. "Traer videos del
// guion" vincula de una vez los de los canvas marcados y los ordena como una
// línea de tiempo (una fila por canvas, una columna por escena).

import { useEffect, useMemo, useState } from "react";
import { Check, Film, Loader2, Video } from "lucide-react";

export interface LinkableVideo {
  nodeId: string;
  label: string;
  videoUrl: string | null;
  sceneIndex?: number;
  variant?: "A" | "B";
  scriptLabel?: string;
}

export interface VideoCanvas {
  conversationId: number;
  title: string;
  sceneVideos: LinkableVideo[];
  otherVideos: LinkableVideo[];
}

export interface VideoLinkGroup {
  conversationId: number;
  title: string;
  nodeIds: string[];
}

export function VideoLinkPanel({
  conversationId,
  alreadyLinked,
  onLinkOne,
  onLinkMany,
}: {
  conversationId: number;
  // "conv|nodo" ya vinculados en este canvas.
  alreadyLinked: Set<string>;
  onLinkOne: (source: { conversationId: number; nodeId: string }) => Promise<void>;
  onLinkMany: (groups: VideoLinkGroup[]) => Promise<number>;
}) {
  const [canvases, setCanvases] = useState<VideoCanvas[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/conversations/${conversationId}/canvas/links/videos`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (cancelled) return;
        const list = (data.canvases || []) as VideoCanvas[];
        setCanvases(list);
        // Por defecto, todos los canvas con escenas.
        setSelected(new Set(list.filter((c) => c.sceneVideos.length > 0).map((c) => c.conversationId)));
      })
      .catch((err) => {
        console.error("Error loading videos:", err);
        if (!cancelled) {
          setError("No se pudieron cargar los videos del proyecto");
          setCanvases([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const withScenes = useMemo(() => (canvases ?? []).filter((c) => c.sceneVideos.length > 0), [canvases]);
  const pending = (c: VideoCanvas) => c.sceneVideos.filter((v) => !alreadyLinked.has(`${c.conversationId}|${v.nodeId}`));
  const toBring = withScenes.filter((c) => selected.has(c.conversationId)).reduce((s, c) => s + pending(c).length, 0);

  const bringAll = async () => {
    if (busy || toBring === 0) return;
    setBusy("all");
    setError(null);
    setDone(null);
    try {
      const groups = withScenes
        .filter((c) => selected.has(c.conversationId))
        .map((c) => ({ conversationId: c.conversationId, title: c.title, nodeIds: pending(c).map((v) => v.nodeId) }))
        .filter((g) => g.nodeIds.length > 0);
      const n = await onLinkMany(groups);
      setDone(`${n} ${n === 1 ? "video vinculado" : "videos vinculados"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron vincular");
    } finally {
      setBusy(null);
    }
  };

  const linkOne = async (convId: number, nodeId: string) => {
    if (busy) return;
    setBusy(`${convId}|${nodeId}`);
    setError(null);
    try {
      await onLinkOne({ conversationId: convId, nodeId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo vincular");
    } finally {
      setBusy(null);
    }
  };

  if (!canvases) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Buscando los videos de los otros canvas...
      </div>
    );
  }
  if (canvases.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-muted-foreground">
        <Video className="h-8 w-8 mx-auto mb-2 opacity-40" />
        {error ?? "No hay videos en otros canvas de este proyecto."}
      </div>
    );
  }

  const row = (c: VideoCanvas, v: LinkableVideo) => {
    const key = `${c.conversationId}|${v.nodeId}`;
    const linked = alreadyLinked.has(key);
    return (
      <button
        key={key}
        type="button"
        disabled={!!busy || linked}
        onClick={() => linkOne(c.conversationId, v.nodeId)}
        title={linked ? "Ya está vinculado en este canvas" : "Vincular este video"}
        className="flex w-full items-center gap-2 rounded-md border border-border px-2 py-1 text-left text-sm hover:border-primary/50 hover:bg-accent/50 disabled:opacity-60"
      >
        <Film className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 truncate">
          {v.label}
          {v.scriptLabel && c.sceneVideos.some((o) => o.scriptLabel !== v.scriptLabel) ? (
            <span className="text-muted-foreground"> · {v.scriptLabel}</span>
          ) : null}
        </span>
        {!v.videoUrl && <span className="shrink-0 text-xs text-amber-600 dark:text-amber-300">sin video aún</span>}
        {linked && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
        {busy === key && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {withScenes.length > 0 && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="text-sm font-semibold">Traer videos del guion</div>
          <p className="text-xs text-muted-foreground">
            Vincula el video final de cada escena de los canvas marcados, en orden: una fila por canvas y una columna por escena
            (la versión B junto a su A). Los que ya están vinculados aquí no se repiten.
          </p>
          <div className="space-y-1">
            {withScenes.map((c) => {
              const missing = c.sceneVideos.filter((v) => !v.videoUrl).length;
              const left = pending(c).length;
              return (
                <label key={c.conversationId} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(c.conversationId)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.conversationId);
                        else next.delete(c.conversationId);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {c.sceneVideos.length} {c.sceneVideos.length === 1 ? "escena" : "escenas"}
                    {missing > 0 ? `, ${missing} sin video aún` : ""}
                    {left < c.sceneVideos.length ? `, ${c.sceneVideos.length - left} ya vinculadas` : ""}
                  </span>
                </label>
              );
            })}
          </div>
          <button
            type="button"
            onClick={bringAll}
            disabled={!!busy || toBring === 0}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === "all" && <Loader2 className="h-4 w-4 animate-spin" />}
            {toBring === 0 ? "Nada nuevo que traer" : `Traer ${toBring} ${toBring === 1 ? "video" : "videos"}`}
          </button>
          {done && <p className="text-xs text-emerald-600 dark:text-emerald-400">{done}</p>}
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {canvases.map((c) => (
        <div key={c.conversationId} className="space-y-1">
          <div className="truncate text-xs font-semibold text-muted-foreground">{c.title}</div>
          {c.sceneVideos.map((v) => row(c, v))}
          {c.otherVideos.length > 0 && (
            <>
              <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">Otros videos</div>
              {c.otherVideos.map((v) => row(c, v))}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
