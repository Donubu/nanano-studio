"use client";

import { useState, useEffect } from "react";
import { X, Loader2, ExternalLink, Image as ImageIcon, Calendar, FileType, Maximize2, RatioIcon, Ruler, Download, HardDrive, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Generation {
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
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<Generation | null>(null);
  const [imageDimensions, setImageDimensions] = useState<ImageDimensions | null>(null);
  const [upscaling, setUpscaling] = useState(false);

  useEffect(() => {
    const fetchGenerations = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/generations`);
        if (res.ok) {
          const data = await res.json();
          setGenerations(data);
        }
      } catch (err) {
        console.error("Error fetching generations:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchGenerations();
  }, [projectId]);

  const formatDate = (dateString: string) => {
    // Si la fecha no tiene indicador de zona, asumimos UTC (viene de la BD)
    let date: Date;
    if (dateString.includes('Z') || dateString.includes('+') || dateString.includes('-')) {
      date = new Date(dateString);
    } else {
      // Agregar 'Z' para indicar que es UTC
      date = new Date(dateString.replace(' ', 'T') + 'Z');
    }
    return date.toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getFileExtension = (mimeType: string | null) => {
    if (!mimeType) return "PNG";
    const ext = mimeType.split("/")[1]?.toUpperCase() || "PNG";
    return ext;
  };

  const formatAspectRatio = (ratio: string | null) => {
    if (!ratio) return "1:1";
    // Convert "1:1", "16:9", etc. to display format
    return ratio;
  };

  const formatImageSize = (size: string | null) => {
    if (!size) return "1024x1024";
    return size;
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleDownload = async (e: React.MouseEvent, gen: Generation) => {
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

  // Cargar dimensiones de imagen cuando se selecciona
  useEffect(() => {
    if (!selectedImage) {
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
    img.src = selectedImage.image_url;
  }, [selectedImage]);

  // Manejar descarga 2X (upscale)
  const handle2xDownload = async (e: React.MouseEvent, gen: Generation) => {
    e.stopPropagation();
    if (!imageDimensions) return;

    setUpscaling(true);
    try {
      // Llamar al endpoint de upscale
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

      // Descargar la imagen 2x
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

  // Verificar si la imagen puede ser upscaleada (ancho <= 1920)
  const canUpscale = imageDimensions && imageDimensions.width <= 1920;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (generations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <ImageIcon className="h-16 w-16 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-medium mb-2">Sin generaciones</h3>
        <p className="text-muted-foreground text-sm max-w-md">
          Aún no hay imágenes generadas en este proyecto. Las imágenes aparecerán aquí cuando uses un modelo con capacidad de generación de imágenes.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border/50">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-primary" />
          Mostrando todas las generaciones
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {generations.length} {generations.length === 1 ? "imagen generada" : "imágenes generadas"}
        </p>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {generations.map((gen) => (
            <div
              key={gen.id}
              onClick={() => setSelectedImage(gen)}
              className="group relative aspect-square rounded-lg overflow-hidden cursor-pointer bg-[#1a1a22] border border-border/50 hover:border-primary/50 transition-all"
            >
              <img
                src={gen.image_url}
                alt="Imagen generada"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute bottom-0 left-0 right-0 p-2">
                  <div className="flex items-center gap-2 text-[10px] text-white/80 mb-1 flex-wrap">
                    <span>{getFileExtension(gen.image_mime_type)}</span>
                    <span>•</span>
                    <span>{formatImageSize(gen.image_size)}</span>
                    <span>•</span>
                    <span>{formatAspectRatio(gen.image_aspect_ratio)}</span>
                    {formatFileSize(gen.image_file_size) && (
                      <>
                        <span>•</span>
                        <span>{formatFileSize(gen.image_file_size)}</span>
                      </>
                    )}
                  </div>
                  <p className="text-[10px] text-white/60">{formatDate(gen.created_at)}</p>
                </div>
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  <button
                    onClick={(e) => handleDownload(e, gen)}
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
      </div>

      {/* Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="relative max-w-5xl w-full max-h-[90vh] flex flex-col bg-[#131318] rounded-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-border/50">
              <h3 className="font-medium truncate flex-1 mr-4">
                {selectedImage.conversation_title}
              </h3>
              <button
                onClick={() => setSelectedImage(null)}
                className="p-2 hover:bg-accent rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Image */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black/50">
              <img
                src={selectedImage.image_url}
                alt="Imagen generada"
                className="max-w-full max-h-[60vh] object-contain rounded-lg"
              />
            </div>

            {/* Info Footer */}
            <div className="p-4 border-t border-border/50 space-y-3">
              {/* Meta info */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <FileType className="h-4 w-4" />
                  <span>{getFileExtension(selectedImage.image_mime_type)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Ruler className="h-4 w-4" />
                  <span>{imageDimensions ? `${imageDimensions.width}x${imageDimensions.height}` : formatImageSize(selectedImage.image_size)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <RatioIcon className="h-4 w-4" />
                  <span>{formatAspectRatio(selectedImage.image_aspect_ratio)}</span>
                </div>
                {formatFileSize(selectedImage.image_file_size) && (
                  <div className="flex items-center gap-1.5">
                    <HardDrive className="h-4 w-4" />
                    <span>{formatFileSize(selectedImage.image_file_size)}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  <span>{formatDate(selectedImage.created_at)}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <Button
                  onClick={(e) => handleDownload(e, selectedImage)}
                  className="flex-1 gap-2"
                  variant="outline"
                >
                  <Download className="h-4 w-4" />
                  Descargar original
                </Button>
                {canUpscale && (
                  <Button
                    onClick={(e) => handle2xDownload(e, selectedImage)}
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
                {selectedImage.conversation_user_id === currentUserId && (
                  <Button
                    onClick={() => {
                      setSelectedImage(null);
                      onOpenConversation(selectedImage.conversation_id);
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
