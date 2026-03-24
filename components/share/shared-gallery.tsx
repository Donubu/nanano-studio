"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Download, X, ChevronLeft, ChevronRight, Image as ImageIcon, Video, MessageSquare, LayoutGrid, Filter, Folder, ArrowLeft, Sun, Moon, Monitor, Volume2, VolumeX, Play } from "lucide-react";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { VideoPlayer } from "@/components/chat/video-player";

// ---- Types ----

interface Generation {
  id: number;
  type: "image" | "video" | "text";
  status: string;
  content: string | null;
  is_favorite: boolean;
  image_url: string | null;
  image_mime_type: string | null;
  image_aspect_ratio: string | null;
  image_size: string | null;
  has_2x: boolean;
  video_url: string | null;
  video_mime_type: string | null;
  video_duration: number | null;
  video_has_audio: boolean | null;
  video_aspect_ratio: string | null;
  text_content: string | null;
  thought: string | null;
  created_at: string;
  tags: { id: number; name: string; color: string }[];
}

interface Collection {
  id: number;
  name: string;
  item_count: number;
  thumbnail_url: string | null;
  created_at: string;
}

interface SharedData {
  title: string;
  created_at: string;
  generations: Generation[];
  collections: Collection[];
  total_count: number;
  visit_count: number;
}

interface SharedGalleryProps {
  token: string;
  initialData: SharedData;
}

// ---- Constants ----

const GRID_SIZES = { S: 180, M: 275, L: 335 } as const;
const POLL_INTERVAL = 10000;

// ---- Helpers ----

function getAspectRatio(gen: Generation): number {
  if (gen.type === "text") return 1;
  const raw = gen.image_aspect_ratio || gen.video_aspect_ratio;
  if (raw) {
    const parts = raw.split(":");
    if (parts.length === 2) {
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (w > 0 && h > 0) return w / h;
    }
  }
  if (gen.image_size) {
    const parts = gen.image_size.split("x");
    if (parts.length === 2) {
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (w > 0 && h > 0) return w / h;
    }
  }
  return 1;
}

function downloadUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ---- Component ----

export function SharedGallery({ token, initialData }: SharedGalleryProps) {
  const [generations, setGenerations] = useState<Generation[]>(initialData.generations);
  const [collections] = useState<Collection[]>(initialData.collections || []);
  const [activeCollection, setActiveCollection] = useState<Collection | null>(null);
  const [collectionItems, setCollectionItems] = useState<Generation[]>([]);
  const [title] = useState(initialData.title);
  const [visitCount, setVisitCount] = useState(initialData.visit_count || 0);
  const [filter, setFilter] = useState<"all" | "images" | "videos" | "texts">("all");
  const [gridSize, setGridSize] = useState<"S" | "M" | "L">("M");
  const { theme, setTheme } = useTheme();
  const [hoverAudio, setHoverAudio] = useState(false);

  // Hydrate from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    const savedSize = localStorage.getItem("shared-grid-size") as "S" | "M" | "L" | null;
    if (savedSize && ["S", "M", "L"].includes(savedSize)) setGridSize(savedSize);
    if (localStorage.getItem("shared-hover-audio") === "true") setHoverAudio(true);
  }, []);
  const toggleHoverAudio = () => {
    const next = !hoverAudio;
    setHoverAudio(next);
    localStorage.setItem("shared-hover-audio", String(next));
  };
  const [selectedItem, setSelectedItem] = useState<Generation | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const latestTimestamp = useRef<string>(
    generations.length > 0 ? generations[0].created_at : initialData.created_at
  );

  // Polling for new generations
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/share/${token}?after=${encodeURIComponent(latestTimestamp.current)}`
        );
        if (!res.ok) return;
        const data: SharedData = await res.json();
        if (data.visit_count != null) setVisitCount(data.visit_count);
        if (data.generations.length > 0) {
          setGenerations((prev) => {
            const existingIds = new Set(prev.map((g) => g.id));
            const newItems = data.generations.filter((g) => !existingIds.has(g.id));
            if (newItems.length === 0) return prev;
            latestTimestamp.current = newItems[0].created_at;
            return [...newItems, ...prev];
          });
        }
      } catch {
        // Ignore polling errors
      }
    }, POLL_INTERVAL);
    return () => clearInterval(poll);
  }, [token]);

  // Sync collection state with URL for browser back/forward navigation
  const loadCollection = useCallback(async (col: Collection) => {
    setActiveCollection(col);
    try {
      const res = await fetch(`/api/share/${token}?collection=${col.id}`);
      if (res.ok) {
        const data: SharedData = await res.json();
        setCollectionItems(data.generations);
      }
    } catch {}
  }, [token]);

  const openCollection = useCallback(async (col: Collection) => {
    window.history.pushState({ collectionId: col.id }, "", `?collection=${col.id}`);
    loadCollection(col);
  }, [loadCollection]);

  const closeCollection = useCallback(() => {
    window.history.pushState({}, "", window.location.pathname);
    setActiveCollection(null);
    setCollectionItems([]);
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const colId = params.get("collection");
      if (colId) {
        const col = collections.find(c => c.id === parseInt(colId));
        if (col) {
          loadCollection(col);
          return;
        }
      }
      setActiveCollection(null);
      setCollectionItems([]);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [collections, loadCollection]);

  // Init from URL on mount (if opened with ?collection=)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const colId = params.get("collection");
    if (colId) {
      const col = collections.find(c => c.id === parseInt(colId));
      if (col) loadCollection(col);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Items to display: collection items or main grid
  const displayItems = activeCollection ? collectionItems : generations;

  // Filter generations
  const filtered = displayItems.filter((g) => {
    if (filter === "images") return g.type === "image";
    if (filter === "videos") return g.type === "video";
    if (filter === "texts") return g.type === "text";
    return true;
  });

  const rowHeight = GRID_SIZES[gridSize];

  // Grid size persistence
  const handleGridSize = (size: "S" | "M" | "L") => {
    setGridSize(size);
    localStorage.setItem("shared-grid-size", size);
  };

  // Modal navigation
  const openModal = useCallback((index: number, gen: Generation) => {
    setSelectedItem(gen);
    setSelectedIndex(index);
  }, []);

  const closeModal = useCallback(() => {
    setSelectedItem(null);
    setSelectedIndex(null);
  }, []);

  const navigateModal = useCallback(
    (direction: -1 | 1) => {
      if (selectedIndex === null) return;
      const newIndex = selectedIndex + direction;
      if (newIndex >= 0 && newIndex < filtered.length) {
        setSelectedIndex(newIndex);
        setSelectedItem(filtered[newIndex]);
      }
    },
    [selectedIndex, filtered]
  );

  // Keyboard navigation
  useEffect(() => {
    if (!selectedItem) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
      if (e.key === "ArrowLeft") navigateModal(-1);
      if (e.key === "ArrowRight") navigateModal(1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedItem, closeModal, navigateModal]);

  // Count by type
  const imgCount = displayItems.filter((g) => g.type === "image").length;
  const vidCount = displayItems.filter((g) => g.type === "video").length;
  const txtCount = displayItems.filter((g) => g.type === "text").length;

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="border-b bg-card px-4 py-3 shrink-0">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-semibold shrink-0">
              <LayoutGrid className="h-3.5 w-3.5" />
              Estudio
            </div>
            <h1 className="text-sm font-medium truncate">{title || "Estudio Compartido"}</h1>
            <span className="text-xs text-muted-foreground shrink-0">
              {generations.length} generaciones
            </span>
            {visitCount > 0 && (
              <span className="text-xs text-muted-foreground shrink-0">
                · {visitCount} vista{visitCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Grid size */}
            <div className="flex items-center border rounded-md overflow-hidden">
              {(["S", "M", "L"] as const).map((size) => (
                <button
                  key={size}
                  onClick={() => handleGridSize(size)}
                  className={`px-2 py-1 text-xs font-medium transition-colors ${
                    gridSize === size
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
            {/* Audio on hover */}
            <button
              onClick={toggleHoverAudio}
              className={`p-1.5 rounded-md transition-colors ${hoverAudio ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
              title={hoverAudio ? "Audio en hover: ON" : "Audio en hover: OFF"}
            >
              {hoverAudio ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            {/* Theme toggle */}
            <div className="flex items-center border rounded-md overflow-hidden">
              <button
                onClick={() => setTheme("light")}
                className={`p-1.5 transition-colors ${theme === "light" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                title="Claro"
              >
                <Sun className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setTheme("dark")}
                className={`p-1.5 transition-colors ${theme === "dark" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                title="Oscuro"
              >
                <Moon className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setTheme("system")}
                className={`p-1.5 transition-colors ${theme === "system" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                title="Sistema"
              >
                <Monitor className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Filter bar */}
      <div className="border-b bg-card/50 px-4 py-2 shrink-0">
        <div className="max-w-screen-2xl mx-auto flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          {[
            { key: "all" as const, label: "Todo", count: generations.length, icon: null },
            { key: "images" as const, label: "Imágenes", count: imgCount, icon: ImageIcon },
            { key: "videos" as const, label: "Videos", count: vidCount, icon: Video },
            { key: "texts" as const, label: "Textos", count: txtCount, icon: MessageSquare },
          ].map(({ key, label, count, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                filter === key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {Icon && <Icon className="h-3 w-3" />}
              {label}
              {count > 0 && (
                <span className="text-[10px] opacity-70">({count})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Collection breadcrumb */}
      {activeCollection && (
        <div className="border-b bg-card/50 px-4 py-2 shrink-0">
          <div className="max-w-screen-2xl mx-auto flex items-center gap-2">
            <button onClick={closeCollection} className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">{activeCollection.name}</span>
            <span className="text-xs text-muted-foreground">
              {collectionItems.length} {collectionItems.length === 1 ? "item" : "items"}
            </span>
          </div>
        </div>
      )}

      {/* Gallery Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-screen-2xl mx-auto">
          {filtered.length === 0 && (!collections.length || activeCollection) ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <LayoutGrid className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-sm">No hay generaciones para mostrar</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {/* Interleave collections and generations by date (main view only) */}
              {(() => {
                if (activeCollection) {
                  // Inside a collection: just show filtered items
                  return filtered.map((gen, index) => (
                    <GridItemCard key={gen.id} gen={gen} index={index} rowHeight={rowHeight} hoverAudio={hoverAudio} onOpen={openModal} />
                  ));
                }

                // Main view: interleave collections + generations by created_at DESC
                const showCollections = filter === "all";
                type Entry = { kind: "generation"; data: Generation; index: number } | { kind: "collection"; data: Collection };
                const entries: Entry[] = [
                  ...filtered.map((data, index) => ({ kind: "generation" as const, data, index })),
                  ...(showCollections ? collections.map(data => ({ kind: "collection" as const, data })) : []),
                ];
                entries.sort((a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime());

                return entries.map(entry => {
                  if (entry.kind === "collection") {
                    const col = entry.data;
                    return (
                      <div
                        key={`col-${col.id}`}
                        onClick={() => openCollection(col)}
                        style={{ height: rowHeight, width: rowHeight }}
                        className="group relative rounded-lg overflow-hidden cursor-pointer bg-card border border-border/50 hover:border-primary/50 transition-all shrink-0"
                      >
                        {col.thumbnail_url ? (
                          <img src={col.thumbnail_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />
                        ) : (
                          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-orange-500/10" />
                        )}
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/40 group-hover:bg-black/20 transition-colors">
                          <Folder className="h-10 w-10 text-amber-400" />
                          <span className="text-xs font-medium text-white text-center px-2 line-clamp-2">{col.name}</span>
                          <span className="text-[10px] text-white/60">{col.item_count} item{col.item_count !== 1 ? "s" : ""}</span>
                        </div>
                      </div>
                    );
                  }
                  return <GridItemCard key={entry.data.id} gen={entry.data} index={entry.index} rowHeight={rowHeight} hoverAudio={hoverAudio} onOpen={openModal} />;
                });
              })()}
              {/* Fallback for non-interleaved filtered items when there are no collections */}
              {activeCollection && filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground w-full">
                  <Folder className="h-12 w-12 mb-4 opacity-30" />
                  <p className="text-sm">Colección vacía</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer branding */}
      <footer className="border-t bg-card px-4 py-2 shrink-0">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            Creado con <strong>Puerto Studio</strong>
          </span>
          <a
            href="https://puerto.studio"
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-[11px] text-primary hover:underline"
          >
            puerto.studio
          </a>
        </div>
      </footer>

      {/* Modal */}
      {selectedItem && (
        <SharedModal
          generation={selectedItem}
          onClose={closeModal}
          onPrev={selectedIndex !== null && selectedIndex > 0 ? () => navigateModal(-1) : undefined}
          onNext={selectedIndex !== null && selectedIndex < filtered.length - 1 ? () => navigateModal(1) : undefined}
        />
      )}
    </div>
  );
}

// ---- Grid Item ----

function GridItemCard({ gen, index, rowHeight, hoverAudio, onOpen }: {
  gen: Generation; index: number; rowHeight: number; hoverAudio?: boolean;
  onOpen: (i: number, g: Generation) => void;
}) {
  const ratio = getAspectRatio(gen);
  const itemWidth = Math.round(rowHeight * ratio);

  return (
    <div
      onClick={() => onOpen(index, gen)}
      style={{ height: rowHeight, width: itemWidth }}
      className="group relative rounded-lg overflow-hidden cursor-pointer bg-card border border-border/50 hover:border-primary/50 transition-all shrink-0"
      onMouseEnter={(e) => {
        if (gen.type === "video") {
          const v = e.currentTarget.querySelector("video");
          if (v) { if (hoverAudio) v.muted = false; v.play(); }
        }
      }}
      onMouseLeave={(e) => {
        if (gen.type === "video") {
          const v = e.currentTarget.querySelector("video");
          if (v) { v.pause(); v.currentTime = 0; v.muted = true; }
        }
      }}
    >
      {gen.status === "generating" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/50 gap-2">
          <div className="h-5 w-5 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
          <span className="text-[10px] text-muted-foreground">
            {gen.type === "video" ? "Video" : gen.type === "text" ? "Texto" : "Imagen"}
          </span>
        </div>
      ) : gen.type === "text" ? (
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-purple-500/10 p-3 flex flex-col overflow-hidden">
          <div className="flex items-center gap-1.5 mb-1.5 shrink-0">
            <MessageSquare className="h-3 w-3 text-blue-500" />
            <span className="text-[10px] font-medium text-blue-500">Texto</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-6 flex-1">
            {gen.text_content?.slice(0, 300) || ""}
          </p>
        </div>
      ) : gen.type === "video" && gen.video_url ? (
        <video
          src={gen.video_url}
          muted
          loop
          playsInline
          preload="metadata"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : gen.image_url ? (
        <img
          src={gen.image_url}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : null}

      <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors" />

      {/* Play icon for videos */}
      {gen.type === "video" && gen.status !== "generating" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-70 group-hover:opacity-0 transition-opacity">
          <div className="p-2 rounded-full bg-black/50">
            <Play className="h-5 w-5 text-white fill-white" />
          </div>
        </div>
      )}

      {gen.tags.length > 0 && (
        <div className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
          {gen.tags.map((tag) => (
            <span
              key={tag.id}
              className="px-1.5 py-0.5 rounded text-[9px] font-medium text-white/90"
              style={{ backgroundColor: tag.color + "cc" }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {(gen.image_url || gen.video_url) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            const url = gen.image_url || gen.video_url;
            if (url) downloadUrl(url, `generation-${gen.id}`);
          }}
          className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md bg-black/60 text-white hover:bg-black/80"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      )}

      {gen.type === "video" && gen.video_duration && (
        <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-black/60 text-white">
          {gen.video_duration}s
        </span>
      )}

      {gen.is_favorite && (
        <span className="absolute top-1.5 right-1.5 text-yellow-400 text-xs">★</span>
      )}
    </div>
  );
}

// ---- Modal ----

function SharedModal({
  generation,
  onClose,
  onPrev,
  onNext,
}: {
  generation: Generation;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const gen = generation;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="relative max-w-3xl w-full mx-14" onClick={(e) => e.stopPropagation()}>
      <div
        className="bg-card rounded-xl border w-full max-h-[85vh] flex flex-col overflow-hidden"
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            {gen.type === "image" && <ImageIcon className="h-4 w-4 text-purple-500" />}
            {gen.type === "video" && <Video className="h-4 w-4 text-orange-500" />}
            {gen.type === "text" && <MessageSquare className="h-4 w-4 text-blue-500" />}
            <span className="text-sm font-medium capitalize">{gen.type === "text" ? "Texto" : gen.type === "video" ? "Video" : "Imagen"}</span>
            {gen.tags.length > 0 && (
              <div className="flex gap-1 ml-2">
                {gen.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white/90"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(gen.image_url || gen.video_url) && (
              <button
                onClick={() => {
                  const url = gen.image_url || gen.video_url;
                  if (url) downloadUrl(url, `generation-${gen.id}`);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Descargar
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Media preview */}
          {gen.type === "image" && gen.image_url && (
            <div className="flex justify-center mb-4">
              <img
                src={gen.has_2x ? gen.image_url.replace(/(\.[^.]+)$/, "_2x$1") : gen.image_url}
                alt=""
                className="max-h-[60vh] rounded-lg object-contain"
              />
            </div>
          )}

          {gen.type === "video" && gen.video_url && (
            <div className="flex justify-center mb-4">
              <div className="max-w-2xl w-full">
                <VideoPlayer
                  videoUrl={gen.video_url}
                  duration={gen.video_duration || undefined}
                  hasAudio={gen.video_has_audio ?? true}
                  aspectRatio={gen.video_aspect_ratio || undefined}
                  size="large"
                />
              </div>
            </div>
          )}

          {gen.type === "text" && gen.text_content && (
            <div className="bg-muted/50 rounded-lg p-4 mb-4 max-h-[60vh] overflow-y-auto prose prose-sm dark:prose-invert max-w-none text-[14px] leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{gen.text_content}</ReactMarkdown>
            </div>
          )}

          {/* Prompt */}
          {gen.content && (
            <div className="border rounded-lg p-3">
              <p className="text-[11px] font-medium text-muted-foreground mb-1">Prompt</p>
              <p className="text-sm">{gen.content}</p>
            </div>
          )}

          {/* Meta info */}
          <div className="flex items-center gap-4 mt-3 text-[11px] text-muted-foreground">
            {gen.image_size && <span>Resolución: {gen.image_size}</span>}
            {gen.video_duration && <span>Duración: {gen.video_duration}s</span>}
            {gen.image_aspect_ratio && <span>Aspecto: {gen.image_aspect_ratio}</span>}
            {gen.video_aspect_ratio && <span>Aspecto: {gen.video_aspect_ratio}</span>}
          </div>
        </div>

      </div>
        {/* Navigation arrows */}
        {onPrev && (
          <button
            onClick={onPrev}
            className="absolute -left-12 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/15 border border-white/30 text-white hover:bg-white/25 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {onNext && (
          <button
            onClick={onNext}
            className="absolute -right-12 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/15 border border-white/30 text-white hover:bg-white/25 transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

    </div>
  );
}
