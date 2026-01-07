"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X, Loader2, ExternalLink, Image as ImageIcon, Video, Calendar, FileType,
  Maximize2, RatioIcon, Ruler, Download, HardDrive, Volume2, VolumeX, Clock,
  ChevronLeft, ChevronRight, LayoutGrid, Search, Tag, Plus, Trash2, RotateCcw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VideoPlayer } from "./video-player";
import { formatDateTimeLocal } from "@/lib/utils";

type FilterType = "all" | "images" | "videos";

interface TagInfo {
  id: number;
  name: string;
  color: string;
}

interface Generation {
  type: "image" | "video";
  id: number;
  conversation_id: number;
  conversation_user_id: number;
  conversation_title: string;
  content: string | null;
  image_url: string | null;
  image_mime_type: string | null;
  image_file_size: number | null;
  image_aspect_ratio: string | null;
  image_size: string | null;
  video_url: string | null;
  video_mime_type: string | null;
  video_file_size: number | null;
  video_duration: number | null;
  video_has_audio: boolean | null;
  video_aspect_ratio: string | null;
  created_at: string;
  deleted_at: string | null;
  tags: TagInfo[];
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface GenerationsGalleryProps {
  projectId: number;
  currentUserId: number;
  onOpenConversation: (conversationId: number) => void;
}

export function GenerationsGallery({ projectId, currentUserId, onOpenConversation }: GenerationsGalleryProps) {
  // Filter states
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);

  // Data states
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [projectTags, setProjectTags] = useState<TagInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [imageDimensions, setImageDimensions] = useState<ImageDimensions | null>(null);
  const [upscaling, setUpscaling] = useState(false);

  // Tag management states
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");
  const [creatingTag, setCreatingTag] = useState(false);

  // Pagination
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Fetch project tags
  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/tags`);
      if (res.ok) {
        const data = await res.json();
        setProjectTags(data);
      }
    } catch (err) {
      console.error("Error fetching tags:", err);
    }
  }, [projectId]);

  // Fetch generations with filters
  const fetchGenerations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("type", filter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (selectedTagIds.length > 0) params.set("tags", selectedTagIds.join(","));
      if (showDeleted) params.set("include_deleted", "true");

      const res = await fetch(`/api/projects/${projectId}/generations?${params}`);
      if (res.ok) {
        const data = await res.json();
        setGenerations(data.data);
        setTotal(data.pagination.total);
        setHasMore(data.pagination.hasMore);
      }
    } catch (err) {
      console.error("Error fetching generations:", err);
    } finally {
      setLoading(false);
    }
  }, [projectId, filter, debouncedSearch, selectedTagIds, showDeleted]);

  // Initial load
  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    fetchGenerations();
  }, [fetchGenerations]);

  // Debounced search - updates debouncedSearch after delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const selectedItem = selectedIndex !== null ? generations[selectedIndex] : null;

  // Navigation
  const canGoPrev = selectedIndex !== null && selectedIndex > 0;
  const canGoNext = selectedIndex !== null && selectedIndex < generations.length - 1;

  const goToPrev = useCallback(() => {
    if (canGoPrev && selectedIndex !== null) {
      setSelectedIndex(selectedIndex - 1);
    }
  }, [canGoPrev, selectedIndex]);

  const goToNext = useCallback(() => {
    if (canGoNext && selectedIndex !== null) {
      setSelectedIndex(selectedIndex + 1);
    }
  }, [canGoNext, selectedIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (selectedIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToNext();
      } else if (e.key === "Escape") {
        setSelectedIndex(null);
        setShowTagSelector(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, goToPrev, goToNext]);

  // Load image dimensions
  useEffect(() => {
    if (!selectedItem || selectedItem.type !== "image" || !selectedItem.image_url) {
      setImageDimensions(null);
      return;
    }

    const img = new Image();
    img.onload = () => {
      setImageDimensions({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    img.src = selectedItem.image_url;
  }, [selectedItem]);

  // Tag management functions
  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    setCreatingTag(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
      });
      if (res.ok) {
        const tag = await res.json();
        setProjectTags([...projectTags, tag]);
        setNewTagName("");
      }
    } catch (err) {
      console.error("Error creating tag:", err);
    } finally {
      setCreatingTag(false);
    }
  };

  const handleAddTagToMessage = async (messageId: number, tagId: number) => {
    try {
      const res = await fetch(`/api/messages/${messageId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_id: tagId }),
      });
      if (res.ok) {
        // Update local state
        setGenerations(prev => prev.map(gen => {
          if (gen.id === messageId) {
            const tag = projectTags.find(t => t.id === tagId);
            if (tag && !gen.tags.find(t => t.id === tagId)) {
              return { ...gen, tags: [...gen.tags, tag] };
            }
          }
          return gen;
        }));
      }
    } catch (err) {
      console.error("Error adding tag:", err);
    }
  };

  const handleRemoveTagFromMessage = async (messageId: number, tagId: number) => {
    try {
      const res = await fetch(`/api/messages/${messageId}/tags?tag_id=${tagId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setGenerations(prev => prev.map(gen => {
          if (gen.id === messageId) {
            return { ...gen, tags: gen.tags.filter(t => t.id !== tagId) };
          }
          return gen;
        }));
      }
    } catch (err) {
      console.error("Error removing tag:", err);
    }
  };

  const handleDeleteMessage = async (messageId: number) => {
    if (!confirm("¿Eliminar esta generación?")) return;
    try {
      const res = await fetch(`/api/messages/${messageId}`, { method: "DELETE" });
      if (res.ok) {
        if (showDeleted) {
          setGenerations(prev => prev.map(gen =>
            gen.id === messageId ? { ...gen, deleted_at: new Date().toISOString() } : gen
          ));
        } else {
          setGenerations(prev => prev.filter(gen => gen.id !== messageId));
          setSelectedIndex(null);
        }
      }
    } catch (err) {
      console.error("Error deleting message:", err);
    }
  };

  const handleRestoreMessage = async (messageId: number) => {
    try {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      if (res.ok) {
        setGenerations(prev => prev.map(gen =>
          gen.id === messageId ? { ...gen, deleted_at: null } : gen
        ));
      }
    } catch (err) {
      console.error("Error restoring message:", err);
    }
  };

  // Helper functions
  const getFileExtension = (mimeType: string | null) => {
    if (!mimeType) return "PNG";
    return mimeType.split("/")[1]?.toUpperCase() || "PNG";
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const calculateAspectRatio = (width: number, height: number): string => {
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.05) return "1:1";
    if (Math.abs(ratio - 16/9) < 0.05) return "16:9";
    if (Math.abs(ratio - 9/16) < 0.05) return "9:16";
    if (Math.abs(ratio - 4/3) < 0.05) return "4:3";
    if (Math.abs(ratio - 3/4) < 0.05) return "3:4";
    return `${ratio.toFixed(2)}:1`;
  };

  const handleDownload = async (gen: Generation) => {
    try {
      const url = gen.type === "image" ? gen.image_url : gen.video_url;
      if (!url) return;
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const ext = gen.type === "image" ? (gen.image_mime_type?.split("/")[1] || "png") : "mp4";
      a.download = `${gen.type}-${gen.id}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Error downloading:", err);
    }
  };

  const handle2xDownload = async (gen: Generation) => {
    if (!imageDimensions || gen.type !== "image" || !gen.image_url) return;
    setUpscaling(true);
    try {
      const response = await fetch("/api/images/upscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: gen.image_url,
          width: imageDimensions.width,
          height: imageDimensions.height,
        }),
      });
      if (!response.ok) throw new Error("Error al procesar imagen");
      const result = await response.json();
      const imageResponse = await fetch(result.url);
      const blob = await imageResponse.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `generation-${gen.id}--2x.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error upscaling:", err);
      alert("Error al procesar imagen");
    } finally {
      setUpscaling(false);
    }
  };

  const canUpscale = imageDimensions && imageDimensions.width <= 1920;
  const imageCount = generations.filter(g => g.type === "image").length;
  const videoCount = generations.filter(g => g.type === "video").length;

  const tagColors = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#06b6d4"];

  if (loading && generations.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with Filters */}
      <div className="p-4 border-b border-border/50 space-y-3">
        {/* Search and Type Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por prompt..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-muted border-border/50"
            />
          </div>

          <div className="flex items-center gap-1">
            {(["all", "images", "videos"] as FilterType[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {f === "all" && <LayoutGrid className="h-4 w-4" />}
                {f === "images" && <ImageIcon className="h-4 w-4" />}
                {f === "videos" && <Video className="h-4 w-4" />}
                {f === "all" ? "Todos" : f === "images" ? "Imágenes" : "Videos"}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => setShowDeleted(e.target.checked)}
              className="w-4 h-4 rounded accent-primary"
            />
            Mostrar eliminados
          </label>
        </div>

        {/* Tag Filters */}
        {projectTags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Tag className="h-4 w-4 text-muted-foreground" />
            {projectTags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => {
                  setSelectedTagIds(prev =>
                    prev.includes(tag.id)
                      ? prev.filter(id => id !== tag.id)
                      : [...prev, tag.id]
                  );
                }}
                className={`px-2 py-0.5 rounded-full text-xs font-medium transition-all ${
                  selectedTagIds.includes(tag.id)
                    ? "ring-2 ring-offset-1 ring-offset-background"
                    : "opacity-70 hover:opacity-100"
                }`}
                style={{
                  backgroundColor: `${tag.color}20`,
                  color: tag.color,
                  borderColor: tag.color,
                  ...(selectedTagIds.includes(tag.id) && { ringColor: tag.color }),
                }}
              >
                {tag.name}
              </button>
            ))}
            {selectedTagIds.length > 0 && (
              <button
                onClick={() => setSelectedTagIds([])}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          {total} {total === 1 ? "generación" : "generaciones"}
          {imageCount > 0 && videoCount > 0 && ` (${imageCount} imágenes, ${videoCount} videos)`}
        </p>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {generations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <LayoutGrid className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-2">Sin generaciones</h3>
            <p className="text-muted-foreground text-sm max-w-md">
              {searchQuery || selectedTagIds.length > 0
                ? "No hay resultados para los filtros seleccionados."
                : "Aún no hay generaciones en este proyecto."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {generations.map((gen, index) => (
              <div
                key={`${gen.type}-${gen.id}`}
                onClick={() => setSelectedIndex(index)}
                className={`group relative aspect-square rounded-lg overflow-hidden cursor-pointer bg-card border transition-all ${
                  gen.deleted_at
                    ? "border-red-500/30 opacity-60"
                    : "border-border/50 hover:border-primary/50"
                }`}
              >
                {gen.type === "image" && gen.image_url ? (
                  <img src={gen.image_url} alt="" className="w-full h-full object-cover" />
                ) : gen.video_url ? (
                  <>
                    <video src={gen.video_url} className="w-full h-full object-cover" preload="metadata" muted playsInline />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
                        <Video className="w-5 h-5 text-white" />
                      </div>
                    </div>
                    {gen.video_has_audio === false && (
                      <div className="absolute top-2 left-2 bg-black/60 rounded px-1.5 py-0.5">
                        <VolumeX className="h-3 w-3 text-white/50" />
                      </div>
                    )}
                  </>
                ) : null}

                {/* Deleted indicator */}
                {gen.deleted_at && (
                  <div className="absolute top-2 right-2 bg-red-500/80 rounded px-1.5 py-0.5 text-[10px] text-white">
                    Eliminado
                  </div>
                )}

                {/* Tags */}
                {gen.tags.length > 0 && (
                  <div className="absolute top-2 left-2 flex gap-1 flex-wrap max-w-[80%]">
                    {gen.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag.id}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ backgroundColor: `${tag.color}cc`, color: "white" }}
                      >
                        {tag.name}
                      </span>
                    ))}
                    {gen.tags.length > 3 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-black/60 text-white">
                        +{gen.tags.length - 3}
                      </span>
                    )}
                  </div>
                )}

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute bottom-0 left-0 right-0 p-2">
                    <p className="text-[10px] text-white/60">{formatDateTimeLocal(gen.created_at)}</p>
                  </div>
                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDownload(gen); }}
                      className="p-1.5 rounded-md bg-black/50 hover:bg-black/70 transition-colors"
                    >
                      <Download className="h-3.5 w-3.5 text-white/80" />
                    </button>
                    <div className="p-1.5 rounded-md bg-black/50">
                      <Maximize2 className="h-3.5 w-3.5 text-white/80" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center" onClick={() => { setSelectedIndex(null); setShowTagSelector(false); }}>
          {/* Navigation */}
          {canGoPrev && (
            <button onClick={(e) => { e.stopPropagation(); goToPrev(); }} className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 hover:bg-black/70 z-10">
              <ChevronLeft className="h-8 w-8 text-white" />
            </button>
          )}
          {canGoNext && (
            <button onClick={(e) => { e.stopPropagation(); goToNext(); }} className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 hover:bg-black/70 z-10">
              <ChevronRight className="h-8 w-8 text-white" />
            </button>
          )}

          <div className="relative max-w-5xl w-full max-h-[90vh] flex flex-col bg-sidebar rounded-xl overflow-hidden mx-16" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border/50">
              <div className="flex items-center gap-3">
                {selectedItem.type === "image" ? <ImageIcon className="h-5 w-5 text-muted-foreground" /> : <Video className="h-5 w-5 text-muted-foreground" />}
                <h3 className="font-medium truncate">{selectedItem.conversation_title}</h3>
                <span className="text-sm text-muted-foreground">{selectedIndex !== null && `${selectedIndex + 1} / ${generations.length}`}</span>
                {selectedItem.deleted_at && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">Eliminado</span>}
              </div>
              <button onClick={() => { setSelectedIndex(null); setShowTagSelector(false); }} className="p-2 hover:bg-accent rounded-lg">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black/50">
              {selectedItem.type === "image" && selectedItem.image_url ? (
                <img src={selectedItem.image_url} alt="" className="max-w-full max-h-[60vh] object-contain rounded-lg" />
              ) : selectedItem.video_url ? (
                <VideoPlayer
                  videoUrl={selectedItem.video_url}
                  duration={selectedItem.video_duration || undefined}
                  hasAudio={selectedItem.video_has_audio || false}
                  aspectRatio={selectedItem.video_aspect_ratio || "16:9"}
                />
              ) : null}
            </div>

            {/* Tags Section */}
            <div className="px-4 py-2 border-t border-border/50">
              <div className="flex items-center gap-2 flex-wrap">
                <Tag className="h-4 w-4 text-muted-foreground" />
                {selectedItem.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="group/tag flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                  >
                    {tag.name}
                    <button
                      onClick={() => handleRemoveTagFromMessage(selectedItem.id, tag.id)}
                      className="opacity-0 group-hover/tag:opacity-100 hover:bg-black/20 rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <div className="relative">
                  <button
                    onClick={() => setShowTagSelector(!showTagSelector)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-muted-foreground hover:bg-muted"
                  >
                    <Plus className="h-3 w-3" />
                    Agregar etiqueta
                  </button>
                  {showTagSelector && (
                    <div className="absolute bottom-full left-0 mb-2 w-64 bg-popover border border-border rounded-lg shadow-lg p-2 z-10">
                      <div className="space-y-2">
                        {projectTags.filter(t => !selectedItem.tags.find(st => st.id === t.id)).map((tag) => (
                          <button
                            key={tag.id}
                            onClick={() => { handleAddTagToMessage(selectedItem.id, tag.id); setShowTagSelector(false); }}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-muted text-sm"
                          >
                            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                            {tag.name}
                          </button>
                        ))}
                        <div className="border-t border-border pt-2 mt-2">
                          <div className="flex gap-2">
                            <Input
                              placeholder="Nueva etiqueta"
                              value={newTagName}
                              onChange={(e) => setNewTagName(e.target.value)}
                              className="h-8 text-sm"
                              onKeyDown={(e) => e.key === "Enter" && handleCreateTag()}
                            />
                            <div className="flex gap-1">
                              {tagColors.slice(0, 4).map((c) => (
                                <button
                                  key={c}
                                  onClick={() => setNewTagColor(c)}
                                  className={`w-6 h-6 rounded-full ${newTagColor === c ? "ring-2 ring-offset-1" : ""}`}
                                  style={{ backgroundColor: c }}
                                />
                              ))}
                            </div>
                            <Button size="sm" onClick={handleCreateTag} disabled={creatingTag || !newTagName.trim()}>
                              {creatingTag ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border/50 space-y-3">
              {/* Meta info */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <FileType className="h-4 w-4" />
                  <span>{selectedItem.type === "image" ? getFileExtension(selectedItem.image_mime_type) : "MP4"}</span>
                </div>
                {selectedItem.type === "image" ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <Ruler className="h-4 w-4" />
                      <span>{imageDimensions ? `${imageDimensions.width}x${imageDimensions.height}` : "..."}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RatioIcon className="h-4 w-4" />
                      <span>{imageDimensions ? calculateAspectRatio(imageDimensions.width, imageDimensions.height) : (selectedItem.image_aspect_ratio || "...")}</span>
                    </div>
                    {formatFileSize(selectedItem.image_file_size) && (
                      <div className="flex items-center gap-1.5">
                        <HardDrive className="h-4 w-4" />
                        <span>{formatFileSize(selectedItem.image_file_size)}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {selectedItem.video_duration && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-4 w-4" />
                        <span>{selectedItem.video_duration}s</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <RatioIcon className="h-4 w-4" />
                      <span>{selectedItem.video_aspect_ratio}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {selectedItem.video_has_audio ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 opacity-50" />}
                      <span>{selectedItem.video_has_audio ? "Con audio" : "Sin audio"}</span>
                    </div>
                    {formatFileSize(selectedItem.video_file_size) && (
                      <div className="flex items-center gap-1.5">
                        <HardDrive className="h-4 w-4" />
                        <span>{formatFileSize(selectedItem.video_file_size)}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  <span>{formatDateTimeLocal(selectedItem.created_at)}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                {selectedItem.type === "image" ? (
                  <>
                    <Button onClick={() => handleDownload(selectedItem)} className="flex-1 gap-2" variant="outline">
                      <Download className="h-4 w-4" /> Descargar
                    </Button>
                    {canUpscale && (
                      <Button onClick={() => handle2xDownload(selectedItem)} disabled={upscaling} className="flex-1 gap-2 text-green-400 border-green-500/30 hover:bg-green-500/10" variant="outline">
                        {upscaling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {upscaling ? "Procesando..." : "Descargar @2x"}
                      </Button>
                    )}
                  </>
                ) : (
                  <Button onClick={() => handleDownload(selectedItem)} className="flex-1 gap-2" variant="outline">
                    <Download className="h-4 w-4" /> Descargar video
                  </Button>
                )}

                {selectedItem.conversation_user_id === currentUserId && (
                  <Button onClick={() => { setSelectedIndex(null); onOpenConversation(selectedItem.conversation_id); }} className="flex-1 gap-2" variant="outline">
                    <ExternalLink className="h-4 w-4" /> Ir a la conversación
                  </Button>
                )}

                {/* Delete/Restore */}
                {selectedItem.deleted_at ? (
                  <Button onClick={() => handleRestoreMessage(selectedItem.id)} className="gap-2 text-green-400 border-green-500/30 hover:bg-green-500/10" variant="outline">
                    <RotateCcw className="h-4 w-4" /> Restaurar
                  </Button>
                ) : (
                  <Button onClick={() => handleDeleteMessage(selectedItem.id)} className="gap-2 text-red-400 border-red-500/30 hover:bg-red-500/10" variant="outline">
                    <Trash2 className="h-4 w-4" /> Eliminar
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
