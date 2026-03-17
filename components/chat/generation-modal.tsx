"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  X, Loader2, ExternalLink, Image as ImageIcon, Video, Calendar, FileType,
  RatioIcon, Ruler, Download, HardDrive, Volume2, VolumeX, Clock,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Tag, Plus, Music, User, Users,
  Copy, Check, Star
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VideoPlayer } from "./video-player";
import { AudioPlayer } from "./audio-player";
import { MusicPlayer } from "./music-player";
import { formatDateTimeLocal } from "@/lib/utils";
import { AudioVoiceConfig, AudioSpeakerConfig, getVoiceById } from "@/types/audio";
import { cn } from "@/lib/utils";

// Export the Generation interface for reuse
export interface Generation {
  type: "image" | "video" | "audio" | "music";
  id: number;
  conversation_id: number;
  conversation_user_id: number;
  conversation_title: string;
  content: string | null;
  quality_tier: "normal" | "hq" | null;
  model_name: string | null;
  generation_seed: number | null;
  is_favorite: boolean;
  image_url: string | null;
  image_mime_type: string | null;
  image_file_size: number | null;
  image_aspect_ratio: string | null;
  image_size: string | null;
  has_2x: boolean;
  video_url: string | null;
  video_mime_type: string | null;
  video_file_size: number | null;
  video_duration: number | null;
  video_has_audio: boolean | null;
  video_aspect_ratio: string | null;
  audio_url: string | null;
  audio_mime_type: string | null;
  audio_file_size: number | null;
  audio_duration: number | null;
  audio_voice_config: AudioVoiceConfig | AudioSpeakerConfig | null;
  music_url: string | null;
  music_mime_type: string | null;
  music_file_size: number | null;
  music_duration: number | null;
  music_config: Record<string, unknown> | null;
  created_at: string;
  deleted_at: string | null;
  tags: TagInfo[];
  user_name?: string | null;
  user_image?: string | null;
  source?: "generation" | "upload";
  estimated_cost?: number;
}

export interface TagInfo {
  id: number;
  name: string;
  color: string;
}

interface ImageDimensions {
  width: number;
  height: number;
}

// Helper functions
function isMultiSpeakerConfig(config: AudioVoiceConfig | AudioSpeakerConfig | string | null | undefined): boolean {
  if (!config) return false;
  const parsed = typeof config === "string" ? JSON.parse(config) : config;
  return parsed && typeof parsed === "object" && "speakers" in parsed;
}

function getParsedVoiceConfig(config: AudioVoiceConfig | AudioSpeakerConfig | string | null | undefined): AudioVoiceConfig | AudioSpeakerConfig | null {
  if (!config) return null;
  if (typeof config === "string") {
    try {
      return JSON.parse(config);
    } catch {
      return null;
    }
  }
  return config;
}

interface GenerationModalProps {
  generations: Generation[];
  selectedIndex: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onOpenConversation?: (conversationId: number) => void;
  onToggleFavorite?: (messageId: number) => void;
  onUpdateGeneration?: (id: number, updates: Partial<Generation>) => void;
  projectId: number;
  currentUserId: number;
  projectTags?: TagInfo[];
  showNavigation?: boolean;
}

export function GenerationModal({
  generations,
  selectedIndex,
  onClose,
  onNavigate,
  onOpenConversation,
  onToggleFavorite,
  onUpdateGeneration,
  projectId,
  currentUserId,
  projectTags = [],
  showNavigation = true,
}: GenerationModalProps) {
  const [imageDimensions, setImageDimensions] = useState<ImageDimensions | null>(null);
  const [upscaling, setUpscaling] = useState(false);
  const [copiedSeed, setCopiedSeed] = useState(false);
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");
  const [creatingTag, setCreatingTag] = useState(false);
  const [localTags, setLocalTags] = useState<TagInfo[]>(projectTags);
  const thumbnailListRef = useRef<HTMLDivElement>(null);
  const selectedThumbnailRef = useRef<HTMLButtonElement>(null);

  const selectedItem = selectedIndex !== null ? generations[selectedIndex] : null;

  // Navigation
  const canGoPrev = selectedIndex !== null && selectedIndex > 0;
  const canGoNext = selectedIndex !== null && selectedIndex < generations.length - 1;

  const goToPrev = useCallback(() => {
    if (canGoPrev && selectedIndex !== null) {
      onNavigate(selectedIndex - 1);
    }
  }, [canGoPrev, selectedIndex, onNavigate]);

  const goToNext = useCallback(() => {
    if (canGoNext && selectedIndex !== null) {
      onNavigate(selectedIndex + 1);
    }
  }, [canGoNext, selectedIndex, onNavigate]);

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
        onClose();
        setShowTagSelector(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, goToPrev, goToNext, onClose]);

  // Scroll selected thumbnail into view
  useEffect(() => {
    if (selectedThumbnailRef.current && thumbnailListRef.current) {
      selectedThumbnailRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedIndex]);

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

  // Update local tags when prop changes
  useEffect(() => {
    setLocalTags(projectTags);
  }, [projectTags]);

  if (!selectedItem) return null;

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
      let url: string | null = null;
      let ext: string = "png";

      if (gen.type === "image") {
        url = gen.image_url;
        ext = gen.image_mime_type?.split("/")[1] || "png";
      } else if (gen.type === "video") {
        url = gen.video_url;
        ext = "mp4";
      } else if (gen.type === "audio") {
        url = gen.audio_url;
        ext = gen.audio_mime_type?.split("/")[1] || "mp3";
      } else if (gen.type === "music") {
        url = gen.music_url;
        ext = gen.music_mime_type?.split("/")[1] || "mp3";
      }

      if (!url) return;
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
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
          messageId: gen.source !== "upload" ? gen.id : undefined,
        }),
      });
      if (!response.ok) throw new Error("Error al procesar imagen");
      const result = await response.json();

      if (result.has_2x && gen.source !== "upload" && onUpdateGeneration) {
        onUpdateGeneration(gen.id, { has_2x: true });
      }

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

  const handleCopySeed = (seed: number) => {
    navigator.clipboard.writeText(seed.toString());
    setCopiedSeed(true);
    setTimeout(() => setCopiedSeed(false), 2000);
  };

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
        setLocalTags([...localTags, tag]);
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
      if (res.ok && onUpdateGeneration) {
        const tag = localTags.find(t => t.id === tagId);
        if (tag) {
          const gen = generations.find(g => g.id === messageId);
          if (gen && !gen.tags.find(t => t.id === tagId)) {
            onUpdateGeneration(messageId, { tags: [...gen.tags, tag] });
          }
        }
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
      if (res.ok && onUpdateGeneration) {
        const gen = generations.find(g => g.id === messageId);
        if (gen) {
          onUpdateGeneration(messageId, { tags: gen.tags.filter(t => t.id !== tagId) });
        }
      }
    } catch (err) {
      console.error("Error removing tag:", err);
    }
  };

  const canUpscale = imageDimensions && imageDimensions.width <= 1920;
  const tagColors = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#06b6d4"];

  // Render thumbnail for sidebar
  const renderThumbnail = (gen: Generation, index: number) => {
    const isSelected = index === selectedIndex;
    return (
      <button
        key={`${gen.source || "generation"}-${gen.type}-${gen.id}`}
        ref={isSelected ? selectedThumbnailRef : null}
        onClick={() => onNavigate(index)}
        className={cn(
          "relative w-full aspect-square rounded-lg overflow-hidden border-2 transition-all flex-shrink-0",
          isSelected
            ? "border-primary ring-2 ring-primary/50"
            : "border-transparent hover:border-border"
        )}
      >
        {gen.type === "image" && gen.image_url ? (
          <img src={gen.image_url} alt="" className="w-full h-full object-cover" />
        ) : gen.type === "video" && gen.video_url ? (
          <>
            <video src={gen.video_url} className="w-full h-full object-cover" preload="metadata" muted playsInline />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-6 h-6 rounded-full bg-black/50 flex items-center justify-center">
                <Video className="h-3 w-3 text-white" />
              </div>
            </div>
          </>
        ) : gen.type === "audio" ? (
          <div className="w-full h-full bg-gradient-to-br from-emerald-900 to-teal-900 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Music className="h-4 w-4 text-white" />
            </div>
          </div>
        ) : gen.type === "music" ? (
          <div className="w-full h-full bg-gradient-to-br from-teal-900 to-cyan-900 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Music className="h-4 w-4 text-teal-300" />
            </div>
          </div>
        ) : null}
        {/* Favorite indicator */}
        {gen.is_favorite && (
          <Star className="absolute top-0.5 left-0.5 h-3 w-3 fill-yellow-400 text-yellow-400" />
        )}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center" onClick={() => { onClose(); setShowTagSelector(false); }}>
      {/* Navigation arrows */}
      {showNavigation && generations.length > 1 && (
        <>
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
        </>
      )}

      <div className="relative max-w-7xl w-full max-h-[90vh] flex bg-sidebar rounded-xl overflow-hidden mx-4" onClick={(e) => e.stopPropagation()}>
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border/50">
            <div className="flex items-center gap-3 min-w-0">
              {selectedItem.type === "image" ? <ImageIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" /> : selectedItem.type === "video" ? <Video className="h-5 w-5 text-muted-foreground flex-shrink-0" /> : <Music className="h-5 w-5 text-muted-foreground flex-shrink-0" />}
              <h3 className="font-medium truncate">{selectedItem.conversation_title || selectedItem.content?.substring(0, 50) || "Generación"}</h3>
              {showNavigation && <span className="text-sm text-muted-foreground flex-shrink-0">{selectedIndex !== null && `${selectedIndex + 1} / ${generations.length}`}</span>}
              {selectedItem.deleted_at && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded flex-shrink-0">Eliminado</span>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {selectedItem.source !== "upload" && onToggleFavorite && (
                <button
                  onClick={() => onToggleFavorite(selectedItem.id)}
                  className={`p-2 rounded-lg transition-colors ${
                    selectedItem.is_favorite
                      ? "bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30"
                      : "hover:bg-accent text-muted-foreground hover:text-foreground"
                  }`}
                  title={selectedItem.is_favorite ? "Quitar de favoritos" : "Agregar a favoritos"}
                >
                  <Star className={`h-5 w-5 ${selectedItem.is_favorite ? "fill-yellow-400" : ""}`} />
                </button>
              )}
              <button onClick={() => { onClose(); setShowTagSelector(false); }} className="p-2 hover:bg-accent rounded-lg">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black/50">
            {selectedItem.type === "image" && selectedItem.image_url ? (
              <img src={selectedItem.image_url} alt="" className="max-w-full max-h-[55vh] object-contain rounded-lg" />
            ) : selectedItem.type === "video" && selectedItem.video_url ? (
              <VideoPlayer
                videoUrl={selectedItem.video_url}
                duration={selectedItem.video_duration || undefined}
                hasAudio={selectedItem.video_has_audio || false}
                aspectRatio={selectedItem.video_aspect_ratio || "16:9"}
              />
            ) : selectedItem.type === "audio" && selectedItem.audio_url ? (
              <div className="w-full max-w-md p-6 bg-card rounded-xl border border-border/50">
                <div className="flex flex-col items-center mb-6">
                  <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mb-4">
                    <Music className="w-10 h-10 text-primary" />
                  </div>
                  {selectedItem.audio_voice_config && (() => {
                    const parsedConfig = getParsedVoiceConfig(selectedItem.audio_voice_config);
                    if (!parsedConfig) return null;
                    return (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        {isMultiSpeakerConfig(parsedConfig) ? (
                          <><Users className="h-4 w-4" /> {(parsedConfig as AudioSpeakerConfig).speakers.length} voces</>
                        ) : (
                          <><User className="h-4 w-4" /> {getVoiceById((parsedConfig as AudioVoiceConfig).voiceId)?.name || (parsedConfig as AudioVoiceConfig).voiceId}</>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <AudioPlayer
                  audioUrl={selectedItem.audio_url}
                  duration={selectedItem.audio_duration ?? undefined}
                  mimeType={selectedItem.audio_mime_type ?? undefined}
                  voiceConfig={getParsedVoiceConfig(selectedItem.audio_voice_config)}
                />
                {selectedItem.content && (
                  <div className="mt-4 pt-4 border-t border-border/50">
                    <p className="text-sm text-muted-foreground line-clamp-4">{selectedItem.content}</p>
                  </div>
                )}
              </div>
            ) : selectedItem.type === "music" && selectedItem.music_url ? (
              <div className="w-full max-w-md">
                <MusicPlayer
                  musicUrl={selectedItem.music_url}
                  duration={selectedItem.music_duration ?? undefined}
                  config={selectedItem.music_config as import("@/types/music").MusicGenerationSettings | null}
                />
                {selectedItem.content && (
                  <div className="mt-4 pt-4 border-t border-border/50">
                    <p className="text-sm text-muted-foreground line-clamp-4">{selectedItem.content}</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Tags Section */}
          {selectedItem.source !== "upload" && (
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
                        {localTags.filter(t => !selectedItem.tags.find(st => st.id === t.id)).map((tag) => (
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
                              onChange={(e) => setNewTagName(e.target.value.toUpperCase())}
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
          )}

          {/* Footer */}
          <div className="p-4 border-t border-border/50 space-y-3">
            {/* Meta info */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <FileType className="h-4 w-4" />
                <span>{selectedItem.type === "image" ? getFileExtension(selectedItem.image_mime_type) : selectedItem.type === "video" ? "MP4" : selectedItem.type === "music" ? "MP3" : getFileExtension(selectedItem.audio_mime_type)}</span>
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
              ) : selectedItem.type === "video" ? (
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
              ) : selectedItem.type === "music" ? (
                <>
                  {selectedItem.music_duration && (
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4" />
                      <span>{Math.floor(selectedItem.music_duration / 60)}:{(selectedItem.music_duration % 60).toString().padStart(2, "0")}</span>
                    </div>
                  )}
                  {selectedItem.music_config && (selectedItem.music_config as Record<string, unknown>).bpm && (
                    <div className="flex items-center gap-1.5">
                      <Music className="h-4 w-4" />
                      <span>{String((selectedItem.music_config as Record<string, unknown>).bpm)} BPM</span>
                    </div>
                  )}
                  {formatFileSize(selectedItem.music_file_size) && (
                    <div className="flex items-center gap-1.5">
                      <HardDrive className="h-4 w-4" />
                      <span>{formatFileSize(selectedItem.music_file_size)}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {selectedItem.audio_duration && (
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4" />
                      <span>{Math.floor(selectedItem.audio_duration / 60)}:{(selectedItem.audio_duration % 60).toString().padStart(2, "0")}</span>
                    </div>
                  )}
                  {formatFileSize(selectedItem.audio_file_size) && (
                    <div className="flex items-center gap-1.5">
                      <HardDrive className="h-4 w-4" />
                      <span>{formatFileSize(selectedItem.audio_file_size)}</span>
                    </div>
                  )}
                </>
              )}
              {selectedItem.user_name && (
                <div className="flex items-center gap-1.5">
                  {selectedItem.user_image ? (
                    <img src={selectedItem.user_image} alt="" className="w-4 h-4 rounded-full" />
                  ) : (
                    <User className="h-4 w-4" />
                  )}
                  <span>{selectedItem.user_name}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                <span>{formatDateTimeLocal(selectedItem.created_at)}</span>
              </div>
              {selectedItem.model_name && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  <span className="text-xs font-medium">{selectedItem.model_name}</span>
                </div>
              )}
              {selectedItem.generation_seed && (
                <button
                  onClick={() => handleCopySeed(selectedItem.generation_seed!)}
                  className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                  title="Copiar seed"
                >
                  {copiedSeed ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  <span>Seed: {selectedItem.generation_seed}</span>
                </button>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {selectedItem.type === "image" ? (
                <>
                  <Button onClick={() => handleDownload(selectedItem)} className="flex-1 gap-2" variant="outline">
                    <Download className="h-4 w-4" /> Descargar
                  </Button>
                  {canUpscale && (
                    <Button onClick={() => handle2xDownload(selectedItem)} disabled={upscaling} className={`flex-1 gap-2 ${selectedItem.has_2x ? "text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" : "text-green-400 border-green-500/30 hover:bg-green-500/10"}`} variant="outline">
                      {upscaling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {upscaling ? "Procesando..." : selectedItem.has_2x ? "Descargar @2x" : "Generar @2x"}
                    </Button>
                  )}
                </>
              ) : selectedItem.type === "video" ? (
                <Button onClick={() => handleDownload(selectedItem)} className="flex-1 gap-2" variant="outline">
                  <Download className="h-4 w-4" /> Descargar video
                </Button>
              ) : (
                <Button onClick={() => handleDownload(selectedItem)} className="flex-1 gap-2" variant="outline">
                  <Download className="h-4 w-4" /> {selectedItem.type === "music" ? "Descargar música" : "Descargar audio"}
                </Button>
              )}

              {onOpenConversation && selectedItem.conversation_id > 0 && (
                <Button onClick={() => { onOpenConversation(selectedItem.conversation_id); }} className="flex-1 gap-2" variant="outline">
                  <ExternalLink className="h-4 w-4" /> Ir a la conversación
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar - Thumbnail Carousel */}
        {generations.length > 1 && (
          <div className="w-32 border-l border-border/50 bg-card/50 flex flex-col">
            {/* Up arrow */}
            <button
              onClick={goToPrev}
              disabled={!canGoPrev}
              className={cn(
                "p-2 flex items-center justify-center border-b border-border/50 transition-colors",
                canGoPrev ? "hover:bg-accent text-foreground" : "text-muted-foreground/30 cursor-not-allowed"
              )}
            >
              <ChevronUp className="h-5 w-5" />
            </button>

            {/* Thumbnail list */}
            <div
              ref={thumbnailListRef}
              className="flex-1 overflow-y-auto p-2 space-y-2"
            >
              {generations.map((gen, index) => renderThumbnail(gen, index))}
            </div>

            {/* Down arrow */}
            <button
              onClick={goToNext}
              disabled={!canGoNext}
              className={cn(
                "p-2 flex items-center justify-center border-t border-border/50 transition-colors",
                canGoNext ? "hover:bg-accent text-foreground" : "text-muted-foreground/30 cursor-not-allowed"
              )}
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
