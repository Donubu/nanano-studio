"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import NextImage from "next/image";
import { useNavigation } from "@/contexts/navigation-context";
import {
  X, Loader2, ExternalLink, Image as ImageIcon, Video, Calendar, FileType,
  Maximize2, RatioIcon, Ruler, Download, HardDrive, Volume2, VolumeX, Clock,
  ChevronLeft, ChevronRight, LayoutGrid, Search, Tag, Plus, Trash2, Upload, Music, User, Users,
  Sparkles, Copy, Check, Star, CalendarDays, Wand2, RotateCcw
} from "lucide-react";
import { TopazStudio } from "./topaz-studio";
import { TopazStudioVideo } from "./topaz-studio-video";
import { ProjectCalendar } from "@/components/dashboard/project-calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VideoPlayer } from "./video-player";
import { AudioPlayer } from "./audio-player";
import { formatDateTimeLocal } from "@/lib/utils";
import { AudioVoiceConfig, AudioSpeakerConfig, getVoiceById } from "@/types/audio";

type FilterType = "all" | "images" | "videos" | "audios";
type QualityFilterType = "all" | "normal" | "hq";
type FavoriteFilterType = "all" | "favorites";
type ViewMode = "grid" | "calendar";

interface TagInfo {
  id: number;
  name: string;
  color: string;
}

interface Generation {
  type: "image" | "video" | "audio";
  id: number;
  conversation_id: number;
  conversation_user_id: number;
  conversation_title: string;
  content: string | null;
  quality_tier: "normal" | "hq" | null;
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
  created_at: string;
  deleted_at: string | null;
  tags: TagInfo[];
  source?: "generation" | "upload";
}

interface ImageDimensions {
  width: number;
  height: number;
}

// Helper to safely check if config is multi-speaker
function isMultiSpeakerConfig(config: AudioVoiceConfig | AudioSpeakerConfig | string | null | undefined): boolean {
  if (!config) return false;
  const parsed = typeof config === "string" ? JSON.parse(config) : config;
  return parsed && typeof parsed === "object" && "speakers" in parsed;
}

// Helper to safely get parsed voice config
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

interface GenerationsGalleryProps {
  projectId: number;
  currentUserId: number;
  onOpenConversation: (conversationId: number) => void;
  onReusePrompt?: (prompt: string, type: "image" | "video") => void;
}

export function GenerationsGallery({ projectId, currentUserId, onOpenConversation, onReusePrompt }: GenerationsGalleryProps) {
  const navigation = useNavigation();

  // Filter states
  const [filter, setFilter] = useState<FilterType>("all");
  const [qualityFilter, setQualityFilter] = useState<QualityFilterType>("all");
  const [favoriteFilter, setFavoriteFilter] = useState<FavoriteFilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [showUploads, setShowUploads] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  // Copy seed state
  const [copiedSeed, setCopiedSeed] = useState(false);

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

  // Topaz Studio state
  const [showTopazStudio, setShowTopazStudio] = useState(false);
  const [showTopazVideoStudio, setShowTopazVideoStudio] = useState(false);

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

      // Fetch generations
      const generationsRes = await fetch(`/api/projects/${projectId}/generations?${params}`);
      let allItems: Generation[] = [];
      let generationsTotal = 0;

      if (generationsRes.ok) {
        const data = await generationsRes.json();
        allItems = (data.data || []).map((g: Generation) => ({ ...g, source: "generation" as const }));
        generationsTotal = data.pagination.total;
        setHasMore(data.pagination.hasMore);
      }

      // Fetch uploads if enabled and filter allows images
      if (showUploads && filter !== "videos" && filter !== "audios") {
        const uploadsRes = await fetch(`/api/projects/${projectId}/uploads`);
        if (uploadsRes.ok) {
          const uploadsData = await uploadsRes.json();
          const uploads: Generation[] = (uploadsData || []).map((u: { id: number; image_url: string; created_at: string; original_filename?: string; file_size?: number; mime_type?: string }) => ({
            type: "image" as const,
            id: u.id,
            conversation_id: 0,
            conversation_user_id: currentUserId,
            conversation_title: u.original_filename || "Imagen subida",
            content: u.original_filename || null,
            quality_tier: null,
            generation_seed: null,
            is_favorite: false,
            image_url: u.image_url,
            image_mime_type: u.mime_type || null,
            image_file_size: u.file_size || null,
            image_aspect_ratio: null,
            image_size: null,
            has_2x: false,
            video_url: null,
            video_mime_type: null,
            video_file_size: null,
            video_duration: null,
            video_has_audio: null,
            video_aspect_ratio: null,
            audio_url: null,
            audio_mime_type: null,
            audio_file_size: null,
            audio_duration: null,
            audio_voice_config: null,
            created_at: u.created_at,
            deleted_at: null,
            tags: [],
            source: "upload" as const,
          }));
          allItems = [...allItems, ...uploads];
        }
      }

      // Sort by date, newest first
      allItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setGenerations(allItems);
      setTotal(generationsTotal + (showUploads ? allItems.filter(i => i.source === "upload").length : 0));
    } catch (err) {
      console.error("Error fetching generations:", err);
    } finally {
      setLoading(false);
    }
  }, [projectId, filter, debouncedSearch, selectedTagIds, showDeleted, showUploads, currentUserId]);

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

  // Apply quality and favorite filters early for navigation
  const filteredGenerations = generations.filter(g => {
    // Uploads don't have quality_tier, so exclude them from quality filtering
    if (qualityFilter !== "all" && g.source !== "upload" && g.quality_tier !== qualityFilter) return false;
    // Uploads can't be favorited, so exclude them from favorite filtering
    if (favoriteFilter === "favorites" && g.source !== "upload" && !g.is_favorite) return false;
    return true;
  });

  const selectedItem = selectedIndex !== null ? filteredGenerations[selectedIndex] : null;

  // Navigation
  const canGoPrev = selectedIndex !== null && selectedIndex > 0;
  const canGoNext = selectedIndex !== null && selectedIndex < filteredGenerations.length - 1;

  // Close the generation modal
  const closeGenerationModal = useCallback(() => {
    setSelectedIndex(null);
    setShowTagSelector(false);
    setShowTopazStudio(false);
    setShowTopazVideoStudio(false);
  }, []);

  // Handle deep linking - open specific generation if URL indicates it
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    if (!navigation.initialState || filteredGenerations.length === 0) return;

    const { type, id } = navigation.initialState;
    if ((type === 'generation' || type === 'topaz') && id) {
      // Find the generation by ID in filtered generations (since selectedIndex indexes into filteredGenerations)
      const index = filteredGenerations.findIndex(g => g.id === id);
      if (index !== -1) {
        deepLinkHandledRef.current = true;
        setSelectedIndex(index);
        // Register layer so back/escape will close the modal
        navigation.registerLayer(closeGenerationModal);

        // If topaz, also open Topaz Studio
        if (type === 'topaz') {
          setShowTopazStudio(true);
        }
      }
    }
  }, [navigation.initialState, filteredGenerations, navigation, closeGenerationModal]);

  // Open a generation with navigation
  const openGeneration = useCallback((index: number, gen: Generation) => {
    setSelectedIndex(index);
    navigation.openGeneration(gen.id, closeGenerationModal);
  }, [navigation, closeGenerationModal]);

  // Close via navigation (triggers back)
  const handleCloseModal = useCallback(() => {
    navigation.back();
  }, [navigation]);

  // Open Topaz Studio with URL navigation
  const openTopazStudio = useCallback(() => {
    if (!selectedItem) return;
    setShowTopazStudio(true);
    // Update URL to include /topaz
    if (navigation.projectSlug) {
      navigation.replace(`/${navigation.projectSlug}/gallery/${selectedItem.id}/topaz`);
    }
  }, [selectedItem, navigation]);

  // Close Topaz Studio and update URL back to generation
  const closeTopazStudio = useCallback(() => {
    setShowTopazStudio(false);
    // Update URL back to generation
    if (selectedItem && navigation.projectSlug) {
      navigation.replace(`/${navigation.projectSlug}/gallery/${selectedItem.id}`);
    }
  }, [selectedItem, navigation]);

  // Open Topaz Video Studio
  const openTopazVideoStudio = useCallback(() => {
    if (!selectedItem) return;
    setShowTopazVideoStudio(true);
    // Update URL to include /topaz-video
    if (navigation.projectSlug) {
      navigation.replace(`/${navigation.projectSlug}/gallery/${selectedItem.id}/topaz-video`);
    }
  }, [selectedItem, navigation]);

  // Close Topaz Video Studio and update URL back to generation
  const closeTopazVideoStudio = useCallback(() => {
    setShowTopazVideoStudio(false);
    // Update URL back to generation
    if (selectedItem && navigation.projectSlug) {
      navigation.replace(`/${navigation.projectSlug}/gallery/${selectedItem.id}`);
    }
  }, [selectedItem, navigation]);

  const goToPrev = useCallback(() => {
    if (canGoPrev && selectedIndex !== null) {
      const newIndex = selectedIndex - 1;
      const newGen = filteredGenerations[newIndex];
      setSelectedIndex(newIndex);
      // Update URL without pushing new history entry
      if (newGen && navigation.projectSlug) {
        navigation.replace(`/${navigation.projectSlug}/gallery/${newGen.id}`);
      }
    }
  }, [canGoPrev, selectedIndex, filteredGenerations, navigation]);

  const goToNext = useCallback(() => {
    if (canGoNext && selectedIndex !== null) {
      const newIndex = selectedIndex + 1;
      const newGen = filteredGenerations[newIndex];
      setSelectedIndex(newIndex);
      // Update URL without pushing new history entry
      if (newGen && navigation.projectSlug) {
        navigation.replace(`/${navigation.projectSlug}/gallery/${newGen.id}`);
      }
    }
  }, [canGoNext, selectedIndex, filteredGenerations, navigation]);

  // Keyboard navigation (Escape handled globally by NavigationProvider)
  useEffect(() => {
    if (selectedIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle keyboard when Topaz Studio is open
      if (showTopazStudio || showTopazVideoStudio) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToNext();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, goToPrev, goToNext, showTopazStudio, showTopazVideoStudio]);

  // Reset image dimensions when selection changes
  useEffect(() => {
    if (!selectedItem || selectedItem.type !== "image") {
      setImageDimensions(null);
    }
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

  const handleDeleteUpload = async (uploadId: number) => {
    if (!confirm("¿Eliminar esta imagen subida? Esta acción no se puede deshacer.")) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/uploads/${uploadId}`, { method: "DELETE" });
      if (res.ok) {
        setGenerations(prev => prev.filter(gen => !(gen.source === "upload" && gen.id === uploadId)));
        handleCloseModal();
      } else {
        const error = await res.json();
        alert(error.error || "Error al eliminar");
      }
    } catch (err) {
      console.error("Error deleting upload:", err);
      alert("Error al eliminar la imagen");
    }
  };

  const handleToggleFavorite = async (messageId: number, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    try {
      const res = await fetch(`/api/messages/${messageId}/favorite`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setGenerations(prev => prev.map(gen => {
          if (gen.id === messageId) {
            return { ...gen, is_favorite: data.is_favorite };
          }
          return gen;
        }));
      }
    } catch (err) {
      console.error("Error toggling favorite:", err);
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

      // Update local state to reflect has_2x
      if (result.has_2x && gen.source !== "upload") {
        setGenerations(prev => prev.map(g =>
          g.id === gen.id && g.source === gen.source ? { ...g, has_2x: true } : g
        ));
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

  const canUpscale = imageDimensions && imageDimensions.width <= 1920;

  // Counts (filteredGenerations is already defined above)
  const imageCount = filteredGenerations.filter(g => g.type === "image").length;
  const videoCount = filteredGenerations.filter(g => g.type === "video").length;
  const audioCount = filteredGenerations.filter(g => g.type === "audio").length;
  const hqCount = generations.filter(g => g.quality_tier === "hq").length;
  const favoriteCount = generations.filter(g => g.is_favorite).length;

  const tagColors = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#06b6d4"];

  // Copy seed to clipboard
  const handleCopySeed = (seed: number) => {
    navigator.clipboard.writeText(seed.toString());
    setCopiedSeed(true);
    setTimeout(() => setCopiedSeed(false), 2000);
  };

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
            {(["all", "images", "videos", "audios"] as FilterType[]).map((f) => (
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
                {f === "audios" && <Music className="h-4 w-4" />}
                {f === "all" ? "Todos" : f === "images" ? "Imágenes" : f === "videos" ? "Videos" : "Audios"}
              </button>
            ))}
          </div>

          {/* Quality Filter */}
          <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
            {(["all", "normal", "hq"] as QualityFilterType[]).map((q) => (
              <button
                key={q}
                onClick={() => setQualityFilter(q)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  qualityFilter === q
                    ? q === "hq"
                      ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white"
                      : "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {q === "hq" && <Sparkles className="h-3 w-3" />}
                {q === "all" ? "Todas" : q === "normal" ? "Normal" : "HQ"}
                {q === "hq" && hqCount > 0 && (
                  <span className="ml-0.5 opacity-60">({hqCount})</span>
                )}
              </button>
            ))}
          </div>

          {/* Favorites Filter */}
          <button
            onClick={() => setFavoriteFilter(favoriteFilter === "all" ? "favorites" : "all")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              favoriteFilter === "favorites"
                ? "bg-yellow-500/20 text-yellow-500"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <Star className={`h-4 w-4 ${favoriteFilter === "favorites" ? "fill-yellow-500" : ""}`} />
            Favoritos
            {favoriteCount > 0 && (
              <span className="opacity-60">({favoriteCount})</span>
            )}
          </button>

          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showUploads}
              onChange={(e) => setShowUploads(e.target.checked)}
              className="w-4 h-4 rounded accent-primary"
            />
            Subidas
          </label>

          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => setShowDeleted(e.target.checked)}
              className="w-4 h-4 rounded accent-primary"
            />
            Eliminados
          </label>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 p-1 bg-muted rounded-lg ml-auto">
            <button
              onClick={() => setViewMode("grid")}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                viewMode === "grid"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Grilla
            </button>
            <button
              onClick={() => setViewMode("calendar")}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                viewMode === "calendar"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Calendario
            </button>
          </div>
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
          {(imageCount > 0 || videoCount > 0 || audioCount > 0) && ` (`}
          {imageCount > 0 && `${imageCount} ${imageCount === 1 ? "imagen" : "imágenes"}`}
          {imageCount > 0 && (videoCount > 0 || audioCount > 0) && ", "}
          {videoCount > 0 && `${videoCount} ${videoCount === 1 ? "video" : "videos"}`}
          {videoCount > 0 && audioCount > 0 && ", "}
          {audioCount > 0 && `${audioCount} ${audioCount === 1 ? "audio" : "audios"}`}
          {(imageCount > 0 || videoCount > 0 || audioCount > 0) && `)`}
        </p>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {viewMode === "calendar" ? (
          /* Calendar View */
          <div className="max-w-4xl mx-auto">
            <ProjectCalendar
              projectId={projectId}
              currentUserId={currentUserId}
              onOpenConversation={onOpenConversation}
              compact={false}
            />
          </div>
        ) : filteredGenerations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <LayoutGrid className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-2">Sin generaciones</h3>
            <p className="text-muted-foreground text-sm max-w-md">
              {searchQuery || selectedTagIds.length > 0 || qualityFilter !== "all"
                ? "No hay resultados para los filtros seleccionados."
                : "Aún no hay generaciones en este proyecto."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredGenerations.map((gen, index) => (
              <div
                key={`${gen.source || "generation"}-${gen.type}-${gen.id}`}
                onClick={() => openGeneration(index, gen)}
                className={`group relative aspect-square rounded-lg overflow-hidden cursor-pointer bg-card border transition-all ${
                  gen.deleted_at
                    ? "border-red-500/30 opacity-60"
                    : "border-border/50 hover:border-primary/50"
                }`}
              >
                {gen.type === "image" && gen.image_url ? (
                  <NextImage
                    src={gen.image_url}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
                  />
                ) : gen.type === "video" && gen.video_url ? (
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
                ) : gen.type === "audio" && gen.audio_url ? (
                  <div className="w-full h-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex flex-col items-center justify-center p-4">
                    <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-3">
                      <Music className="w-8 h-8 text-primary" />
                    </div>
                    {gen.audio_duration && (
                      <span className="text-sm font-medium text-foreground">
                        {Math.floor(gen.audio_duration / 60)}:{(gen.audio_duration % 60).toString().padStart(2, "0")}
                      </span>
                    )}
                    {gen.audio_voice_config && (() => {
                      const parsedConfig = getParsedVoiceConfig(gen.audio_voice_config);
                      if (!parsedConfig) return null;
                      return (
                        <span className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          {isMultiSpeakerConfig(parsedConfig) ? (
                            <><Users className="h-3 w-3" /> {(parsedConfig as AudioSpeakerConfig).speakers.length} voces</>
                          ) : (
                            <><User className="h-3 w-3" /> {getVoiceById((parsedConfig as AudioVoiceConfig).voiceId)?.name || (parsedConfig as AudioVoiceConfig).voiceId}</>
                          )}
                        </span>
                      );
                    })()}
                  </div>
                ) : null}

                {/* Top-right badges */}
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  {/* HQ badge */}
                  {gen.quality_tier === "hq" && !gen.deleted_at && (
                    <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded px-1.5 py-0.5 text-[10px] text-white font-medium flex items-center gap-0.5">
                      <Sparkles className="h-2.5 w-2.5" />
                      HQ
                    </div>
                  )}
                  {/* Deleted indicator */}
                  {gen.deleted_at && (
                    <div className="bg-red-500/80 rounded px-1.5 py-0.5 text-[10px] text-white">
                      Eliminado
                    </div>
                  )}
                  {/* Upload indicator */}
                  {gen.source === "upload" && !gen.deleted_at && (
                    <div className="bg-blue-500/90 rounded px-1.5 py-0.5 text-[10px] text-white flex items-center gap-1">
                      <Upload className="h-2.5 w-2.5" />
                      Subida
                    </div>
                  )}
                </div>

                {/* Favorite star - always visible when favorited */}
                {/* Tags - top left corner */}
                {gen.tags.length > 0 && (
                  <div className="absolute top-2 left-2 flex gap-1 flex-wrap max-w-[80%] z-10">
                    {gen.tags.slice(0, 2).map((tag) => (
                      <span
                        key={tag.id}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium shadow-sm"
                        style={{ backgroundColor: `${tag.color}cc`, color: "white" }}
                      >
                        {tag.name}
                      </span>
                    ))}
                    {gen.tags.length > 2 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-black/60 text-white">
                        +{gen.tags.length - 2}
                      </span>
                    )}
                  </div>
                )}

                {/* Favorite star - bottom right corner (hidden on hover since overlay has its own) */}
                {gen.is_favorite && gen.source !== "upload" && (
                  <button
                    onClick={(e) => handleToggleFavorite(gen.id, e)}
                    className="absolute bottom-2 right-2 z-10 group-hover:opacity-0 transition-opacity"
                  >
                    <Star className="h-5 w-5 fill-yellow-400 text-yellow-400 drop-shadow-md" />
                  </button>
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
                  {/* Favorite toggle - bottom right */}
                  {gen.source !== "upload" && (
                    <button
                      onClick={(e) => handleToggleFavorite(gen.id, e)}
                      className="absolute bottom-2 right-2 p-1.5 rounded-md bg-black/50 hover:bg-black/70 transition-colors"
                    >
                      <Star className={`h-4 w-4 ${gen.is_favorite ? "fill-yellow-400 text-yellow-400" : "text-white/80"}`} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center" onClick={handleCloseModal}>
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
                {selectedItem.type === "image" ? <ImageIcon className="h-5 w-5 text-muted-foreground" /> : selectedItem.type === "video" ? <Video className="h-5 w-5 text-muted-foreground" /> : <Music className="h-5 w-5 text-muted-foreground" />}
                <h3 className="font-medium truncate">{selectedItem.conversation_title}</h3>
                <span className="text-sm text-muted-foreground">{selectedIndex !== null && `${selectedIndex + 1} / ${filteredGenerations.length}`}</span>
                {selectedItem.source === "upload" && <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded flex items-center gap-1"><Upload className="h-3 w-3" />Subida</span>}
                {selectedItem.deleted_at && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">Eliminado</span>}
              </div>
              <div className="flex items-center gap-2">
                {/* Favorite toggle button */}
                {selectedItem.source !== "upload" && (
                  <button
                    onClick={() => handleToggleFavorite(selectedItem.id)}
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
                <button onClick={handleCloseModal} className="p-2 hover:bg-accent rounded-lg">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black/50">
              {selectedItem.type === "image" && selectedItem.image_url ? (
                <div className="relative w-full h-[60vh]">
                  <NextImage
                    src={selectedItem.image_url}
                    alt=""
                    fill
                    className="object-contain rounded-lg"
                    sizes="(max-width: 1280px) 90vw, 1024px"
                    priority
                    onLoad={(e) => {
                      const img = e.target as HTMLImageElement;
                      setImageDimensions({
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                      });
                    }}
                  />
                </div>
              ) : selectedItem.type === "video" && selectedItem.video_url ? (
                <VideoPlayer
                  videoUrl={selectedItem.video_url}
                  duration={selectedItem.video_duration || undefined}
                  hasAudio={selectedItem.video_has_audio || false}
                  aspectRatio={selectedItem.video_aspect_ratio || "16:9"}
                  size="large"
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
                            <><Users className="h-4 w-4" /> {(parsedConfig as AudioSpeakerConfig).speakers.length} voces: {(parsedConfig as AudioSpeakerConfig).speakers.map(s => s.name).join(", ")}</>
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

            {/* Footer */}
            <div className="p-4 border-t border-border/50 space-y-3">
              {/* Meta info */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <FileType className="h-4 w-4" />
                  <span>{selectedItem.type === "image" ? getFileExtension(selectedItem.image_mime_type) : selectedItem.type === "video" ? "MP4" : getFileExtension(selectedItem.audio_mime_type)}</span>
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
                ) : (
                  <>
                    {selectedItem.audio_duration && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-4 w-4" />
                        <span>{Math.floor(selectedItem.audio_duration / 60)}:{(selectedItem.audio_duration % 60).toString().padStart(2, "0")}</span>
                      </div>
                    )}
                    {selectedItem.audio_voice_config && (() => {
                      const parsedConfig = getParsedVoiceConfig(selectedItem.audio_voice_config);
                      if (!parsedConfig) return null;
                      return (
                        <div className="flex items-center gap-1.5">
                          {isMultiSpeakerConfig(parsedConfig) ? (
                            <><Users className="h-4 w-4" /><span>{(parsedConfig as AudioSpeakerConfig).speakers.length} voces</span></>
                          ) : (
                            <><User className="h-4 w-4" /><span>{getVoiceById((parsedConfig as AudioVoiceConfig).voiceId)?.name}</span></>
                          )}
                        </div>
                      );
                    })()}
                    {formatFileSize(selectedItem.audio_file_size) && (
                      <div className="flex items-center gap-1.5">
                        <HardDrive className="h-4 w-4" />
                        <span>{formatFileSize(selectedItem.audio_file_size)}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  <span>{formatDateTimeLocal(selectedItem.created_at)}</span>
                </div>
                {/* Quality badge */}
                {selectedItem.quality_tier === "hq" && (
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-500">
                    <Sparkles className="h-4 w-4" />
                    <span className="font-medium">Alta Calidad</span>
                  </div>
                )}
                {/* Seed */}
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
                        {upscaling ? "Procesando..." : selectedItem.has_2x ? "Descargar @2x (listo)" : "Generar @2x"}
                      </Button>
                    )}
                    {imageDimensions && (
                      <Button
                        onClick={openTopazStudio}
                        className="flex-1 gap-2 text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
                        variant="outline"
                      >
                        <Wand2 className="h-4 w-4" /> Topaz Studio
                      </Button>
                    )}
                  </>
                ) : selectedItem.type === "video" ? (
                  <>
                    <Button onClick={() => handleDownload(selectedItem)} className="flex-1 gap-2" variant="outline">
                      <Download className="h-4 w-4" /> Descargar video
                    </Button>
                    <Button
                      onClick={openTopazVideoStudio}
                      className="flex-1 gap-2 text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
                      variant="outline"
                    >
                      <Wand2 className="h-4 w-4" /> Topaz Video
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => handleDownload(selectedItem)} className="flex-1 gap-2" variant="outline">
                    <Download className="h-4 w-4" /> Descargar audio
                  </Button>
                )}

                {/* Reuse prompt - only for generated images/videos with content */}
                {onReusePrompt && selectedItem.content && selectedItem.source !== "upload" && (selectedItem.type === "image" || selectedItem.type === "video") && (
                  <Button onClick={() => { handleCloseModal(); onReusePrompt(selectedItem.content!, selectedItem.type as "image" | "video"); }} className="flex-1 gap-2 text-blue-400 border-blue-500/30 hover:bg-blue-500/10" variant="outline">
                    <RotateCcw className="h-4 w-4" /> Reusar prompt
                  </Button>
                )}

                {selectedItem.conversation_user_id === currentUserId && (
                  <Button onClick={() => { handleCloseModal(); onOpenConversation(selectedItem.conversation_id); }} className="flex-1 gap-2" variant="outline">
                    <ExternalLink className="h-4 w-4" /> Ir a la conversación
                  </Button>
                )}

                {/* Delete - Only for uploads */}
                {selectedItem.source === "upload" && (
                  <Button onClick={() => handleDeleteUpload(selectedItem.id)} className="gap-2 text-red-400 border-red-500/30 hover:bg-red-500/10" variant="outline">
                    <Trash2 className="h-4 w-4" /> Eliminar
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Topaz Studio Modal */}
      {showTopazStudio && selectedItem && selectedItem.type === "image" && selectedItem.image_url && imageDimensions && (
        <TopazStudio
          imageUrl={selectedItem.image_url}
          messageId={selectedItem.source !== "upload" ? selectedItem.id : 0}
          imageDimensions={imageDimensions}
          onClose={closeTopazStudio}
        />
      )}

      {/* Topaz Video Studio Modal */}
      {showTopazVideoStudio && selectedItem && selectedItem.type === "video" && selectedItem.video_url && (
        <TopazStudioVideo
          videoUrl={selectedItem.video_url}
          messageId={selectedItem.source !== "upload" ? selectedItem.id : 0}
          videoMetadata={{
            duration: selectedItem.video_duration || 0,
            hasAudio: selectedItem.video_has_audio || false,
            aspectRatio: selectedItem.video_aspect_ratio || "16:9",
          }}
          onClose={closeTopazVideoStudio}
        />
      )}
    </div>
  );
}
