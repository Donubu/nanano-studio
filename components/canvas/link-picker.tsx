"use client";

// "Vincular de otro canvas": pestañas con los Personajes y Escenas, los
// Videos y las Imágenes (generadas o subidas) de los otros canvas del mismo
// proyecto. Se marcan varios (clic, "Todos" por grupo, filtro por nombre) y
// "Vincular N" crea en este canvas un nodo vinculado (solo lectura) por cada
// uno, de una vez. En Imágenes además se ven en grande y se bajan (una o el
// canvas entero en ZIP) sin vincularlas.

import { useEffect, useMemo, useState } from "react";
import { Check, Download, Film, ImageIcon, Link2, Loader2, Maximize2, Search, UserRound, X } from "lucide-react";
import { thumbUrl } from "./lib/thumb";
import { VideoLinkPanel, type VideoLinkGroup } from "./link-videos";

interface LinkableCharacter {
  nodeId: string;
  label: string;
  stageCount: number;
  thumbUrl: string | null;
}

interface LinkableScene {
  nodeId: string;
  label: string;
  sceneIndex: number;
  totalScenes: number;
  scriptLabel: string;
  excerpt: string;
}

interface LinkableImage {
  nodeId: string;
  label: string;
  thumbUrl: string;
}

interface LinkableCanvas {
  conversationId: number;
  title: string;
  characters: LinkableCharacter[];
  scenes: LinkableScene[];
  images?: LinkableImage[];
}

interface LinkPickerProps {
  isOpen: boolean;
  conversationId: number;
  onClose: () => void;
  onLink: (source: { conversationId: number; nodeId: string }) => Promise<void>;
  // Vincular varios de una vez (en el orden de la lista).
  onLinkMany: (refs: { conversationId: number; nodeId: string }[]) => Promise<{ created: number; failed: number }>;
  // Pestaña Videos: vincular varios de una vez (devuelve cuántos creó).
  onLinkVideos: (groups: VideoLinkGroup[]) => Promise<number>;
  alreadyLinked: Set<string>;
}

const keyOf = (convId: number, nodeId: string) => `${convId}|${nodeId}`;

function sceneTitle(sc: LinkableScene): string {
  const n = /^Escena \d+[AB]$/.test(sc.label) ? sc.label.slice(7) : String(sc.sceneIndex);
  const extra = sc.label && !/^Escena \d+[AB]?$/.test(sc.label) ? ` · ${sc.label}` : "";
  return `Escena ${n}/${sc.totalScenes}${extra}`;
}

/** Marca de selección (esquina o costado de cada elemento). */
function Tick({ on, className = "" }: { on: boolean; className?: string }) {
  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
        on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50 bg-background/80"
      } ${className}`}
    >
      {on && <Check className="h-3 w-3" />}
    </span>
  );
}

export function LinkPicker({ isOpen, conversationId, onClose, onLinkMany, onLink, onLinkVideos, alreadyLinked }: LinkPickerProps) {
  const [tab, setTab] = useState<"nodes" | "videos" | "images">("nodes");
  const [preview, setPreview] = useState<{ url: string; label: string; download: string } | null>(null);
  const [canvases, setCanvases] = useState<LinkableCanvas[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isOpen || !conversationId) return;
    setError(null);
    setSelected(new Set());
    setQuery("");
    setLoading(true);
    fetch(`/api/conversations/${conversationId}/canvas/linkables`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => setCanvases(data.canvases || []))
      .catch((err) => {
        console.error("Error loading linkables:", err);
        setError("No se pudieron cargar los canvas del proyecto");
        setCanvases([]);
      })
      .finally(() => setLoading(false));
  }, [isOpen, conversationId]);

  // Filtro por nombre (canvas, Personaje, Escena, Guión o imagen).
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!canvases || !q) return canvases;
    const has = (...xs: (string | undefined)[]) => xs.some((x) => x?.toLowerCase().includes(q));
    return canvases
      .map((c) =>
        has(c.title)
          ? c
          : {
              ...c,
              characters: c.characters.filter((ch) => has(ch.label)),
              scenes: c.scenes.filter((sc) => has(sc.label, sc.scriptLabel, sc.excerpt)),
              images: (c.images ?? []).filter((img) => has(img.label)),
            },
      )
      .filter((c) => c.characters.length + c.scenes.length + (c.images?.length ?? 0) > 0);
  }, [canvases, query]);
  // Solo los canvas con algo que mostrar en la pestaña actual.
  const inTab = useMemo(
    () => visible?.filter((c) => (tab === "images" ? (c.images?.length ?? 0) > 0 : c.characters.length + c.scenes.length > 0)) ?? null,
    [visible, tab],
  );
  const hasAny = useMemo(
    () => (canvases ?? []).some((c) => (tab === "images" ? (c.images?.length ?? 0) > 0 : c.characters.length + c.scenes.length > 0)),
    [canvases, tab],
  );

  if (!isOpen) return null;

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // "Todos" de un grupo: marca los que no están vinculados todavía; si ya
  // están todos marcados, los desmarca.
  const toggleGroup = (keys: string[]) => {
    const pending = keys.filter((k) => !alreadyLinked.has(k));
    const target = pending.length ? pending : keys;
    const allOn = target.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of target) {
        if (allOn) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  };

  const handleLinkSelected = async () => {
    if (linking || selected.size === 0 || !canvases) return;
    // En el orden de la lista (canvas, Personajes, Escenas, imágenes).
    const refs = canvases.flatMap((c) =>
      [...c.characters.map((x) => x.nodeId), ...c.scenes.map((x) => x.nodeId), ...(c.images ?? []).map((x) => x.nodeId)]
        .filter((nodeId) => selected.has(keyOf(c.conversationId, nodeId)))
        .map((nodeId) => ({ conversationId: c.conversationId, nodeId })),
    );
    setLinking(true);
    setError(null);
    try {
      const { created, failed } = await onLinkMany(refs);
      if (failed > 0) {
        setError(
          `${created} vinculado${created === 1 ? "" : "s"}; ${failed} no se pudo${failed === 1 ? "" : "ieron"} vincular (borrado${failed === 1 ? "" : "s"} o sin acceso).`,
        );
        setSelected(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo vincular");
    } finally {
      setLinking(false);
    }
  };

  const linkedTag = (key: string) =>
    alreadyLinked.has(key) ? (
      <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">ya vinculado</span>
    ) : null;

  const groupHeader = (label: string, keys: string[]) => {
    const pending = keys.filter((k) => !alreadyLinked.has(k));
    const target = pending.length ? pending : keys;
    const allOn = target.length > 0 && target.every((k) => selected.has(k));
    return (
      <div className="mt-2 mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground truncate">{label}</span>
        {keys.length > 1 && (
          <button
            type="button"
            onClick={() => toggleGroup(keys)}
            className="shrink-0 text-[11px] font-medium text-primary hover:underline"
          >
            {allOn ? "Quitar" : `Todos (${target.length})`}
          </button>
        )}
      </div>
    );
  };

  const imagesBase = `/api/conversations/${conversationId}/canvas/linkables/images`;
  // Descarga por el servidor en otra pestaña (nombre numerado; si falla, el canvas no se pierde).
  const download = (href: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const rowClass = (on: boolean) =>
    `w-full flex items-center gap-3 border rounded-lg p-2 text-left transition-colors disabled:opacity-60 ${
      on ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/50"
    }`;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-popover border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col m-4">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Vincular de otro canvas</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-border px-3 pt-2">
          {([
            ["nodes", "Personajes y escenas"],
            ["videos", "Videos"],
            ["images", "Imágenes"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-2 pb-1.5 text-xs font-medium ${tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "videos" ? (
          <div className="flex-1 overflow-y-auto p-3">
            <VideoLinkPanel conversationId={conversationId} alreadyLinked={alreadyLinked} onLinkOne={onLink} onLinkMany={onLinkVideos} />
          </div>
        ) : (
        <>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            {tab === "images"
              ? "Todas las imágenes de los otros canvas. Marca las que quieras traer y vincúlalas (no se editan aquí: siguen al original), o míralas en grande y bájalas sin vincular."
              : "Marca los que quieras traer y vincúlalos juntos. El nodo vinculado no se edita aquí: sigue al original y se actualiza al abrir el canvas y antes de ejecutar."}
          </p>
          {hasAny && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tab === "images" ? "Filtrar por nombre o canvas..." : "Filtrar por nombre, canvas o guion..."}
                className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary/50"
              />
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {tab === "images" ? "Cargando las imágenes..." : "Cargando personajes y escenas..."}
            </div>
          ) : canvases && !hasAny ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              {tab === "images" ? <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-40" /> : <UserRound className="h-8 w-8 mx-auto mb-2 opacity-40" />}
              {tab === "images" ? "No hay imágenes en otros canvas de este proyecto." : "No hay Personajes ni Escenas en otros canvas de este proyecto."}
            </div>
          ) : inTab && inTab.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">Nada coincide con el filtro.</div>
          ) : (
            inTab?.map((c) => {
              const scripts = new Map<string, LinkableScene[]>();
              for (const sc of c.scenes) scripts.set(sc.scriptLabel, [...(scripts.get(sc.scriptLabel) ?? []), sc]);
              return (
              <div key={c.conversationId} className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground truncate">{c.title}</div>
                {tab === "nodes" && c.characters.length > 0 && groupHeader("Personajes", c.characters.map((ch) => keyOf(c.conversationId, ch.nodeId)))}
                {tab === "nodes" && c.characters.map((ch) => {
                  const key = keyOf(c.conversationId, ch.nodeId);
                  const on = selected.has(key);
                  return (
                    <button key={key} type="button" disabled={linking} onClick={() => toggle(key)} className={rowClass(on)}>
                      <Tick on={on} />
                      {ch.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbUrl(ch.thumbUrl, 128)} alt="" className="h-10 w-10 rounded object-cover shrink-0" loading="lazy" />
                      ) : (
                        <div className="h-10 w-10 rounded bg-pink-400/10 flex items-center justify-center shrink-0">
                          <UserRound className="h-5 w-5 text-pink-400" />
                        </div>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate">{ch.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {ch.stageCount} {ch.stageCount === 1 ? "etapa" : "etapas"}
                        </span>
                      </span>
                      {linkedTag(key)}
                    </button>
                  );
                })}
                {/* Escenas, agrupadas por Guión. */}
                {tab === "nodes" && [...scripts.entries()].map(([scriptLabel, scenes]) => (
                  <div key={scriptLabel} className="space-y-1">
                    {groupHeader(scriptLabel, scenes.map((sc) => keyOf(c.conversationId, sc.nodeId)))}
                    {scenes.map((sc) => {
                      const key = keyOf(c.conversationId, sc.nodeId);
                      const on = selected.has(key);
                      return (
                        <button key={key} type="button" disabled={linking} onClick={() => toggle(key)} className={rowClass(on)}>
                          <Tick on={on} />
                          <div className="h-10 w-10 rounded bg-violet-400/10 flex items-center justify-center shrink-0">
                            <Film className="h-5 w-5 text-violet-400" />
                          </div>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium truncate">{sceneTitle(sc)}</span>
                            <span className="block text-xs text-muted-foreground truncate">{sc.excerpt}</span>
                          </span>
                          {linkedTag(key)}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {/* Imágenes (generadas o subidas): catálogo en miniatura. */}
                {tab === "images" && (c.images?.length ?? 0) > 0 && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {groupHeader(`${c.images!.length} ${c.images!.length === 1 ? "imagen" : "imágenes"}`, c.images!.map((img) => keyOf(c.conversationId, img.nodeId)))}
                      </div>
                      <button
                        type="button"
                        onClick={() => download(`${imagesBase}?conv=${c.conversationId}`)}
                        className="mt-2 mb-1 inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                        title="Un ZIP con todas las imágenes de este canvas, numeradas en orden"
                      >
                        <Download className="h-3 w-3" />
                        Bajar todas (ZIP)
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {c.images!.map((img) => {
                        const key = keyOf(c.conversationId, img.nodeId);
                        const on = selected.has(key);
                        const fileUrl = `${imagesBase}?conv=${c.conversationId}&node=${encodeURIComponent(img.nodeId)}`;
                        return (
                          <div
                            key={key}
                            role="button"
                            tabIndex={0}
                            aria-pressed={on}
                            onClick={() => !linking && toggle(key)}
                            onKeyDown={(e) => {
                              if ((e.key === "Enter" || e.key === " ") && !linking) {
                                e.preventDefault();
                                toggle(key);
                              }
                            }}
                            title={alreadyLinked.has(key) ? `${img.label} (ya vinculada)` : img.label}
                            className={`group relative aspect-square cursor-pointer overflow-hidden rounded-md border transition ${
                              on ? "border-primary ring-2 ring-primary/50" : "border-border hover:border-primary/60"
                            } ${linking ? "opacity-60" : ""}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={thumbUrl(img.thumbUrl, 256)} alt={img.label} className="h-full w-full object-cover" loading="lazy" />
                            <Tick on={on} className="absolute left-1 top-1" />
                            {alreadyLinked.has(key) && (
                              <Link2 className="absolute right-1 top-1 h-3.5 w-3.5 rounded bg-black/55 p-0.5 text-white" />
                            )}
                            <div className="absolute right-1 bottom-5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                type="button"
                                title="Ver grande"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreview({ url: img.thumbUrl, label: `${c.title} · ${img.label}`, download: fileUrl });
                                }}
                                className="rounded bg-black/60 p-1 text-white hover:bg-black/80"
                              >
                                <Maximize2 className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                title="Descargar"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  download(fileUrl);
                                }}
                                className="rounded bg-black/60 p-1 text-white hover:bg-black/80"
                              >
                                <Download className="h-3 w-3" />
                              </button>
                            </div>
                            <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 text-[10px] text-white">{img.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
              );
            })
          )}
        </div>
        <div className="border-t border-border p-3 space-y-2">
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs text-muted-foreground">
              {selected.size === 0 ? "Nada seleccionado" : `${selected.size} seleccionado${selected.size === 1 ? "" : "s"}`}
            </span>
            {selected.size > 0 && (
              <button
                type="button"
                disabled={linking}
                onClick={() => setSelected(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                Limpiar
              </button>
            )}
            <button
              type="button"
              disabled={linking || selected.size === 0}
              onClick={handleLinkSelected}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              {selected.size > 0 ? `Vincular ${selected.size}` : "Vincular"}
            </button>
          </div>
        </div>
        </>
        )}
        {preview && (
          <div className="absolute inset-0 z-10 flex flex-col rounded-xl bg-black/90" onClick={() => setPreview(null)}>
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-white" onClick={(e) => e.stopPropagation()}>
              <span className="min-w-0 flex-1 truncate">{preview.label}</span>
              <button type="button" title="Descargar" onClick={() => download(preview.download)} className="rounded p-1.5 hover:bg-white/10">
                <Download className="h-4 w-4" />
              </button>
              <button type="button" title="Cerrar" onClick={() => setPreview(null)} className="rounded p-1.5 hover:bg-white/10">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.url} alt={preview.label} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
