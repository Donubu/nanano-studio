"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Loader2, ExternalLink, Image as ImageIcon, Video, Calendar, FileType, Maximize2, RatioIcon, Ruler, Download, HardDrive, Volume2, VolumeX, Clock, ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoPlayer } from "./video-player";
import { formatDateTimeLocal } from "@/lib/utils";

type FilterType = "all" | "images" | "videos";

interface ImageGeneration {
  type: "image";
  id: number;
  conversation_id: number;
  conversation_user_id: number;
  conversation_title: string;
  image_url: string;
  image_mime_type: string;
  image_file_size: number | null;
  image_aspect_ratio: string;
  image_size: string;
  created_at: string;
}

interface VideoGeneration {
  type: "video";
  id: number;
  conversation_id: number;
  conversation_user_id: number;
  conversation_title: string;
  video_url: string;
  video_mime_type: string;
  video_file_size: number | null;
  video_duration: number | null;
  video_has_audio: boolean;
  video_aspect_ratio: string;
  created_at: string;
}

type Generation = ImageGeneration | VideoGeneration;

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
  const [filter, setFilter] = useState<FilterType>("all");
  const [images, setImages] = useState<ImageGeneration[]>([]);
  const [videos, setVideos] = useState<VideoGeneration[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [imageDimensions, setImageDimensions] = useState<ImageDimensions | null>(null);
  const [upscaling, setUpscaling] = useState(false);

  // Cargar imágenes y videos al montar
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [imagesRes, videosRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/generations`),
          fetch(`/api/projects/${projectId}/video-generations`),
        ]);

        if (imagesRes.ok) {
          const data = await imagesRes.json();
          setImages(data.map((img: Omit<ImageGeneration, "type">) => ({ ...img, type: "image" as const })));
        }

        if (videosRes.ok) {
          const data = await videosRes.json();
          setVideos(data.map((vid: Omit<VideoGeneration, "type">) => ({ ...vid, type: "video" as const })));
        }
      } catch (err) {
        console.error("Error fetching generations:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [projectId]);

  // Combinar y ordenar por fecha
  const allGenerations: Generation[] = [...images, ...videos].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // Filtrar según selección
  const filteredGenerations = allGenerations.filter((gen) => {
    if (filter === "all") return true;
    if (filter === "images") return gen.type === "image";
    if (filter === "videos") return gen.type === "video";
    return true;
  });

  const selectedItem = selectedIndex !== null ? filteredGenerations[selectedIndex] : null;

  // Navegación
  const canGoPrev = selectedIndex !== null && selectedIndex > 0;
  const canGoNext = selectedIndex !== null && selectedIndex < filteredGenerations.length - 1;

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
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, goToPrev, goToNext]);

  // Cargar dimensiones de imagen cuando se selecciona
  useEffect(() => {
    if (!selectedItem || selectedItem.type !== "image") {
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

  const getFileExtension = (mimeType: string | null) => {
    if (!mimeType) return "PNG";
    const ext = mimeType.split("/")[1]?.toUpperCase() || "PNG";
    return ext;
  };

  const formatAspectRatio = (ratio: string | null) => {
    if (!ratio) return null;
    return ratio;
  };

  const formatImageQuality = (size: string | null) => {
    if (!size) return null;
    const qualities: Record<string, string> = {
      "1K": "1K",
      "2K": "2K",
      "4K": "4K",
    };
    return qualities[size] || size;
  };

  const calculateAspectRatio = (width: number, height: number): string => {
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.05) return "1:1";
    if (Math.abs(ratio - 16/9) < 0.05) return "16:9";
    if (Math.abs(ratio - 9/16) < 0.05) return "9:16";
    if (Math.abs(ratio - 4/3) < 0.05) return "4:3";
    if (Math.abs(ratio - 3/4) < 0.05) return "3:4";
    if (Math.abs(ratio - 3/2) < 0.05) return "3:2";
    if (Math.abs(ratio - 2/3) < 0.05) return "2:3";
    if (Math.abs(ratio - 21/9) < 0.05) return "21:9";
    return `${ratio.toFixed(2)}:1`;
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleImageDownload = async (e: React.MouseEvent, gen: ImageGeneration) => {
    e.stopPropagation();
    try {
      const response = await fetch(gen.image_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = gen.image_mime_type?.split("/")[1] || "png";
      a.download = `generation-${gen.id}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error downloading image:", err);
    }
  };

  const handle2xDownload = async (e: React.MouseEvent, gen: ImageGeneration) => {
    e.stopPropagation();
    if (!imageDimensions) return;

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

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Error al procesar imagen");
      }

      const result = await response.json();
      const imageResponse = await fetch(result.url);
      const blob = await imageResponse.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = gen.image_mime_type?.split("/")[1] || "png";
      a.download = `generation-${gen.id}--2x.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error upscaling image:", err);
      alert(err instanceof Error ? err.message : "Error al procesar imagen");
    } finally {
      setUpscaling(false);
    }
  };

  const canUpscale = imageDimensions && imageDimensions.width <= 1920;

  const handleVideoDownload = async (e: React.MouseEvent, video: VideoGeneration) => {
    e.stopPropagation();
    try {
      const response = await fetch(video.video_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `video-${video.id}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error downloading video:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const imageCount = images.length;
  const videoCount = videos.length;
  const totalCount = imageCount + videoCount;

  return (
    <div className="h-full flex flex-col">
      {/* Header con Filtros */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setFilter("all")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === "all"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            Todos
            {totalCount > 0 && (
              <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                filter === "all" ? "bg-primary-foreground/20" : "bg-muted"
              }`}>
                {totalCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setFilter("images")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === "images"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <ImageIcon className="h-4 w-4" />
            Imágenes
            {imageCount > 0 && (
              <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                filter === "images" ? "bg-primary-foreground/20" : "bg-muted"
              }`}>
                {imageCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setFilter("videos")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === "videos"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <Video className="h-4 w-4" />
            Videos
            {videoCount > 0 && (
              <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                filter === "videos" ? "bg-primary-foreground/20" : "bg-muted"
              }`}>
                {videoCount}
              </span>
            )}
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          {filteredGenerations.length} {filteredGenerations.length === 1 ? "generación" : "generaciones"}
        </p>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Empty state */}
        {filteredGenerations.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <LayoutGrid className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-medium mb-2">Sin generaciones</h3>
            <p className="text-muted-foreground text-sm max-w-md">
              {filter === "all"
                ? "Aún no hay imágenes ni videos generados en este proyecto."
                : filter === "images"
                  ? "Aún no hay imágenes generadas en este proyecto."
                  : "Aún no hay videos generados en este proyecto."}
            </p>
          </div>
        )}

        {/* Combined Grid */}
        {filteredGenerations.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredGenerations.map((gen, index) => (
              <div
                key={`${gen.type}-${gen.id}`}
                onClick={() => setSelectedIndex(index)}
                className="group relative aspect-square rounded-lg overflow-hidden cursor-pointer bg-card border border-border/50 hover:border-primary/50 transition-all"
              >
                {gen.type === "image" ? (
                  <img
                    src={gen.image_url}
                    alt="Imagen generada"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <>
                    <video
                      src={gen.video_url}
                      className="w-full h-full object-cover"
                      preload="metadata"
                      muted
                      playsInline
                    />
                    {/* Play icon overlay */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
                        <Video className="w-5 h-5 text-white" />
                      </div>
                    </div>
                    {/* Audio indicator */}
                    <div className="absolute top-2 left-2 bg-black/60 rounded px-1.5 py-0.5 flex items-center gap-1">
                      {gen.video_has_audio ? (
                        <Volume2 className="h-3 w-3 text-white" />
                      ) : (
                        <VolumeX className="h-3 w-3 text-white/50" />
                      )}
                    </div>
                  </>
                )}

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute bottom-0 left-0 right-0 p-2">
                    <div className="flex items-center gap-2 text-[10px] text-white/80 mb-1 flex-wrap">
                      {gen.type === "image" ? (
                        <>
                          <span>{getFileExtension(gen.image_mime_type)}</span>
                          {formatAspectRatio(gen.image_aspect_ratio) && (
                            <>
                              <span>•</span>
                              <span>{formatAspectRatio(gen.image_aspect_ratio)}</span>
                            </>
                          )}
                          {formatImageQuality(gen.image_size) && (
                            <>
                              <span>•</span>
                              <span>{formatImageQuality(gen.image_size)}</span>
                            </>
                          )}
                          {formatFileSize(gen.image_file_size) && (
                            <>
                              <span>•</span>
                              <span>{formatFileSize(gen.image_file_size)}</span>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          {!!gen.video_duration && (
                            <>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {gen.video_duration}s
                              </span>
                              <span>•</span>
                            </>
                          )}
                          <span>{gen.video_aspect_ratio}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            {gen.video_has_audio ? (
                              <>
                                <Volume2 className="h-3 w-3" />
                                Audio
                              </>
                            ) : (
                              <>
                                <VolumeX className="h-3 w-3 opacity-50" />
                                <span className="opacity-50">Sin audio</span>
                              </>
                            )}
                          </span>
                          {formatFileSize(gen.video_file_size) && (
                            <>
                              <span>•</span>
                              <span>{formatFileSize(gen.video_file_size)}</span>
                            </>
                          )}
                        </>
                      )}
                    </div>
                    <p className="text-[10px] text-white/60">{formatDateTimeLocal(gen.created_at)}</p>
                  </div>
                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (gen.type === "image") {
                          handleImageDownload(e, gen);
                        } else {
                          handleVideoDownload(e, gen);
                        }
                      }}
                      className="p-1.5 rounded-md bg-black/50 hover:bg-black/70 transition-colors"
                      title="Descargar"
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
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
          onClick={() => setSelectedIndex(null)}
        >
          {/* Navigation arrows */}
          {canGoPrev && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                goToPrev();
              }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 hover:bg-black/70 transition-colors z-10"
              title="Anterior (←)"
            >
              <ChevronLeft className="h-8 w-8 text-white" />
            </button>
          )}

          {canGoNext && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                goToNext();
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/50 hover:bg-black/70 transition-colors z-10"
              title="Siguiente (→)"
            >
              <ChevronRight className="h-8 w-8 text-white" />
            </button>
          )}

          <div
            className="relative max-w-5xl w-full max-h-[90vh] flex flex-col bg-sidebar rounded-xl overflow-hidden mx-16"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-border/50">
              <div className="flex items-center gap-3">
                {selectedItem.type === "image" ? (
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <Video className="h-5 w-5 text-muted-foreground" />
                )}
                <h3 className="font-medium truncate">
                  {selectedItem.conversation_title}
                </h3>
                <span className="text-sm text-muted-foreground">
                  {selectedIndex !== null && `${selectedIndex + 1} / ${filteredGenerations.length}`}
                </span>
              </div>
              <button
                onClick={() => setSelectedIndex(null)}
                className="p-2 hover:bg-accent rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black/50">
              {selectedItem.type === "image" ? (
                <img
                  src={selectedItem.image_url}
                  alt="Imagen generada"
                  className="max-w-full max-h-[60vh] object-contain rounded-lg"
                />
              ) : (
                <VideoPlayer
                  videoUrl={selectedItem.video_url}
                  duration={selectedItem.video_duration || undefined}
                  hasAudio={selectedItem.video_has_audio}
                  aspectRatio={selectedItem.video_aspect_ratio}
                />
              )}
            </div>

            {/* Info Footer */}
            <div className="p-4 border-t border-border/50 space-y-3">
              {/* Meta info */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <FileType className="h-4 w-4" />
                  <span>
                    {selectedItem.type === "image"
                      ? getFileExtension(selectedItem.image_mime_type)
                      : "MP4"}
                  </span>
                </div>

                {selectedItem.type === "image" ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <Ruler className="h-4 w-4" />
                      <span>{imageDimensions ? `${imageDimensions.width}x${imageDimensions.height}` : "Cargando..."}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RatioIcon className="h-4 w-4" />
                      <span>{imageDimensions ? calculateAspectRatio(imageDimensions.width, imageDimensions.height) : (formatAspectRatio(selectedItem.image_aspect_ratio) || "...")}</span>
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
                    {!!selectedItem.video_duration && (
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
                      {selectedItem.video_has_audio ? (
                        <>
                          <Volume2 className="h-4 w-4" />
                          <span>Con audio</span>
                        </>
                      ) : (
                        <>
                          <VolumeX className="h-4 w-4 text-muted-foreground/50" />
                          <span className="text-muted-foreground/50">Sin audio</span>
                        </>
                      )}
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

              {/* Action Buttons */}
              <div className="flex gap-2">
                {selectedItem.type === "image" ? (
                  <>
                    <Button
                      onClick={(e) => handleImageDownload(e, selectedItem)}
                      className="flex-1 gap-2"
                      variant="outline"
                    >
                      <Download className="h-4 w-4" />
                      Descargar original
                    </Button>
                    {canUpscale && (
                      <Button
                        onClick={(e) => handle2xDownload(e, selectedItem)}
                        disabled={upscaling}
                        className="flex-1 gap-2 text-green-400 border-green-500/30 hover:bg-green-500/10 hover:text-green-300"
                        variant="outline"
                      >
                        {upscaling ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        {upscaling ? "Procesando..." : "Descargar @2x"}
                      </Button>
                    )}
                  </>
                ) : (
                  <Button
                    onClick={(e) => handleVideoDownload(e, selectedItem)}
                    className="flex-1 gap-2"
                    variant="outline"
                  >
                    <Download className="h-4 w-4" />
                    Descargar video
                  </Button>
                )}

                {selectedItem.conversation_user_id === currentUserId && (
                  <Button
                    onClick={() => {
                      setSelectedIndex(null);
                      onOpenConversation(selectedItem.conversation_id);
                    }}
                    className="flex-1 gap-2"
                    variant="outline"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Ir a la conversación
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
