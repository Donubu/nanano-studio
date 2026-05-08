"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Video as VideoIcon,
  Star,
  Sparkles,
  Tag as TagIcon,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TopazStudio } from "@/components/chat/topaz-studio";
import { TopazStudioVideo } from "@/components/chat/topaz-studio-video";

export interface MediaViewerEntry {
  url: string;
  type: "image" | "video";
  /** Optional DB message id — unlocks favorite, tags, Topaz Studio. */
  messageId?: number;
  modelName?: string;
  createdAt?: string;
  /** Per-generation overrides (seed varies per output). */
  seed?: number;
  prompt?: string;
}

interface MessageTag {
  id: number;
  tag_id: number;
  tag_name: string;
  tag_color: string;
}

interface TopazResult {
  id: number;
  url: string;
  label: string;
  fileSize: number | null;
}

interface MediaViewerModalProps {
  entry?: MediaViewerEntry;
  entries?: MediaViewerEntry[];
  initialIndex?: number;
  metadata?: {
    label?: string;
    caption?: string;
    prompt?: string;
    negativePrompt?: string;
    aspectRatio?: string;
    resolution?: string;
    duration?: number;
    audioEnabled?: boolean;
    seed?: number;
    referenceImageUrls?: string[];
    firstFrameUrl?: string;
    lastFrameUrl?: string;
  };
  onClose: () => void;
}

/**
 * Rich fullscreen viewer for canvas-generated and static images / videos.
 * Mirrors the full-mode DetailModal layout: card with header / centered
 * media / metadata footer, escapes the xyflow transform via a portal to
 * document.body, and lights up Topaz Studio + favorite + tag chips when a
 * messageId is provided.
 */
export function MediaViewerModal({
  entry,
  entries,
  initialIndex = 0,
  metadata,
  onClose,
}: MediaViewerModalProps) {
  const list: MediaViewerEntry[] =
    entries && entries.length > 0 ? entries : entry ? [entry] : [];
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, list.length - 1))
  );
  const total = list.length;
  const current = list[index];
  const messageId = current?.messageId;

  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [isFavorite, setIsFavorite] = useState<boolean | null>(null);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [tags, setTags] = useState<MessageTag[]>([]);
  const [topazResults, setTopazResults] = useState<TopazResult[]>([]);
  const [topazOpen, setTopazOpen] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Reset per-entry state whenever the displayed entry changes (history nav).
  useEffect(() => {
    setNaturalDims(null);
    setFileSize(null);
    setIsFavorite(null);
    setTags([]);
    setTopazResults([]);
    setDownloadError(null);
  }, [current?.url, messageId]);

  // Detect file size via HEAD (best-effort, S3 returns Content-Length).
  useEffect(() => {
    if (!current?.url) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(current.url, { method: "HEAD" });
        const len = res.headers.get("content-length");
        if (!cancelled && len) setFileSize(parseInt(len, 10));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current?.url]);

  // Fetch enrichment data only when we have a messageId (canvas AI nodes do).
  useEffect(() => {
    if (!messageId) return;
    let cancelled = false;
    (async () => {
      try {
        const [msgRes, tagsRes] = await Promise.all([
          fetch(`/api/messages/${messageId}`),
          fetch(`/api/messages/${messageId}/tags`),
        ]);
        if (!cancelled && msgRes.ok) {
          const m = await msgRes.json();
          setIsFavorite(!!m.is_favorite);
        }
        if (!cancelled && tagsRes.ok) {
          const t = await tagsRes.json();
          if (Array.isArray(t)) setTags(t);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  // Topaz history (downloadable upscaled results from prior runs).
  useEffect(() => {
    if (!messageId || !current) return;
    let cancelled = false;
    (async () => {
      try {
        const path = current.type === "video"
          ? `/api/videos/topaz-studio/history/${messageId}`
          : `/api/images/topaz-studio/history/${messageId}`;
        const res = await fetch(path);
        if (!cancelled && res.ok) {
          const data = await res.json();
          const edits = (data.edits || []) as Array<Record<string, unknown>>;
          const mapped: TopazResult[] = edits
            .map((e) => {
              if (current.type === "video") {
                if (e.status !== "completed" || !e.resultUrl) return null;
                const w = e.outputWidth as number | undefined;
                const h = e.outputHeight as number | undefined;
                const model = e.modelName as string | undefined;
                return {
                  id: e.id as number,
                  url: e.resultUrl as string,
                  label: `${w ?? "?"}×${h ?? "?"} ${model ?? ""}`.trim(),
                  fileSize: (e.outputFileSize as number | null) ?? null,
                };
              } else {
                if (!e.result_url) return null;
                const w = e.output_width as number | undefined;
                const h = e.output_height as number | undefined;
                const sf = e.scale_factor as number | undefined;
                return {
                  id: e.id as number,
                  url: e.result_url as string,
                  label: `${w ?? "?"}×${h ?? "?"} (${sf ?? "?"}x)`,
                  fileSize: (e.output_file_size as number | null) ?? null,
                };
              }
            })
            .filter((x): x is TopazResult => x != null);
          setTopazResults(mapped);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messageId, current]);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);
  const goNext = useCallback(() => {
    setIndex((i) => Math.min(total - 1, i + 1));
  }, [total]);

  // Keyboard: ESC closes, arrows navigate. Stop on capture so xyflow / canvas
  // shortcuts (delete, undo) don't fire while the modal is open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (topazOpen) {
          setTopazOpen(false);
        } else {
          onClose();
        }
        return;
      }
      if (topazOpen) return;
      if (total <= 1) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose, goPrev, goNext, total, topazOpen]);

  const handleDownload = useCallback(async (overrideUrl?: string, overrideName?: string) => {
    const url = overrideUrl || current?.url;
    if (!url) return;
    setDownloadError(null);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const ext =
        current?.type === "video"
          ? blob.type.includes("webm") ? "webm" : "mp4"
          : blob.type.includes("png") ? "png" : "jpg";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = overrideName || `${metadata?.label || "canvas"}-${index + 1}.${ext}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setDownloadError("No se pudo descargar — abriendo en nueva pestaña");
      window.open(url, "_blank");
    }
  }, [current, index, metadata?.label]);

  const handleToggleFavorite = useCallback(async () => {
    if (!messageId || favoriteLoading) return;
    setFavoriteLoading(true);
    try {
      const res = await fetch(`/api/messages/${messageId}/favorite`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setIsFavorite(!!data.is_favorite);
      }
    } catch {
      /* ignore */
    } finally {
      setFavoriteLoading(false);
    }
  }, [messageId, favoriteLoading]);

  const handleRemoveTag = useCallback(async (tagId: number) => {
    if (!messageId) return;
    try {
      await fetch(`/api/messages/${messageId}/tags?tag_id=${tagId}`, {
        method: "DELETE",
      });
      setTags((ts) => ts.filter((t) => t.tag_id !== tagId));
    } catch {
      /* ignore */
    }
  }, [messageId]);

  if (!current) return null;
  if (typeof document === "undefined") return null;

  const formattedDate = current.createdAt
    ? new Date(current.createdAt).toLocaleString()
    : null;

  const promptText = current.prompt || metadata?.prompt;
  const seed = current.seed ?? metadata?.seed;
  const TypeIcon = current.type === "video" ? VideoIcon : ImageIcon;

  // ------ Topaz overlay (sits above the modal) ------
  if (topazOpen && messageId) {
    if (current.type === "image") {
      return createPortal(
        <TopazStudio
          imageUrl={current.url}
          messageId={messageId}
          imageDimensions={naturalDims ? { width: naturalDims.w, height: naturalDims.h } : { width: 1024, height: 1024 }}
          onClose={() => setTopazOpen(false)}
        />,
        document.body
      );
    }
    return createPortal(
      <TopazStudioVideo
        videoUrl={current.url}
        messageId={messageId}
        videoMetadata={{
          duration: metadata?.duration ?? 8,
          width: naturalDims?.w,
          height: naturalDims?.h,
          hasAudio: metadata?.audioEnabled,
          aspectRatio: metadata?.aspectRatio,
        }}
        onClose={() => setTopazOpen(false)}
      />,
      document.body
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center"
      onClick={onClose}
    >
      {/* Outer history nav */}
      {total > 1 && index > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 hover:bg-black/70 z-10"
          title="Anterior (←)"
        >
          <ChevronLeft className="h-7 w-7 text-white" />
        </button>
      )}
      {total > 1 && index < total - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 hover:bg-black/70 z-10"
          title="Siguiente (→)"
        >
          <ChevronRight className="h-7 w-7 text-white" />
        </button>
      )}

      <div
        className="relative max-w-5xl w-full max-h-[90vh] flex flex-col bg-sidebar rounded-xl overflow-hidden mx-16"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50 gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <TypeIcon className="h-5 w-5 text-muted-foreground shrink-0" />
            {metadata?.label && (
              <span className="text-sm font-medium truncate">{metadata.label}</span>
            )}
            {total > 1 && (
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {index + 1} / {total}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {messageId != null && (
              <button
                onClick={handleToggleFavorite}
                disabled={favoriteLoading || isFavorite == null}
                className={`p-2 rounded-lg transition-colors ${
                  isFavorite
                    ? "bg-yellow-500/20 text-yellow-500"
                    : "hover:bg-accent text-muted-foreground"
                }`}
                title={isFavorite ? "Quitar de favoritos" : "Marcar como favorito"}
              >
                {favoriteLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Star className={`h-5 w-5 ${isFavorite ? "fill-current" : ""}`} />
                )}
              </button>
            )}
            <button
              onClick={() => handleDownload()}
              className="p-2 rounded-lg hover:bg-accent text-muted-foreground"
              title="Descargar original"
            >
              <Download className="h-5 w-5" />
            </button>
            {topazResults.map((tr) => (
              <button
                key={tr.id}
                onClick={() => handleDownload(tr.url, `topaz-${messageId}-${tr.id}.${current.type === "video" ? "mp4" : "png"}`)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-accent text-muted-foreground text-xs"
                title={`Descargar Topaz: ${tr.label}`}
              >
                <Download className="h-4 w-4 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                  {tr.label}
                </span>
              </button>
            ))}
            {messageId != null && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTopazOpen(true)}
                className="gap-1.5"
              >
                <Sparkles className="h-4 w-4" />
                Topaz Studio
              </Button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-accent text-muted-foreground"
              title="Cerrar (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Media area */}
        <div
          className="flex-1 overflow-hidden flex items-center justify-center p-4 bg-black/30"
          style={{ minHeight: 0 }}
        >
          {current.type === "image" ? (
            <img
              src={current.url}
              alt=""
              className="max-w-full object-contain rounded"
              style={{ maxHeight: "calc(90vh - 220px)" }}
              onLoad={(e) => {
                const img = e.target as HTMLImageElement;
                setNaturalDims({ w: img.naturalWidth, h: img.naturalHeight });
              }}
            />
          ) : (
            <video
              key={current.url}
              src={current.url}
              controls
              autoPlay
              className="rounded-lg object-contain max-w-full"
              style={{
                maxHeight: "calc(90vh - 220px)",
                aspectRatio: (metadata?.aspectRatio || "16:9").replace(":", " / "),
              }}
              onLoadedMetadata={(e) => {
                const v = e.target as HTMLVideoElement;
                setNaturalDims({ w: v.videoWidth, h: v.videoHeight });
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border/50 space-y-2 max-h-[40vh] overflow-y-auto">
          {downloadError && (
            <div className="flex items-center gap-1.5 text-xs text-amber-500">
              <AlertCircle className="h-3.5 w-3.5" />
              {downloadError}
            </div>
          )}

          {metadata?.caption && (
            <p className="text-xs text-muted-foreground italic">{metadata.caption}</p>
          )}

          {promptText && (
            <p className="text-sm text-foreground whitespace-pre-wrap">{promptText}</p>
          )}

          {metadata?.negativePrompt && (
            <p className="text-xs text-red-400">
              <span className="text-muted-foreground">Negativo: </span>
              {metadata.negativePrompt}
            </p>
          )}

          {/* Reference / first / last frame thumbs */}
          {(metadata?.firstFrameUrl ||
            metadata?.lastFrameUrl ||
            (metadata?.referenceImageUrls && metadata.referenceImageUrls.length > 0)) && (
            <div className="flex items-center gap-2 flex-wrap">
              {metadata.firstFrameUrl && (
                <FrameThumb url={metadata.firstFrameUrl} label="First" />
              )}
              {metadata.lastFrameUrl && (
                <FrameThumb url={metadata.lastFrameUrl} label="Last" />
              )}
              {metadata.referenceImageUrls?.map((url, i) => (
                <FrameThumb key={i} url={url} label={`Ref ${i + 1}`} />
              ))}
            </div>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <TagIcon className="h-3 w-3 text-muted-foreground shrink-0" />
              {tags.map((t) => (
                <button
                  key={t.tag_id}
                  onClick={() => handleRemoveTag(t.tag_id)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-white hover:opacity-80 transition-opacity"
                  style={{ backgroundColor: t.tag_color }}
                  title="Click para quitar tag"
                >
                  {t.tag_name}
                  <X className="h-2.5 w-2.5" />
                </button>
              ))}
            </div>
          )}

          {/* Metadata pills */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {current.modelName && <Pill>{current.modelName}</Pill>}
            {metadata?.aspectRatio && <Pill>{metadata.aspectRatio}</Pill>}
            {metadata?.resolution && <Pill>{metadata.resolution}</Pill>}
            {naturalDims && (
              <Pill>
                {naturalDims.w} × {naturalDims.h}
              </Pill>
            )}
            {fileSize != null && <Pill>{formatBytes(fileSize)}</Pill>}
            {metadata?.duration != null && <Pill>{metadata.duration}s</Pill>}
            {metadata?.audioEnabled != null && (
              <Pill>{metadata.audioEnabled ? "Con audio" : "Sin audio"}</Pill>
            )}
            {seed != null && seed > 0 && <Pill>Seed: {seed}</Pill>}
            {formattedDate && <span>{formattedDate}</span>}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// --- Subcomponents ---

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="bg-muted px-1.5 py-0.5 rounded">{children}</span>;
}

function FrameThumb({ url, label }: { url: string; label: string }) {
  return (
    <div className="relative w-12 h-12 rounded overflow-hidden border border-border/50">
      <img src={url} alt={label} className="w-full h-full object-cover" />
      <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] text-white text-center leading-3">
        {label}
      </span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
