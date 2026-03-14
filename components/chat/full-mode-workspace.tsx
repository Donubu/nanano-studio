"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import NextImage from "next/image";
import {
  LayoutGrid, ImageIcon, Video, Settings, Star, Download, Trash2,
  Undo2, ZoomIn, X, Loader2, ChevronLeft, ChevronRight, VolumeX,
  Upload, Clock, ChevronUp, RectangleHorizontal, RectangleVertical, Square,
  AlertTriangle, Play, PanelLeft, PanelLeftClose, RotateCcw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageInput, AttachedFile, MessageInputHandle } from "./message-input";
import { type ReferenceImage } from "./video-input-frames";
import { TopazStudio } from "./topaz-studio";
import { TopazStudioVideo } from "./topaz-studio-video";
import { VideoPlayer } from "./video-player";
import { ProjectModel as ConfigModel } from "./quality-selector";
import { cn, formatDateTimeLocal } from "@/lib/utils";
import { useNavigation } from "@/contexts/navigation-context";
import type { ImagenAspectRatio } from "./image-settings";

// ---- Types ----

type MediaFilter = "all" | "images" | "videos" | "deleted";
type FullFormat = "image" | "video";
type VideoMode = "none" | "keyframes" | "ingredients";

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
  user_name: string | null;
  user_image: string | null;
  content: string | null;
  quality_tier: string | null;
  model_name: string | null;
  model_id: number | null;
  generation_seed: number | null;
  is_favorite: boolean;
  reference_images: Array<{ url: string; mime_type: string | null }>;
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
  audio_voice_config: null;
  music_url: string | null;
  music_mime_type: string | null;
  music_file_size: number | null;
  music_duration: number | null;
  music_config: null;
  created_at: string;
  deleted_at: string | null;
  tags: TagInfo[];
}

interface InProgressItem {
  id: number;
  type: "image" | "video";
  status: string;
  progress?: number;
}

interface GenerationConfigItem {
  generation_type: string;
  is_enabled: boolean;
  models: ConfigModel[];
}

interface FullModeWorkspaceProps {
  conversationId: number;
  projectId: number;
  messages: Array<{
    id: number;
    role: string;
    content: string;
    content_type?: string;
    image_url?: string | null;
    video_url?: string | null;
    isVideoGenerating?: boolean;
    videoProgress?: { status: string; message: string; progress?: number };
    isStreaming?: boolean;
  }>;
  isSending: boolean;
  generationConfig: GenerationConfigItem[];
  selectedConfigModelId: number | null;
  onSelectConfigModel: (id: number | null) => void;
  onSendImage: (content: string, files?: AttachedFile[], modelIdOverride?: number | null, imageSettings?: {
    aspectRatio: string; size: string; negativePrompt?: string; isImagen4?: boolean; seed?: number; numberOfImages?: number; supportsMultiImage?: boolean;
  }, generationTypeOverride?: "image", noContext?: boolean) => void;
  onSendVideo: (content: string, seed?: number, assetFiles?: AttachedFile[], numVariations?: number, videoInputsOverride?: { firstFrame?: string | null; lastFrame?: string | null; referenceImages?: ReferenceImage[] }) => void;
  onToggleFavorite: (messageId: number) => void;
  onArchiveMessage: (messageId: number) => void;
  videoDuration: number;
  videoAspectRatio: string;
  videoAudioEnabled: boolean;
  videoNegativePrompt: string;
  onVideoSettingsChange: (settings: { duration?: number; aspectRatio?: string; audioEnabled?: boolean; negativePrompt?: string }) => void;
  imageAspectRatio: string;
  imageSize: string;
  imageNegativePrompt: string;
  numberOfImages: number;
  onImageSettingsChange: (settings: { aspectRatio?: string; size?: string; negativePrompt?: string; numberOfImages?: number }) => void;
  reusePrompt: string | null;
  onReusePromptUsed: () => void;
  leftSidebarOpen: boolean;
  onToggleLeftSidebar: () => void;
}

// ---- Model capability helpers ----

function getVideoBackend(model: ConfigModel | undefined): "veo" | "xai" | "kling" | "kling26" | null {
  if (!model) return null;
  if (model.api_backend === "xai") return "xai";
  if (model.model_id === "kling-v2-6") return "kling26";
  if (model.api_backend === "kling" || model.model_id?.includes("kling")) return "kling";
  return "veo";
}

function getSupportedDurations(backend: ReturnType<typeof getVideoBackend>): number[] {
  switch (backend) {
    case "veo": return [4, 6, 8];
    case "xai": return [4, 6, 8, 15];
    case "kling": return [4, 6, 8, 15];
    case "kling26": return [5, 10];
    default: return [4, 6, 8];
  }
}

function getSupportedVideoAspectRatios(backend: ReturnType<typeof getVideoBackend>): string[] {
  switch (backend) {
    case "veo": return ["16:9", "9:16"];
    case "xai": return ["16:9", "9:16", "1:1", "4:3", "3:4"];
    case "kling": return ["16:9", "9:16", "1:1"];
    case "kling26": return ["16:9", "9:16", "1:1"];
    default: return ["16:9", "9:16"];
  }
}

function getMaxVideoVariations(backend: ReturnType<typeof getVideoBackend>): number {
  return backend === "veo" ? 4 : 1;
}

function supportsVideoKeyframes(backend: ReturnType<typeof getVideoBackend>): boolean {
  return backend !== null; // All backends support at least first frame
}

function supportsVideoIngredients(backend: ReturnType<typeof getVideoBackend>): boolean {
  return backend === "veo" || backend === "kling";
}

function supportsVideoAudio(backend: ReturnType<typeof getVideoBackend>): boolean {
  return backend === "veo" || backend === "kling" || backend === "kling26";
}

// ---- Component ----

export function FullModeWorkspace({
  conversationId,
  projectId,
  messages,
  isSending,
  generationConfig,
  selectedConfigModelId,
  onSelectConfigModel,
  onSendImage,
  onSendVideo,
  onToggleFavorite,
  onArchiveMessage,
  videoDuration,
  videoAspectRatio,
  videoAudioEnabled,
  videoNegativePrompt,
  onVideoSettingsChange,
  imageAspectRatio,
  imageSize,
  imageNegativePrompt,
  numberOfImages,
  onImageSettingsChange,
  reusePrompt,
  onReusePromptUsed,
  leftSidebarOpen,
  onToggleLeftSidebar,
}: FullModeWorkspaceProps) {
  const navigation = useNavigation();

  // ---- State ----
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [format, setFormat] = useState<FullFormat>("image");
  const [videoMode, setVideoMode] = useState<VideoMode>("none");
  const [numVariations, setNumVariations] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reuseWarning, setReuseWarning] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<Generation | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showTopaz, setShowTopaz] = useState(false);
  const [showTopazVideo, setShowTopazVideo] = useState(false);
  const [videoFirstFrame, setVideoFirstFrame] = useState<string | null>(null);
  const [videoLastFrame, setVideoLastFrame] = useState<string | null>(null);
  const [videoReferenceImages, setVideoReferenceImages] = useState<ReferenceImage[]>([]);
  const [veoAvailableSlots, setVeoAvailableSlots] = useState<number | null>(null);
  const [internalPrompt, setInternalPrompt] = useState<string | null>(null);
  // Track selected model per format independently
  const [selectedImageModelId, setSelectedImageModelId] = useState<number | null>(null);
  const [selectedVideoModelId, setSelectedVideoModelId] = useState<number | null>(null);
  // Kling asset tracking
  const [klingAssetList, setKlingAssetList] = useState<Array<{ assetId: string; type: string; label: string }>>([]);

  // Upload placeholders
  const [uploadingItems, setUploadingItems] = useState<Array<{ tempId: string; name: string; type: "image" | "video" }>>([]);

  // Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverTarget, setDragOverTarget] = useState<"first" | "last" | "reference" | null>(null);
  const [draggedMediaType, setDraggedMediaType] = useState<"image" | "video" | null>(null);
  const dragCounter = useRef(0);
  const messageInputRef = useRef<MessageInputHandle>(null);

  const gridRef = useRef<HTMLDivElement>(null);

  // ---- Derived: models & capabilities ----
  const imageConfig = generationConfig.find(c => c.generation_type === "image");
  const videoConfig = generationConfig.find(c => c.generation_type === "video");
  const imageModels = imageConfig?.models || [];
  const videoModels = videoConfig?.models || [];

  // Resolve active model per format using local state, falling back to project default
  const activeVideoModel = videoModels.find(m => m.id === selectedVideoModelId) || videoModels.find(m => m.is_default) || videoModels[0];
  const videoBackend = getVideoBackend(activeVideoModel);
  const isVeoProvider = format === "video" && videoBackend === "veo";
  const isKlingOmni = videoBackend === "kling"; // v3 Omni — supports inline assets with @mentions
  const isKling26 = videoBackend === "kling26"; // v2.6 — text/frames only
  const klingHasVideoInput = klingAssetList.some(a => a.type === "video");
  const klingMaxAssets = klingHasVideoInput ? 5 : 7;
  const isKlingAssetMode = format === "video" && isKlingOmni;

  const activeImageModel = imageModels.find(m => m.id === selectedImageModelId) || imageModels.find(m => m.is_default) || imageModels[0];
  const isImagen4 = activeImageModel?.model_id?.includes("imagen-4") || activeImageModel?.model_id?.includes("grok-imagine-image") || activeImageModel?.model_id?.includes("kling-omni-image");
  const supportsMultiImage = activeImageModel?.model_id?.includes("image-preview") || activeImageModel?.model_id?.includes("flash-image");

  // Current model for display
  const currentModel = format === "image" ? activeImageModel : activeVideoModel;

  // Sync parent selectedConfigModelId when format changes
  useEffect(() => {
    const model = format === "image" ? activeImageModel : activeVideoModel;
    if (model) onSelectConfigModel(model.id);
  }, [format]); // eslint-disable-line react-hooks/exhaustive-deps

  // Migrate or clear attached files when switching format or assetMode (model switch within video)
  const prevAssetMode = useRef(isKlingAssetMode);
  const prevFormat = useRef(format);
  useEffect(() => {
    if (prevFormat.current !== format || prevAssetMode.current !== isKlingAssetMode) {
      const prevFmt = prevFormat.current;
      const wasAssetMode = prevAssetMode.current;
      const currentFiles = messageInputRef.current?.getFiles() || [];

      if (prevFmt === format && format === "video") {
        // Same format (video), but model changed (assetMode toggled)
        if (!wasAssetMode && isKlingAssetMode) {
          // VEO → Kling Omni: migrate videoReferenceImages to Kling assets
          // Strip assetId so addFiles assigns fresh sequential IDs
          const imageFiles: AttachedFile[] = videoReferenceImages.map((ref, i) => ({
            dataUrl: ref.image,
            mimeType: "image/png",
            name: `reference_${i + 1}.png`,
            type: "image" as const,
            size: ref.image.length,
          }));
          setVideoReferenceImages([]);
          setVideoMode("none");
          messageInputRef.current?.clearFiles();
          if (imageFiles.length > 0) {
            // Use requestAnimationFrame to ensure React has committed the new assetMode prop
            requestAnimationFrame(() => messageInputRef.current?.addFiles(imageFiles));
          }
        } else if (wasAssetMode && !isKlingAssetMode) {
          // Kling Omni → VEO/other: migrate Kling image assets to videoReferenceImages
          const imageAssets = currentFiles.filter(f => f.type === "image");
          messageInputRef.current?.clearFiles();
          if (imageAssets.length > 0 && hasIngredients) {
            const refs = imageAssets.slice(0, 3).map(f => ({ image: f.dataUrl, type: "ASSET" as const }));
            setVideoReferenceImages(refs);
            setVideoMode("ingredients");
          }
        } else {
          messageInputRef.current?.clearFiles();
        }
      } else if (prevFmt === "image" && format === "video" && currentFiles.length > 0) {
        // Image → Video: migrate image references
        // Strip assetId from files so addFiles assigns fresh sequential IDs
        const imageFiles: AttachedFile[] = currentFiles.filter(f => f.type === "image").map(({ assetId, ...rest }) => rest);
        if (isKlingAssetMode) {
          // Kling Omni: re-add as assets
          messageInputRef.current?.clearFiles();
          if (imageFiles.length > 0) {
            requestAnimationFrame(() => messageInputRef.current?.addFiles(imageFiles));
          }
        } else if (hasIngredients && imageFiles.length > 0) {
          // VEO/other: migrate to videoReferenceImages (max 3)
          const refs = imageFiles.slice(0, 3).map(f => ({ image: f.dataUrl, type: "ASSET" as const }));
          setVideoReferenceImages(refs);
          setVideoMode("ingredients");
          messageInputRef.current?.clearFiles();
        } else {
          messageInputRef.current?.clearFiles();
        }
      } else if (prevFmt === "video" && format === "image") {
        // Video → Image: migrate references back to file attachments
        const allRefs = [
          ...videoReferenceImages.map((ref, i) => ({
            dataUrl: ref.image,
            mimeType: "image/png",
            name: `reference_${i + 1}.png`,
            type: "image" as const,
            size: ref.image.length,
          })),
          ...currentFiles.filter(f => f.type === "image"),
        ];
        setVideoReferenceImages([]);
        messageInputRef.current?.clearFiles();
        if (allRefs.length > 0) {
          requestAnimationFrame(() => messageInputRef.current?.addFiles(allRefs));
        }
      } else {
        messageInputRef.current?.clearFiles();
      }

      prevFormat.current = format;
      prevAssetMode.current = isKlingAssetMode;
    }
  }, [format, isKlingAssetMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle model selection: save per-format and notify parent
  // Note: file migration between video models (VEO↔Kling) is handled by the useEffect on isKlingAssetMode
  const handleSelectModel = useCallback((id: number) => {
    if (format === "image") {
      setSelectedImageModelId(id);
    } else {
      setSelectedVideoModelId(id);
    }
    onSelectConfigModel(id);
  }, [format, onSelectConfigModel]);

  // Video capability checks
  const supportedDurations = getSupportedDurations(videoBackend);
  const supportedVideoAR = getSupportedVideoAspectRatios(videoBackend);
  const maxVideoVariations = getMaxVideoVariations(videoBackend);
  const hasKeyframes = supportsVideoKeyframes(videoBackend);
  const hasIngredients = supportsVideoIngredients(videoBackend);
  const hasAudioToggle = supportsVideoAudio(videoBackend);

  // In-progress items from messages
  const inProgressItems: InProgressItem[] = messages
    .filter(m => m.role === "model" && (m.isVideoGenerating || m.isStreaming) && !m.image_url && !m.video_url)
    .map(m => ({
      id: m.id,
      type: m.content_type === "video" || m.isVideoGenerating ? "video" as const : "image" as const,
      status: m.videoProgress?.message || (m.isStreaming ? "Generando imagen..." : "Procesando..."),
      progress: m.videoProgress?.progress,
    }));

  // Error items from messages (failed generations)
  const errorItems = messages
    .filter(m => m.role === "model" && !m.isVideoGenerating && !m.isStreaming && !m.image_url && !m.video_url && m.content && m.content.startsWith("Error:"))
    .map(m => ({
      id: m.id,
      type: (m.content_type === "video" ? "video" : "image") as "image" | "video",
      message: m.content.replace(/^Error:\s*/, ""),
    }));

  // Filtered generations
  const activeGenerations = generations.filter(g => !g.deleted_at);
  const deletedGenerations = generations.filter(g => !!g.deleted_at);
  const filteredGenerations = filter === "deleted"
    ? deletedGenerations
    : activeGenerations.filter(g => {
        if (filter === "images") return g.type === "image";
        if (filter === "videos") return g.type === "video";
        return true;
      });

  const hasImages = activeGenerations.some(g => g.type === "image");
  const hasVideos = activeGenerations.some(g => g.type === "video");
  const hasDeleted = deletedGenerations.length > 0;

  // ---- Auto-correct settings when model changes ----
  useEffect(() => {
    if (format === "video") {
      if (!supportedDurations.includes(videoDuration)) {
        onVideoSettingsChange({ duration: supportedDurations[supportedDurations.length - 1] });
      }
      if (!supportedVideoAR.includes(videoAspectRatio)) {
        onVideoSettingsChange({ aspectRatio: supportedVideoAR[0] });
      }
      if (numVariations > maxVideoVariations) {
        setNumVariations(maxVideoVariations);
      }
      if (videoMode === "ingredients" && !hasIngredients) {
        setVideoMode("none");
      }
      if (videoMode === "keyframes" && !hasKeyframes) {
        setVideoMode("none");
      }
    }
  }, [activeVideoModel?.id, format]);

  // ---- Data fetching ----
  const fetchGenerations = useCallback(async () => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/generations`);
      if (res.ok) {
        const data = await res.json();
        setGenerations(data);
      }
    } catch (err) {
      console.error("Error fetching generations:", err);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (conversationId > 0) {
      fetchGenerations();
    } else {
      setLoading(false);
    }
  }, [conversationId, fetchGenerations]);

  // Refresh when in-progress items complete
  const prevInProgressCount = useRef(inProgressItems.length);
  useEffect(() => {
    if (prevInProgressCount.current > 0 && inProgressItems.length < prevInProgressCount.current) {
      fetchGenerations();
    }
    prevInProgressCount.current = inProgressItems.length;
  }, [inProgressItems.length, fetchGenerations]);

  // Poll VEO slots
  useEffect(() => {
    if (!isVeoProvider) { setVeoAvailableSlots(null); return; }
    const fetchSlots = async () => {
      try {
        const res = await fetch("/api/veo-slots");
        if (res.ok) {
          const data = await res.json();
          setVeoAvailableSlots(data.available);
          if (data.available > 0 && numVariations > data.available) setNumVariations(data.available);
        }
      } catch { /* ignore */ }
    };
    fetchSlots();
    const interval = setInterval(fetchSlots, 10000);
    return () => clearInterval(interval);
  }, [isVeoProvider]);

  // ---- Handlers ----

  // Upload external file to grid (from file picker, paste, or desktop drag — NOT from grid drag)
  const handleExternalFileAdded = useCallback(async (file: AttachedFile) => {
    if (!file.dataUrl || (!file.type.startsWith?.("image") && file.type !== "image" && file.type !== "video")) return;
    const tempId = `upload_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const fileType = (file.type === "video" ? "video" : "image") as "image" | "video";

    // Show placeholder while uploading
    setUploadingItems(prev => [...prev, { tempId, name: file.name, type: fileType }]);

    // Detect aspect ratio from image dimensions
    let detectedAspectRatio: string | undefined;
    if (fileType === "image" && file.dataUrl) {
      try {
        const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = reject;
          img.src = file.dataUrl!;
        });
        if (dims.w > 0 && dims.h > 0) {
          const r = dims.w / dims.h;
          if (Math.abs(r - 16 / 9) < 0.1) detectedAspectRatio = "16:9";
          else if (Math.abs(r - 9 / 16) < 0.1) detectedAspectRatio = "9:16";
          else if (Math.abs(r - 4 / 3) < 0.1) detectedAspectRatio = "4:3";
          else if (Math.abs(r - 3 / 4) < 0.1) detectedAspectRatio = "3:4";
          else if (Math.abs(r - 1) < 0.1) detectedAspectRatio = "1:1";
          else detectedAspectRatio = `${dims.w}:${dims.h}`;
        }
      } catch { /* ignore detection errors */ }
    }

    try {
      const res = await fetch(`/api/conversations/${conversationId}/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataUrl: file.dataUrl,
          mimeType: file.mimeType,
          name: file.name,
          aspectRatio: detectedAspectRatio,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        // Replace placeholder with real grid item
        const newGen: Generation = {
          type: data.type,
          id: data.id,
          conversation_id: conversationId,
          conversation_user_id: 0,
          conversation_title: "",
          user_name: null,
          user_image: null,
          content: `Archivo subido: ${data.name}`,
          quality_tier: null,
          model_name: null,
          model_id: null,
          generation_seed: null,
          reference_images: [],
          is_favorite: false,
          image_url: data.type === "image" ? data.url : null,
          image_mime_type: data.type === "image" ? data.mimeType : null,
          image_file_size: data.type === "image" ? data.fileSize : null,
          image_aspect_ratio: data.type === "image" ? (detectedAspectRatio || null) : null,
          image_size: null,
          has_2x: false,
          video_url: data.type === "video" ? data.url : null,
          video_mime_type: data.type === "video" ? data.mimeType : null,
          video_file_size: data.type === "video" ? data.fileSize : null,
          video_duration: null,
          video_has_audio: null,
          video_aspect_ratio: data.type === "video" ? (detectedAspectRatio || null) : null,
          audio_url: null, audio_mime_type: null, audio_file_size: null, audio_duration: null, audio_voice_config: null,
          music_url: null, music_mime_type: null, music_file_size: null, music_duration: null, music_config: null,
          created_at: new Date().toISOString(),
          deleted_at: null,
          tags: [],
        };
        setGenerations(prev => [newGen, ...prev]);
      }
    } catch (err) {
      console.error("Error uploading external file:", err);
    } finally {
      setUploadingItems(prev => prev.filter(u => u.tempId !== tempId));
    }
  }, [conversationId]);

  const handleSend = (content: string, files?: AttachedFile[]) => {
    if (!content.trim()) return;
    if (format === "video") {
      onSendVideo(content, undefined, files, numVariations, {
        firstFrame: videoFirstFrame,
        lastFrame: videoLastFrame,
        referenceImages: videoReferenceImages.length > 0 ? videoReferenceImages : undefined,
      });
      setVideoFirstFrame(null);
      setVideoLastFrame(null);
      setVideoReferenceImages([]);
    } else {
      const imgSettings = {
        aspectRatio: imageAspectRatio,
        size: imageSize,
        negativePrompt: imageNegativePrompt || undefined,
        isImagen4: !!isImagen4,
        numberOfImages: numVariations,
        supportsMultiImage: !!supportsMultiImage,
      };
      onSendImage(content, files, undefined, imgSettings, "image", true);
    }
  };

  const handleToggleFavorite = async (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onToggleFavorite(id);
    setGenerations(prev => prev.map(g => g.id === id ? { ...g, is_favorite: !g.is_favorite } : g));
  };

  const handleDelete = async (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onArchiveMessage(id);
    // Find the generation to get its URL and remove from references
    const gen = generations.find(g => g.id === id);
    if (gen) {
      const url = gen.image_url || gen.video_url;
      if (url) {
        // Remove from VEO reference images (match by sourceUrl or image)
        setVideoReferenceImages(prev => prev.filter(ref => ref.sourceUrl !== url && ref.image !== url));
        // Remove from MessageInput attached files (match by sourceUrl)
        messageInputRef.current?.removeFileByUrl(url);
      }
    }
    setGenerations(prev => prev.map(g => g.id === id ? { ...g, deleted_at: new Date().toISOString() } : g));
  };

  const handleRestore = async (id: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const res = await fetch(`/api/messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      if (res.ok) {
        setGenerations(prev => prev.map(g => g.id === id ? { ...g, deleted_at: null } : g));
      }
    } catch (err) {
      console.error("Error restoring message:", err);
    }
  };

  const handleDownload = async (gen: Generation) => {
    const url = gen.image_url || gen.video_url;
    if (!url) return;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const ext = gen.image_mime_type?.split("/")[1] || gen.video_mime_type?.split("/")[1] || (gen.type === "video" ? "mp4" : "png");
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${gen.type}_${gen.id}.${ext}`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, "_blank");
    }
  };

  const handleReusePrompt = async (gen: Generation, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!gen.content) return;

    // 1. Switch format
    setFormat(gen.type);

    // 2. Restore model selection
    if (gen.model_id) {
      if (gen.type === "image") {
        const matchedModel = imageModels.find(m => m.id === gen.model_id);
        if (matchedModel) setSelectedImageModelId(matchedModel.id);
      } else {
        const matchedModel = videoModels.find(m => m.id === gen.model_id);
        if (matchedModel) setSelectedVideoModelId(matchedModel.id);
      }
    }

    // 3. Restore settings
    if (gen.type === "image") {
      const updates: Record<string, string | number> = {};
      if (gen.image_aspect_ratio) updates.aspectRatio = gen.image_aspect_ratio;
      if (gen.image_size) updates.size = gen.image_size;
      if (Object.keys(updates).length > 0) onImageSettingsChange(updates);
    } else {
      const updates: Record<string, string | number | boolean> = {};
      if (gen.video_aspect_ratio) updates.aspectRatio = gen.video_aspect_ratio;
      if (gen.video_duration) updates.duration = gen.video_duration;
      if (gen.video_has_audio != null) updates.audioEnabled = gen.video_has_audio;
      if (Object.keys(updates).length > 0) onVideoSettingsChange(updates);
    }

    // 4. Restore reference images / assets
    // Clear existing first
    messageInputRef.current?.clearFiles();
    setVideoReferenceImages([]);
    setVideoFirstFrame(null);
    setVideoLastFrame(null);

    const refImages = gen.reference_images || [];
    const unavailableRefs: string[] = [];

    if (refImages.length > 0) {
      // Determine which model will be active after state updates
      const targetModel = gen.type === "video"
        ? (gen.model_id ? videoModels.find(m => m.id === gen.model_id) : null) || activeVideoModel
        : (gen.model_id ? imageModels.find(m => m.id === gen.model_id) : null) || activeImageModel;
      const targetBackend = gen.type === "video" ? getVideoBackend(targetModel) : null;
      const targetIsKlingOmni = targetBackend === "kling";

      // Fetch reference images and convert to AttachedFile
      const loadedFiles: AttachedFile[] = [];
      for (const ref of refImages) {
        try {
          const res = await fetch(ref.url);
          if (!res.ok) throw new Error("not found");
          const blob = await res.blob();
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          const isVideo = blob.type.startsWith("video/");
          loadedFiles.push({
            dataUrl: base64,
            mimeType: blob.type || ref.mime_type || "image/png",
            name: `ref_${loadedFiles.length + 1}.${blob.type.split("/")[1] || "png"}`,
            type: isVideo ? "video" : "image",
            size: blob.size,
          });
        } catch {
          unavailableRefs.push(ref.url);
        }
      }

      if (loadedFiles.length > 0) {
        if (gen.type === "image" || targetIsKlingOmni) {
          // Image mode or Kling Omni: inject as files (Kling will get asset labels)
          requestAnimationFrame(() => messageInputRef.current?.addFiles(loadedFiles));
        } else if (gen.type === "video") {
          // VEO/other: set as video reference images
          const refs = loadedFiles
            .filter(f => f.type === "image")
            .slice(0, 3)
            .map(f => ({ image: f.dataUrl, type: "ASSET" as const }));
          if (refs.length > 0) {
            setVideoReferenceImages(refs);
            setVideoMode("ingredients");
          }
        }
      }
    }

    // 5. Restore prompt text (transform Kling <<<image_N>>> back to @assetN)
    let prompt = gen.content;
    const targetModel = gen.type === "video"
      ? (gen.model_id ? videoModels.find(m => m.id === gen.model_id) : null) || activeVideoModel
      : null;
    const targetIsKlingOmni = targetModel ? getVideoBackend(targetModel) === "kling" : false;

    if (targetIsKlingOmni) {
      // Transform <<<image_N>>> or <<<video_N>>> back to @assetN
      prompt = prompt.replace(/<<<(?:image|video)_(\d+)>>>/g, (_, num) => `@asset${num}`);
    }

    setInternalPrompt(prompt);

    // 6. Show toast for unavailable references
    if (unavailableRefs.length > 0) {
      // Use a simple approach: set a temporary state for notification
      setReuseWarning(`${unavailableRefs.length} referencia(s) no disponible(s) (eliminadas o inaccesibles)`);
      setTimeout(() => setReuseWarning(null), 5000);
    }
  };

  const openGeneration = (index: number, gen: Generation) => {
    setSettingsOpen(false);
    setSelectedItem(gen);
    setSelectedIndex(index);
  };

  const handleCloseModal = () => {
    setSelectedItem(null);
    setSelectedIndex(null);
    setShowTopaz(false);
    setShowTopazVideo(false);
  };

  const goToPrev = () => {
    if (selectedIndex !== null && selectedIndex > 0) {
      const newIdx = selectedIndex - 1;
      setSelectedItem(filteredGenerations[newIdx]);
      setSelectedIndex(newIdx);
    }
  };

  const goToNext = () => {
    if (selectedIndex !== null && selectedIndex < filteredGenerations.length - 1) {
      const newIdx = selectedIndex + 1;
      setSelectedItem(filteredGenerations[newIdx]);
      setSelectedIndex(newIdx);
    }
  };

  // Register navigation layer when modal opens so Escape closes modal, not conversation
  const modalLayerRegistered = useRef(false);
  useEffect(() => {
    if (selectedItem && !modalLayerRegistered.current) {
      navigation.registerLayer(() => {
        setSelectedItem(null);
        setSelectedIndex(null);
        setShowTopaz(false);
        setShowTopazVideo(false);
      });
      modalLayerRegistered.current = true;
    }
    if (!selectedItem) {
      modalLayerRegistered.current = false;
    }
  }, [selectedItem]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close settings dropdown on any focus loss (window blur, visibility change)
  useEffect(() => {
    if (!settingsOpen) return;
    const close = () => setSettingsOpen(false);
    window.addEventListener("blur", close);
    document.addEventListener("visibilitychange", close);
    return () => {
      window.removeEventListener("blur", close);
      document.removeEventListener("visibilitychange", close);
    };
  }, [settingsOpen]);

  // Escape handler: close settings dropdown, or absorb Escape to prevent conversation close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // If modal is open, navigation layer handles it — let it through
      if (selectedItem) return;
      // If settings dropdown is open, close it
      if (settingsOpen) {
        e.preventDefault();
        e.stopPropagation();
        setSettingsOpen(false);
        return;
      }
      // In full mode, absorb Escape so it doesn't close the conversation
      e.preventDefault();
      e.stopPropagation();
    };
    // Use capture phase to intercept before navigation context
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [selectedItem, settingsOpen]);

  // Arrow key navigation for modal
  useEffect(() => {
    if (!selectedItem) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goToPrev();
      if (e.key === "ArrowRight") goToNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedItem, selectedIndex, filteredGenerations.length]);

  // ---- Drag-and-drop handlers ----
  // Determine what drop zones to show based on current format/mode
  // Show frame zones only when user has explicitly selected keyframes mode
  const showFrameDropZones = isDragging && format === "video" && videoMode === "keyframes";
  // Show reference zone in all other cases (image mode, video text/ingredients mode)
  const showReferenceDropZone = isDragging && !showFrameDropZones;

  // Can accept reference/asset drops? Check model support and dragged media type
  const canAcceptReferences = (() => {
    if (format === "image") {
      // Image mode only accepts images as references
      if (draggedMediaType === "video") return false;
      return !!activeImageModel;
    }
    // Kling Omni uses inline assets (images + videos via @mentions)
    if (isKlingOmni) return true;
    // VEO supports reference images only (not videos)
    if (draggedMediaType === "video") return false;
    return hasIngredients;
  })();

  // Reason why references can't be accepted (for UI message)
  const referenceDisabledReason = (() => {
    if (canAcceptReferences) return null;
    if (format === "image" && draggedMediaType === "video") {
      return "No se pueden usar videos como referencia en modo imagen";
    }
    if (format === "video") {
      if (draggedMediaType === "video" && !isKlingOmni) {
        return `${currentModel?.display_name || "Este modelo"} no soporta videos como referencia`;
      }
      return `${currentModel?.display_name || "Este modelo"} no soporta referencias`;
    }
    return `${currentModel?.display_name || "Este modelo"} no soporta referencias`;
  })();

  const handleWorkspaceDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) setIsDragging(true);
  };

  const handleWorkspaceDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
      setDragOverTarget(null);
    }
  };

  const handleWorkspaceDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleWorkspaceDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    setDragOverTarget(null);
  };

  const handleFrameDrop = async (target: "first" | "last", e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    setDragOverTarget(null);
    const media = await extractDragMedia(e);
    if (!media || media.mediaType !== "image") return;

    // Upload external files to grid
    if (media.isExternal) {
      handleExternalFileAdded({
        dataUrl: media.base64,
        mimeType: media.mimeType,
        name: `frame_${Date.now()}.${media.mimeType.split("/")[1] || "png"}`,
        type: "image",
        size: media.base64.length,
      });
    }

    if (target === "first") setVideoFirstFrame(media.base64);
    else setVideoLastFrame(media.base64);
  };

  const extractDragMedia = async (e: React.DragEvent): Promise<{ base64: string; mediaType: "image" | "video"; mimeType: string; isExternal: boolean; sourceUrl?: string } | null> => {
    // Check for nanano image data (from grid items — already in grid)
    const nanonoData = e.dataTransfer.getData("application/x-nanano-image");
    if (nanonoData) {
      try {
        const parsed = JSON.parse(nanonoData);
        const res = await fetch(parsed.url);
        const blob = await res.blob();
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        return { base64, mediaType: parsed.mediaType || "image", mimeType: blob.type || "image/png", isExternal: false, sourceUrl: parsed.url };
      } catch { return null; }
    }
    // Check for files (from desktop/external — needs upload to grid)
    const file = e.dataTransfer.files[0];
    if (file && (file.type.startsWith("image/") || file.type.startsWith("video/"))) {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      return { base64, mediaType: file.type.startsWith("video/") ? "video" : "image", mimeType: file.type, isExternal: true };
    }
    return null;
  };

  const handleReferenceDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    setDragOverTarget(null);
    const media = await extractDragMedia(e);
    if (!media) return;

    // Upload external files to grid
    if (media.isExternal) {
      const file: AttachedFile = {
        dataUrl: media.base64,
        mimeType: media.mimeType,
        name: `${media.mediaType}_${Date.now()}.${media.mimeType.split("/")[1] || "bin"}`,
        type: media.mediaType,
        size: media.base64.length,
      };
      handleExternalFileAdded(file);
    }

    if (format === "video" && isKlingOmni) {
      // Kling Omni: add as inline asset via MessageInput (supports images + videos)
      const file: AttachedFile = {
        dataUrl: media.base64,
        mimeType: media.mimeType,
        name: `${media.mediaType}_${Date.now()}.${media.mimeType.split("/")[1] || "bin"}`,
        type: media.mediaType,
        size: media.base64.length,
        sourceUrl: media.sourceUrl,
      };
      messageInputRef.current?.addFiles([file]);
    } else if (format === "video") {
      // VEO/other: only accept images as references
      if (media.mediaType !== "image") return;
      if (videoReferenceImages.length < 3) {
        setVideoReferenceImages(prev => [...prev, { image: media.base64, type: "ASSET", sourceUrl: media.sourceUrl }]);
        if (videoMode !== "ingredients") setVideoMode("ingredients");
      }
    } else {
      // Image mode: inject as attached file into MessageInput
      if (media.mediaType !== "image") return;
      const file: AttachedFile = {
        dataUrl: media.base64,
        mimeType: media.mimeType,
        name: `reference_${Date.now()}.${media.mimeType.split("/")[1] || "png"}`,
        type: "image",
        size: media.base64.length,
        sourceUrl: media.sourceUrl,
      };
      messageInputRef.current?.addFiles([file]);
    }
  };

  // ---- Summary label for compact badge ----
  const settingsSummary = (() => {
    const parts: string[] = [];
    if (format === "image") {
      parts.push(imageAspectRatio);
      if (currentModel) parts.push(currentModel.display_name);
    } else {
      parts.push(`${videoDuration}s`);
      parts.push(videoAspectRatio);
      if (currentModel) parts.push(currentModel.display_name);
    }
    if (numVariations > 1) parts.push(`x${numVariations}`);
    return parts.join(" · ");
  })();

  // ---- Render ----
  return (
    <div
      className="flex-1 flex flex-col overflow-hidden relative"
      onDragEnter={handleWorkspaceDragEnter}
      onDragLeave={handleWorkspaceDragLeave}
      onDragOver={handleWorkspaceDragOver}
      onDrop={handleWorkspaceDrop}
    >
      {/* Main area: filter bar + grid */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left filter bar */}
        <div className="w-10 flex flex-col items-center gap-1 py-2 border-r border-border/30 bg-card/30 shrink-0">
          <button
            onClick={onToggleLeftSidebar}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors mb-1"
            title={leftSidebarOpen ? "Ocultar panel" : "Mostrar panel"}
          >
            {leftSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </button>
          <div className="w-5 border-b border-border/50 my-1" />
          <FilterButton active={filter === "all"} onClick={() => setFilter("all")} icon={<LayoutGrid className="h-4 w-4" />} title="Todos" />
          {hasImages && <FilterButton active={filter === "images"} onClick={() => setFilter("images")} icon={<ImageIcon className="h-4 w-4" />} title="Imágenes" />}
          {hasVideos && <FilterButton active={filter === "videos"} onClick={() => setFilter("videos")} icon={<Video className="h-4 w-4" />} title="Videos" />}
          {hasDeleted && (
            <>
              <div className="w-5 border-b border-border/50 my-1" />
              <FilterButton active={filter === "deleted"} onClick={() => setFilter("deleted")} icon={<Trash2 className="h-4 w-4" />} title="Eliminados" />
            </>
          )}
        </div>

        {/* Media grid */}
        <div ref={gridRef} className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredGenerations.length === 0 && inProgressItems.length === 0 && errorItems.length === 0 && uploadingItems.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <LayoutGrid className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">
                  {generations.length === 0 ? "Escribe un prompt para empezar a generar" : "No hay resultados para este filtro"}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3 content-start">
              {/* Upload placeholders */}
              {uploadingItems.map(item => (
                <div key={item.tempId} className="group relative rounded-lg overflow-hidden bg-card border border-blue-500/30 animate-pulse" style={{ height: ROW_HEIGHT, width: ROW_HEIGHT }}>
                  <div className="flex flex-col items-center justify-center h-full gap-2 p-3">
                    <Upload className="h-6 w-6 animate-bounce text-blue-500" />
                    <p className="text-xs text-center text-muted-foreground line-clamp-2">Subiendo {item.name}...</p>
                  </div>
                </div>
              ))}
              {/* In-progress placeholders */}
              {inProgressItems.map(item => (
                <div key={`progress-${item.id}`} className="group relative rounded-lg overflow-hidden bg-card border border-primary/30 animate-pulse" style={{ height: ROW_HEIGHT, width: ROW_HEIGHT }}>
                  <div className="flex flex-col items-center justify-center h-full gap-2 p-3">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-xs text-center text-muted-foreground line-clamp-2">{item.status}</p>
                    {item.progress != null && item.progress > 0 && (
                      <div className="w-full max-w-[80%] h-1 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${item.progress}%` }} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {/* Error items */}
              {errorItems.map(item => (
                <div key={`error-${item.id}`} className="group relative rounded-lg overflow-hidden bg-destructive/10 border border-destructive/30" style={{ height: ROW_HEIGHT, width: ROW_HEIGHT }}>
                  <div className="flex flex-col items-center justify-center h-full gap-2 p-3">
                    <AlertTriangle className="h-6 w-6 text-destructive" />
                    <p className="text-xs text-center text-destructive line-clamp-3">{item.message}</p>
                  </div>
                  {/* Full error on hover */}
                  <div className="absolute inset-0 bg-destructive/10 backdrop-blur-sm rounded-lg p-3 opacity-0 group-hover:opacity-100 transition-opacity overflow-y-auto flex flex-col items-center justify-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                    <p className="text-[11px] text-center text-destructive leading-relaxed">{item.message}</p>
                  </div>
                </div>
              ))}
              {/* Generated items */}
              {filteredGenerations.map((gen, index) => (
                <GridItem key={`${gen.type}-${gen.id}`} gen={gen} index={index} onOpen={openGeneration} onFavorite={handleToggleFavorite} onDelete={handleDelete} onRestore={handleRestore} onDownload={handleDownload} onReuse={handleReusePrompt} onDragStarted={setDraggedMediaType} onDragEnded={() => setDraggedMediaType(null)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Warning toast for unavailable references */}
      {reuseWarning && (
        <div className="flex justify-center px-4 pb-1">
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 rounded-lg px-3 py-1.5 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{reuseWarning}</span>
            <button onClick={() => setReuseWarning(null)} className="ml-1 hover:text-foreground"><X className="h-3 w-3" /></button>
          </div>
        </div>
      )}

      {/* Bottom prompt bar */}
      <div className="bg-background/95 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 relative">
          {/* Drop zones overlay (absolute, on top of prompt) — always rendered, visibility toggled via CSS to avoid DOM changes during drag */}
          <div className={cn(
            "absolute inset-0 z-10 px-4 py-3 flex items-stretch transition-opacity",
            (showFrameDropZones || showReferenceDropZone) ? "opacity-100" : "opacity-0 pointer-events-none"
          )}>
            {showFrameDropZones ? (
              <div className="flex gap-3 w-full">
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOverTarget("first"); }}
                  onDragLeave={() => setDragOverTarget(null)}
                  onDrop={(e) => handleFrameDrop("first", e)}
                  className={cn(
                    "flex-1 rounded-lg border-2 border-dashed flex items-center justify-center gap-2 transition-colors",
                    dragOverTarget === "first"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/50 bg-background text-muted-foreground"
                  )}
                >
                  <Upload className="h-5 w-5" />
                  <span className="text-sm font-medium">Primer Frame</span>
                </div>
                {videoBackend !== "xai" && (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOverTarget("last"); }}
                    onDragLeave={() => setDragOverTarget(null)}
                    onDrop={(e) => handleFrameDrop("last", e)}
                    className={cn(
                      "flex-1 rounded-lg border-2 border-dashed flex items-center justify-center gap-2 transition-colors",
                      dragOverTarget === "last"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/50 bg-background text-muted-foreground"
                    )}
                  >
                    <Upload className="h-5 w-5" />
                    <span className="text-sm font-medium">Último Frame</span>
                  </div>
                )}
              </div>
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); if (canAcceptReferences) setDragOverTarget("reference"); }}
                onDragLeave={() => setDragOverTarget(null)}
                onDrop={canAcceptReferences ? handleReferenceDrop : (e: React.DragEvent) => { e.preventDefault(); dragCounter.current = 0; setIsDragging(false); setDragOverTarget(null); }}
                className={cn(
                  "flex-1 rounded-lg border-2 border-dashed flex items-center justify-center gap-2 transition-colors",
                  !canAcceptReferences
                    ? "border-border/30 bg-background text-muted-foreground/40 opacity-60"
                    : dragOverTarget === "reference"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/50 bg-background text-muted-foreground"
                )}
              >
                <Upload className="h-5 w-5" />
                <span className="text-sm font-medium">
                  {!canAcceptReferences
                    ? (referenceDisabledReason || `${currentModel?.display_name || "Este modelo"} no soporta referencias`)
                    : isKlingOmni
                      ? "Agregar como asset"
                      : "Agregar como referencia"}
                </span>
                {canAcceptReferences && format === "video" && !isKlingOmni && videoReferenceImages.length >= 3 && (
                  <span className="text-xs text-destructive ml-1">(máximo alcanzado)</span>
                )}
                {canAcceptReferences && isKlingOmni && klingAssetList.length >= klingMaxAssets && (
                  <span className="text-xs text-destructive ml-1">(máximo alcanzado)</span>
                )}
              </div>
            )}
          </div>

          {/* Prompt input (always mounted) */}
          <div className="flex items-end gap-2">
            {/* Compact video frame thumbnails inline (left of prompt) */}
            {format === "video" && videoMode !== "none" && (
              <div className="shrink-0 flex flex-col gap-1 bg-card border border-border/50 rounded-lg p-1.5">
                {videoMode === "keyframes" && (
                  <>
                    <CompactFrameSlot
                      image={videoFirstFrame}
                      label="1st"
                      onSet={setVideoFirstFrame}
                      onClear={() => setVideoFirstFrame(null)}
                      disabled={isSending}
                      projectId={projectId}
                    />
                    {videoBackend !== "xai" && (
                      <CompactFrameSlot
                        image={videoLastFrame}
                        label="End"
                        onSet={setVideoLastFrame}
                        onClear={() => setVideoLastFrame(null)}
                        disabled={isSending}
                        projectId={projectId}
                      />
                    )}
                  </>
                )}
                {videoMode === "ingredients" && (
                  <>
                    {videoReferenceImages.map((ref, i) => (
                      <CompactFrameSlot
                        key={i}
                        image={ref.image}
                        label={ref.type === "STYLE" ? "S" : "A"}
                        onSet={() => {}}
                        onClear={() => {
                          const next = [...videoReferenceImages];
                          next.splice(i, 1);
                          setVideoReferenceImages(next);
                        }}
                        disabled={isSending}
                        projectId={projectId}
                      />
                    ))}
                    {videoReferenceImages.length < 3 && (
                      <CompactFrameSlot
                        image={null}
                        label="+"
                        onSet={(img) => setVideoReferenceImages([...videoReferenceImages, { image: img, type: "ASSET" }])}
                        onClear={() => {}}
                        disabled={isSending}
                        projectId={projectId}
                      />
                    )}
                  </>
                )}
              </div>
            )}

            {/* Prompt input */}
            <div className="flex-1">
              <MessageInput
                ref={messageInputRef}
                onSend={(content, files) => handleSend(content, files)}
                disabled={isSending}
                placeholder={format === "video"
                  ? isKlingOmni ? "Describe el video... usa @asset para referenciar" : "Describe el video..."
                  : "Describe la imagen..."}
                supportsFiles={format === "image" || isKlingAssetMode}
                initialValue={internalPrompt || reusePrompt || undefined}
                onInitialValueUsed={() => { setInternalPrompt(null); if (reusePrompt) onReusePromptUsed(); }}
                assetMode={isKlingAssetMode}
                maxFilesOverride={isKlingAssetMode ? klingMaxAssets : undefined}
                onAssetsChange={isKlingAssetMode ? setKlingAssetList : undefined}
                onExternalFileAdded={handleExternalFileAdded}
                minimal
                extraActions={
                  <div className="shrink-0 relative">
                    <button
                      onClick={() => setSettingsOpen(!settingsOpen)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap h-10",
                        settingsOpen
                          ? "bg-primary/10 text-primary border-primary/30"
                          : "bg-card text-muted-foreground border-border/50 hover:text-foreground hover:border-border"
                      )}
                    >
                      {format === "image" ? <ImageIcon className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5" />}
                      {currentModel && <span>{currentModel.display_name}</span>}
                      <span className="text-muted-foreground/70">·</span>
                      {format === "video" && <><span>{videoDuration}s</span><span className="text-muted-foreground/70">·</span></>}
                      {(() => {
                        const ar = format === "image" ? imageAspectRatio : videoAspectRatio;
                        return ar === "16:9" || ar === "4:3" ? <RectangleHorizontal className="h-3 w-3" />
                          : ar === "9:16" || ar === "3:4" ? <RectangleVertical className="h-3 w-3" />
                          : <Square className="h-3 w-3" />;
                      })()}
                      {numVariations > 1 && <><span className="text-muted-foreground/70">·</span><span>x{numVariations}</span></>}
                      <ChevronUp className={cn("h-3 w-3 transition-transform ml-0.5", settingsOpen ? "" : "rotate-180")} />
                    </button>

                    {/* Dropdown panel - opens upward */}
                    {settingsOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setSettingsOpen(false)} />
                        <div className="absolute bottom-full right-0 mb-1 z-50 w-auto min-w-[300px] bg-card border border-border/50 rounded-lg shadow-xl p-3 space-y-3">
                        {/* Row 1: Format + Model */}
                        <div className="flex items-center gap-3">
                          <div className="flex gap-1 p-0.5 bg-muted rounded-md">
                            <button onClick={() => setFormat("image")} className={cn("flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors", format === "image" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                              <ImageIcon className="h-3 w-3" /> Imagen
                            </button>
                            <button onClick={() => setFormat("video")} className={cn("flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors", format === "video" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                              <Video className="h-3 w-3" /> Video
                            </button>
                          </div>
                          {(format === "image" ? imageModels : videoModels).length > 1 && (
                            <select
                              value={(format === "image" ? activeImageModel?.id : activeVideoModel?.id) || ""}
                              onChange={(e) => handleSelectModel(Number(e.target.value))}
                              className="text-xs bg-muted border-none rounded-md px-2 py-1.5 text-foreground focus:ring-1 focus:ring-primary"
                            >
                              {(format === "image" ? imageModels : videoModels).map(m => (
                                <option key={m.id} value={m.id}>{m.display_name}</option>
                              ))}
                            </select>
                          )}
                        </div>

                        {format === "image" ? (
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-muted-foreground">Aspecto</label>
                              <div className="flex gap-0.5">
                                {(["16:9", "9:16", "1:1", "4:3", "3:4"] as ImagenAspectRatio[]).map(ar => (
                                  <button key={ar} onClick={() => onImageSettingsChange({ aspectRatio: ar })} className={cn("px-1.5 py-1 rounded text-xs font-medium transition-colors", imageAspectRatio === ar ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{ar}</button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-muted-foreground">Cant.</label>
                              <div className="flex gap-0.5">
                                {[1, 2, 3, 4].map(n => (
                                  <button key={n} onClick={() => setNumVariations(n)} className={cn("w-6 py-1 rounded text-xs font-medium transition-colors text-center", numVariations === n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{n}</button>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-muted-foreground">Duracion</label>
                                <div className="flex gap-0.5">
                                  {supportedDurations.map(d => (
                                    <button key={d} onClick={() => onVideoSettingsChange({ duration: d })} className={cn("px-1.5 py-1 rounded text-xs font-medium transition-colors", videoDuration === d ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{d}s</button>
                                  ))}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-muted-foreground">Aspecto</label>
                                <div className="flex gap-0.5">
                                  {supportedVideoAR.map(ar => (
                                    <button key={ar} onClick={() => onVideoSettingsChange({ aspectRatio: ar })} className={cn("px-1.5 py-1 rounded text-xs font-medium transition-colors", videoAspectRatio === ar ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{ar}</button>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 flex-wrap">
                              {hasAudioToggle && (
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-muted-foreground">Audio</label>
                                  <button onClick={() => onVideoSettingsChange({ audioEnabled: !videoAudioEnabled })} className={cn("px-2 py-1 rounded text-xs font-medium transition-colors", videoAudioEnabled ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>
                                    {videoAudioEnabled ? "Si" : "No"}
                                  </button>
                                </div>
                              )}
                              {maxVideoVariations > 1 && (
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-muted-foreground">Cant.</label>
                                  <div className="flex gap-0.5">
                                    {Array.from({ length: maxVideoVariations }, (_, i) => i + 1).map(n => {
                                      const disabled = isVeoProvider && veoAvailableSlots !== null && n > veoAvailableSlots;
                                      return (
                                        <button key={n} onClick={() => !disabled && setNumVariations(n)} disabled={disabled} className={cn("w-6 py-1 rounded text-xs font-medium transition-colors text-center", disabled ? "bg-muted text-muted-foreground/30 cursor-not-allowed" : numVariations === n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{n}</button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                            {(hasKeyframes || hasIngredients) && (
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-muted-foreground">Modo</label>
                                <div className="flex gap-0.5">
                                  <button onClick={() => setVideoMode("none")} className={cn("px-1.5 py-1 rounded text-xs font-medium transition-colors", videoMode === "none" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>Texto</button>
                                  {hasKeyframes && <button onClick={() => setVideoMode("keyframes")} className={cn("px-1.5 py-1 rounded text-xs font-medium transition-colors", videoMode === "keyframes" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>Frames</button>}
                                  {hasIngredients && <button onClick={() => setVideoMode("ingredients")} className={cn("px-1.5 py-1 rounded text-xs font-medium transition-colors", videoMode === "ingredients" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>Referencias</button>}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  )}
                  </div>
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* Detail modal */}
      {selectedItem && !showTopaz && !showTopazVideo && (
        <DetailModal
          item={selectedItem}
          index={selectedIndex}
          total={filteredGenerations.length}
          onClose={handleCloseModal}
          onPrev={goToPrev}
          onNext={goToNext}
          onFavorite={handleToggleFavorite}
          onDelete={handleDelete}
          onRestore={handleRestore}
          onDownload={handleDownload}
          onReuse={(gen) => { handleReusePrompt(gen); handleCloseModal(); }}
          onTopaz={() => setShowTopaz(true)}
          onTopazVideo={() => setShowTopazVideo(true)}
        />
      )}

      {/* Topaz Studio modals */}
      {showTopaz && selectedItem?.image_url && (
        <TopazStudio imageUrl={selectedItem.image_url} messageId={selectedItem.id} imageDimensions={{ width: 1024, height: 1024 }} onClose={() => setShowTopaz(false)} />
      )}
      {showTopazVideo && selectedItem?.video_url && (
        <TopazStudioVideo videoUrl={selectedItem.video_url} messageId={selectedItem.id} videoMetadata={{ duration: selectedItem.video_duration || 8 }} onClose={() => setShowTopazVideo(false)} />
      )}
    </div>
  );
}

// ---- Helpers ----

const ROW_HEIGHT = 275;

function getAspectRatio(gen: Generation): number {
  const raw = gen.image_aspect_ratio || gen.video_aspect_ratio;
  if (raw) {
    const parts = raw.split(":");
    if (parts.length === 2) {
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (w > 0 && h > 0) return w / h;
    }
  }
  // Fallback: try image_size (e.g. "1024x1024")
  if (gen.image_size) {
    const parts = gen.image_size.split("x");
    if (parts.length === 2) {
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (w > 0 && h > 0) return w / h;
    }
  }
  return 1; // default square
}

// ---- Grid Item ----

function GridItem({ gen, index, onOpen, onFavorite, onDelete, onRestore, onDownload, onReuse, onDragStarted, onDragEnded }: {
  gen: Generation; index: number;
  onOpen: (i: number, g: Generation) => void;
  onFavorite: (id: number, e?: React.MouseEvent) => void;
  onDelete: (id: number, e?: React.MouseEvent) => void;
  onRestore: (id: number, e?: React.MouseEvent) => void;
  onDownload: (g: Generation) => void;
  onReuse: (g: Generation, e?: React.MouseEvent) => void;
  onDragStarted?: (mediaType: "image" | "video") => void;
  onDragEnded?: () => void;
}) {
  const ratio = getAspectRatio(gen);
  const itemWidth = Math.round(ROW_HEIGHT * ratio);

  return (
    <div
      onClick={() => onOpen(index, gen)}
      draggable={!!(gen.image_url || gen.video_url)}
      onDragStart={(e) => {
        const url = gen.image_url || gen.video_url;
        if (url) {
          e.dataTransfer.setData("application/x-nanano-image", JSON.stringify({ type: "chat-image", url, mediaType: gen.type }));
          e.dataTransfer.setData("text/uri-list", url);
          e.dataTransfer.effectAllowed = "copy";
          onDragStarted?.(gen.type as "image" | "video");
        }
      }}
      onDragEnd={() => onDragEnded?.()}
      style={{ height: ROW_HEIGHT, width: itemWidth }}
      className={cn(
        "group relative rounded-lg overflow-hidden cursor-pointer bg-card border transition-all shrink-0",
        gen.deleted_at ? "border-red-500/30 opacity-60" : "border-border/50 hover:border-primary/50",
        (gen.image_url || gen.video_url) && "cursor-grab active:cursor-grabbing"
      )}
      onMouseEnter={(e) => { if (gen.type === "video") { const v = e.currentTarget.querySelector("video"); v?.play(); } }}
      onMouseLeave={(e) => { if (gen.type === "video") { const v = e.currentTarget.querySelector("video"); if (v) { v.pause(); v.currentTime = 0; } } }}
    >
      {gen.type === "image" && gen.image_url ? (
        <img src={gen.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" draggable={false} />
      ) : gen.type === "video" && gen.video_url ? (
        <>
          <video src={gen.video_url} className="w-full h-full object-cover" preload="metadata" muted playsInline />
          <div className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity pointer-events-none">
            <div className="bg-black/50 rounded-full p-2">
              <Play className="h-6 w-6 text-white/90 fill-white/90" />
            </div>
          </div>
          {gen.video_has_audio === false && (
            <div className="absolute top-2 left-2 bg-black/60 rounded px-1.5 py-0.5"><VolumeX className="h-3 w-3 text-white/50" /></div>
          )}
        </>
      ) : null}

      {/* Top-right badges */}
      {gen.deleted_at && (
        <div className="absolute top-2 right-2">
          <div className="bg-red-500/80 rounded px-1.5 py-0.5 text-[10px] text-white">Eliminado</div>
        </div>
      )}

      {/* Tags */}
      {gen.tags.length > 0 && (
        <div className="absolute top-2 left-2 flex gap-1 flex-wrap max-w-[80%] z-10">
          {gen.tags.slice(0, 2).map(tag => (
            <span key={tag.id} className="px-1.5 py-0.5 rounded text-[10px] font-medium shadow-sm" style={{ backgroundColor: `${tag.color}cc`, color: "white" }}>{tag.name}</span>
          ))}
          {gen.tags.length > 2 && <span className="px-1.5 py-0.5 rounded text-[10px] bg-black/60 text-white">+{gen.tags.length - 2}</span>}
        </div>
      )}

      {/* Favorite star (visible when favorited, hidden on hover) */}
      {gen.is_favorite && !gen.deleted_at && (
        <button onClick={(e) => onFavorite(gen.id, e)} className="absolute bottom-2 right-2 z-10 group-hover:opacity-0 transition-opacity">
          <Star className="h-5 w-5 fill-yellow-400 text-yellow-400 drop-shadow-md" />
        </button>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {/* Top-right action buttons */}
        <div className="absolute top-2 right-2 flex items-center gap-1 pointer-events-auto">
          {!gen.deleted_at && gen.content && !gen.content.startsWith("Archivo subido:") && <button onClick={(e) => onReuse(gen, e)} className="p-1.5 rounded-md bg-black/50 hover:bg-black/70 transition-colors" title="Reutilizar prompt"><Undo2 className="h-3.5 w-3.5 text-white/80" /></button>}
          <button onClick={(e) => { e.stopPropagation(); onDownload(gen); }} className="p-1.5 rounded-md bg-black/50 hover:bg-black/70 transition-colors" title="Descargar"><Download className="h-3.5 w-3.5 text-white/80" /></button>
          {!gen.deleted_at && (
            <button onClick={(e) => onFavorite(gen.id, e)} className="p-1.5 rounded-md bg-black/50 hover:bg-black/70 transition-colors" title="Favorito">
              <Star className={`h-3.5 w-3.5 ${gen.is_favorite ? "fill-yellow-400 text-yellow-400" : "text-white/80"}`} />
            </button>
          )}
          {gen.deleted_at ? (
            <button onClick={(e) => onRestore(gen.id, e)} className="p-1.5 rounded-md bg-black/50 hover:bg-green-600/70 transition-colors" title="Restaurar"><RotateCcw className="h-3.5 w-3.5 text-white/80" /></button>
          ) : (
            <button onClick={(e) => onDelete(gen.id, e)} className="p-1.5 rounded-md bg-black/50 hover:bg-red-900/70 transition-colors" title="Eliminar"><Trash2 className="h-3.5 w-3.5 text-white/80" /></button>
          )}
          <div className="p-1.5 rounded-md bg-black/50" title="Ver detalle"><ZoomIn className="h-3.5 w-3.5 text-white/80" /></div>
        </div>
        {/* Bottom prompt strip */}
        <div className="absolute bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm px-2 py-1.5 pointer-events-auto">
          <p className="text-[10px] text-white/80 truncate">{gen.content || ""}</p>
        </div>
      </div>
    </div>
  );
}

// ---- Detail Modal ----

function DetailModal({ item, index, total, onClose, onPrev, onNext, onFavorite, onDelete, onRestore, onDownload, onReuse, onTopaz, onTopazVideo }: {
  item: Generation; index: number | null; total: number;
  onClose: () => void; onPrev: () => void; onNext: () => void;
  onFavorite: (id: number, e?: React.MouseEvent) => void;
  onDelete: (id: number, e?: React.MouseEvent) => void;
  onRestore: (id: number, e?: React.MouseEvent) => void;
  onDownload: (g: Generation) => void;
  onReuse: (g: Generation) => void;
  onTopaz: () => void; onTopazVideo: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center" onClick={onClose}>
      {index !== null && index > 0 && (
        <button onClick={(e) => { e.stopPropagation(); onPrev(); }} className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 hover:bg-black/70 z-10">
          <ChevronLeft className="h-8 w-8 text-white" />
        </button>
      )}
      {index !== null && index < total - 1 && (
        <button onClick={(e) => { e.stopPropagation(); onNext(); }} className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 hover:bg-black/70 z-10">
          <ChevronRight className="h-8 w-8 text-white" />
        </button>
      )}

      <div className="relative max-w-5xl w-full max-h-[90vh] flex flex-col bg-sidebar rounded-xl overflow-hidden mx-16" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            {item.type === "image" ? <ImageIcon className="h-5 w-5 text-muted-foreground" /> : <Video className="h-5 w-5 text-muted-foreground" />}
            <span className="text-sm text-muted-foreground">{index !== null && `${index + 1} / ${total}`}</span>
          </div>
          <div className="flex items-center gap-2">
            {!item.deleted_at && (
              <button onClick={() => onFavorite(item.id)} className={cn("p-2 rounded-lg transition-colors", item.is_favorite ? "bg-yellow-500/20 text-yellow-500" : "hover:bg-accent text-muted-foreground")}>
                <Star className={cn("h-5 w-5", item.is_favorite && "fill-current")} />
              </button>
            )}
            <button onClick={() => onDownload(item)} className="p-2 rounded-lg hover:bg-accent text-muted-foreground"><Download className="h-5 w-5" /></button>
            {!item.deleted_at && item.content && !item.content.startsWith("Archivo subido:") && <button onClick={() => onReuse(item)} className="p-2 rounded-lg hover:bg-accent text-muted-foreground" title="Reutilizar prompt"><Undo2 className="h-5 w-5" /></button>}
            {item.type === "image" && item.image_url && <Button variant="outline" size="sm" onClick={onTopaz}>Topaz Studio</Button>}
            {item.type === "video" && item.video_url && <Button variant="outline" size="sm" onClick={onTopazVideo}>Topaz Studio</Button>}
            {item.deleted_at ? (
              <button onClick={(e) => onRestore(item.id, e)} className="p-2 rounded-lg hover:bg-green-500/20 text-muted-foreground hover:text-green-500" title="Restaurar"><RotateCcw className="h-5 w-5" /></button>
            ) : (
              <button onClick={(e) => onDelete(item.id, e)} className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-500" title="Eliminar"><Trash2 className="h-5 w-5" /></button>
            )}
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-accent text-muted-foreground"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto flex items-center justify-center p-4 min-h-0">
          {item.type === "image" && item.image_url ? (
            <img src={item.image_url} alt="" className="max-w-full max-h-[70vh] object-contain rounded" />
          ) : item.type === "video" && item.video_url ? (
            <VideoPlayer videoUrl={item.video_url} hasAudio={item.video_has_audio ?? false} duration={item.video_duration || undefined} aspectRatio={item.video_aspect_ratio || undefined} />
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border/50 space-y-2">
          {item.content && <p className="text-sm text-foreground line-clamp-3">{item.content}</p>}
          {item.reference_images.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground shrink-0">Referencias:</span>
              <div className="flex gap-1.5">
                {item.reference_images.map((ref, i) => (
                  <img key={i} src={ref.url} alt={`Ref ${i + 1}`} className="h-8 w-8 rounded object-cover border border-border/50" />
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {item.model_name && <span>{item.model_name}</span>}
            {item.image_aspect_ratio && <span>{item.image_aspect_ratio}</span>}
            {item.video_aspect_ratio && <span>{item.video_aspect_ratio}</span>}
            {item.video_duration && <span>{item.video_duration}s</span>}
            {item.generation_seed && <span>Seed: {item.generation_seed}</span>}
            <span>{formatDateTimeLocal(item.created_at)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Compact Frame Slot ----

function CompactFrameSlot({ image, label, onSet, onClear, disabled, projectId }: {
  image: string | null; label: string;
  onSet: (img: string) => void; onClear: () => void;
  disabled: boolean; projectId: number;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const reader = new FileReader();
    reader.onloadend = () => onSet(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    // Check for nanano image data
    const nanonoData = e.dataTransfer.getData("application/x-nanano-image");
    if (nanonoData) {
      const { url } = JSON.parse(nanonoData);
      const res = await fetch(url);
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onloadend = () => onSet(reader.result as string);
      reader.readAsDataURL(blob);
      return;
    }
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  };

  if (image) {
    return (
      <div className="relative w-10 h-10 rounded overflow-hidden border border-border/50 group">
        <img src={image} alt="" className="w-full h-full object-cover" />
        <button onClick={onClear} className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
          <X className="h-3 w-3 text-white" />
        </button>
        <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[8px] text-white text-center leading-3">{label}</span>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={handleDrop}
        disabled={disabled}
        className="w-10 h-10 rounded border border-dashed border-border/50 hover:border-primary/50 flex flex-col items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        title={`Agregar ${label}`}
      >
        <Upload className="h-3 w-3" />
        <span className="text-[8px] leading-3 mt-0.5">{label}</span>
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </>
  );
}

// ---- Filter Button ----

function FilterButton({ active, onClick, icon, title }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string }) {
  return (
    <button onClick={onClick} className={cn("w-8 h-8 flex items-center justify-center rounded-md transition-colors", active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent")} title={title}>
      {icon}
    </button>
  );
}
