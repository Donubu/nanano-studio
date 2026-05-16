"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ClientImage {
  source: "generation" | "upload";
  id: number;
  url: string;
  created_at: string;
  project_id: number;
  project_title: string;
  conversation_title: string | null;
}

interface Props {
  clientId: number;
  onClose: () => void;
  onPick: (image: ClientImage) => void;
}

const PAGE_SIZE = 60;

export function ClientImagePicker({ clientId, onClose, onPick }: Props) {
  const [items, setItems] = useState<ClientImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const fetchTokenRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const loadPage = useCallback(
    async (offset: number, q: string, replace: boolean) => {
      const token = ++fetchTokenRef.current;
      if (replace) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });
        if (q) params.set("q", q);
        const res = await fetch(`/api/clients/${clientId}/images?${params}`);
        if (!res.ok) {
          if (fetchTokenRef.current === token) {
            setError("No se pudieron cargar las imágenes");
            if (replace) setItems([]);
          }
          return;
        }
        const data = (await res.json()) as {
          items: ClientImage[];
          pagination: { hasMore: boolean };
        };
        if (fetchTokenRef.current !== token) return;
        setHasMore(Boolean(data.pagination?.hasMore));
        setItems((prev) => (replace ? data.items : [...prev, ...data.items]));
      } catch (err) {
        console.error("ClientImagePicker fetch error:", err);
        if (fetchTokenRef.current === token) {
          setError("Error inesperado al cargar imágenes");
          if (replace) setItems([]);
        }
      } finally {
        if (fetchTokenRef.current === token) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [clientId]
  );

  useEffect(() => {
    loadPage(0, debouncedQuery, true);
  }, [debouncedQuery, loadPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border/50 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
          <div>
            <h2 className="text-sm font-semibold">Galería del cliente</h2>
            <p className="text-xs text-muted-foreground">
              Imágenes generadas y subidas en los proyectos del cliente.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-5 py-3 border-b border-border/50">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por proyecto, conversación o archivo…"
              autoFocus
              className="w-full bg-muted border border-border/50 rounded pl-7 pr-2 py-1.5 text-xs"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-10">
              {debouncedQuery
                ? "Sin resultados para esta búsqueda."
                : "No hay imágenes disponibles para este cliente."}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {items.map((img) => (
                  <ImageThumb
                    key={`${img.source}-${img.id}`}
                    image={img}
                    onPick={() => {
                      onPick(img);
                      onClose();
                    }}
                  />
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loadingMore}
                    onClick={() => loadPage(items.length, debouncedQuery, false)}
                  >
                    {loadingMore ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : null}
                    Cargar más
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ImageThumb({
  image,
  onPick,
}: {
  image: ClientImage;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "group relative aspect-square overflow-hidden rounded border bg-muted",
        "border-border/50 hover:border-primary focus:border-primary focus:outline-none"
      )}
      title={
        image.source === "generation"
          ? `${image.project_title}${image.conversation_title ? " · " + image.conversation_title : ""}`
          : `${image.project_title} · subida`
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt=""
        loading="lazy"
        className="w-full h-full object-cover"
      />
      <span
        className={cn(
          "absolute top-1 left-1 text-[9px] uppercase tracking-wider px-1 py-0.5 rounded",
          image.source === "generation"
            ? "bg-blue-500/80 text-white"
            : "bg-emerald-500/80 text-white"
        )}
      >
        {image.source === "generation" ? "AI" : "Upload"}
      </span>
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[10px] text-white truncate opacity-0 group-hover:opacity-100 transition-opacity">
        {image.project_title}
      </span>
    </button>
  );
}
