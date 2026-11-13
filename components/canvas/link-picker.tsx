"use client";

// "Vincular de otro canvas": lista los Personajes, las Escenas y las imágenes
// (generadas o subidas) de los otros canvas del mismo proyecto. Elegir uno crea en este canvas un nodo vinculado
// (solo lectura) que sigue al original.

import { useEffect, useState } from "react";
import { Film, Link2, Loader2, UserRound, X } from "lucide-react";
import { thumbUrl } from "./lib/thumb";

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
}

export function LinkPicker({ isOpen, conversationId, onClose, onLink }: LinkPickerProps) {
  const [canvases, setCanvases] = useState<LinkableCanvas[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !conversationId) return;
    setError(null);
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

  if (!isOpen) return null;

  const handleLink = async (convId: number, nodeId: string) => {
    if (linking) return;
    setLinking(`${convId}|${nodeId}`);
    setError(null);
    try {
      await onLink({ conversationId: convId, nodeId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo vincular");
    } finally {
      setLinking(null);
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-popover border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[70vh] flex flex-col m-4">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Vincular de otro canvas</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            El nodo vinculado no se edita aquí: sigue al original y se actualiza al abrir el canvas y antes de ejecutar.
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando personajes, escenas e imágenes...
            </div>
          ) : canvases && canvases.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              <UserRound className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No hay Personajes, Escenas ni imágenes en otros canvas de este proyecto.
            </div>
          ) : (
            canvases?.map((c) => (
              <div key={c.conversationId} className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground truncate">{c.title}</div>
                {c.characters.map((ch) => {
                  const key = `${c.conversationId}|${ch.nodeId}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!!linking}
                      onClick={() => handleLink(c.conversationId, ch.nodeId)}
                      className="w-full flex items-center gap-3 border border-border rounded-lg p-2 text-left hover:border-primary/50 hover:bg-accent/50 transition-colors disabled:opacity-60"
                    >
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
                      {linking === key && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    </button>
                  );
                })}
                {/* Escenas, agrupadas por Guión. */}
                {c.scenes.map((sc, i) => {
                  const key = `${c.conversationId}|${sc.nodeId}`;
                  const newScript = i === 0 || c.scenes[i - 1].scriptLabel !== sc.scriptLabel;
                  return (
                    <div key={key}>
                      {newScript && <div className="mt-2 mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">{sc.scriptLabel}</div>}
                      <button
                        type="button"
                        disabled={!!linking}
                        onClick={() => handleLink(c.conversationId, sc.nodeId)}
                        className="w-full flex items-center gap-3 border border-border rounded-lg p-2 text-left hover:border-primary/50 hover:bg-accent/50 transition-colors disabled:opacity-60"
                      >
                        <div className="h-10 w-10 rounded bg-violet-400/10 flex items-center justify-center shrink-0">
                          <Film className="h-5 w-5 text-violet-400" />
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium truncate">
                            Escena {/^Escena \d+[AB]$/.test(sc.label) ? sc.label.slice(7) : sc.sceneIndex}/{sc.totalScenes}
                            {sc.label && !/^Escena \d+[AB]?$/.test(sc.label) ? ` · ${sc.label}` : ""}
                          </span>
                          <span className="block text-xs text-muted-foreground truncate">{sc.excerpt}</span>
                        </span>
                        {linking === key && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      </button>
                    </div>
                  );
                })}
                {/* Imágenes (generadas o subidas), como miniaturas. */}
                {(c.images?.length ?? 0) > 0 && (
                  <>
                    <div className="mt-2 mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">Imágenes</div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {c.images!.map((img) => {
                        const key = `${c.conversationId}|${img.nodeId}`;
                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={!!linking}
                            onClick={() => handleLink(c.conversationId, img.nodeId)}
                            title={`${img.label}: vincular esta imagen`}
                            className="relative aspect-square overflow-hidden rounded-md border border-border hover:border-primary/60 hover:ring-2 hover:ring-primary/30 transition disabled:opacity-60"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={thumbUrl(img.thumbUrl, 256)} alt={img.label} className="h-full w-full object-cover" loading="lazy" />
                            <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 text-[10px] text-white">{img.label}</span>
                            {linking === key && (
                              <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                                <Loader2 className="h-4 w-4 animate-spin text-white" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
