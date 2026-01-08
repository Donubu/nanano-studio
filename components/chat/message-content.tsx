"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, ZoomIn, Loader2, Check, Mic, AlertCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { VideoPlayer } from "./video-player";
import { VideoProgress } from "./video-progress";
import { VideoGenerationStatus } from "@/types/video";
import { AudioPlayer } from "./audio-player";
import { AudioGenerationStatus, AudioVoiceConfig, AudioSpeakerConfig } from "@/types/audio";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// Parse error message to extract code and details
function parseErrorMessage(content: string): { code?: string | number; message: string; details?: string } {
  // Try to extract JSON error from the content
  const jsonMatch = content.match(/\{[\s\S]*"error"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const error = parsed.error || parsed;
      return {
        code: error.code || error.status,
        message: error.message?.split("\\n")[0]?.replace(/^"|"$/g, '') || content.split(":")[0],
        details: jsonMatch[0],
      };
    } catch {
      // If JSON parsing fails, return raw content
    }
  }

  // Fallback: extract simple error format
  const colonIndex = content.indexOf(":");
  if (content.startsWith("Error") && colonIndex > 0) {
    return {
      message: content.substring(0, colonIndex),
      details: content.substring(colonIndex + 1).trim(),
    };
  }

  return { message: content };
}

interface MessageContentProps {
  content: string;
  contentType?: string;
  imageUrl?: string | null;
  // Video fields
  videoUrl?: string | null;
  videoDuration?: number | null;
  videoHasAudio?: boolean;
  videoAspectRatio?: string;
  isVideoGenerating?: boolean;
  videoProgress?: {
    status: VideoGenerationStatus;
    message: string;
    progress?: number;
  };
  // Audio fields
  audioUrl?: string | null;
  audioDuration?: number | null;
  audioMimeType?: string | null;
  audioVoiceConfig?: AudioVoiceConfig | AudioSpeakerConfig | null;
  isAudioGenerating?: boolean;
  audioProgress?: {
    status: AudioGenerationStatus;
    message: string;
  };
  isUser?: boolean;
  isStreaming?: boolean;
  // Image selection
  isImageSelected?: boolean;
  onImageSelect?: (imageUrl: string) => void;
  allowImageSelection?: boolean;
}

interface ImageMetadata {
  width: number;
  height: number;
  aspectRatio: string;
  format: string;
  fileSize: string;
}

// Función para descargar imagen
const downloadImage = async (imageUrl: string, suffix?: string) => {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    // Extraer nombre del archivo de la URL o generar uno
    let fileName = imageUrl.split("/").pop() || `imagen_${Date.now()}.png`;
    if (suffix) {
      const lastDotIndex = fileName.lastIndexOf(".");
      if (lastDotIndex !== -1) {
        fileName = fileName.slice(0, lastDotIndex) + suffix + fileName.slice(lastDotIndex);
      }
    }
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error descargando imagen:", error);
  }
};

// Calcular el máximo común divisor para simplificar la relación de aspecto
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

// Formatear bytes a unidades legibles
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

// Calcular relación de aspecto simplificada
const calculateAspectRatio = (width: number, height: number): string => {
  const divisor = gcd(width, height);
  const w = width / divisor;
  const h = height / divisor;
  // Si los números son muy grandes, usar aproximación
  if (w > 21 || h > 21) {
    const ratio = width / height;
    // Aproximar a relaciones comunes
    if (Math.abs(ratio - 1) < 0.05) return "1:1";
    if (Math.abs(ratio - 16/9) < 0.05) return "16:9";
    if (Math.abs(ratio - 9/16) < 0.05) return "9:16";
    if (Math.abs(ratio - 4/3) < 0.05) return "4:3";
    if (Math.abs(ratio - 3/4) < 0.05) return "3:4";
    if (Math.abs(ratio - 3/2) < 0.05) return "3:2";
    if (Math.abs(ratio - 2/3) < 0.05) return "2:3";
    if (Math.abs(ratio - 21/9) < 0.05) return "21:9";
    return `${ratio.toFixed(2)}:1`;
  }
  return `${w}:${h}`;
};

// Extraer formato de la URL
const getImageFormat = (url: string): string => {
  const extension = url.split(".").pop()?.toLowerCase().split("?")[0] || "";
  const formats: Record<string, string> = {
    jpg: "JPEG",
    jpeg: "JPEG",
    png: "PNG",
    gif: "GIF",
    webp: "WebP",
    svg: "SVG",
    bmp: "BMP",
  };
  return formats[extension] || extension.toUpperCase() || "Imagen";
};

export function MessageContent({
  content,
  contentType,
  imageUrl,
  videoUrl,
  videoDuration,
  videoHasAudio = true,
  videoAspectRatio = "16:9",
  isVideoGenerating = false,
  videoProgress,
  audioUrl,
  audioDuration,
  audioMimeType,
  audioVoiceConfig,
  isAudioGenerating = false,
  audioProgress,
  isUser = false,
  isStreaming = false,
  isImageSelected = false,
  onImageSelect,
  allowImageSelection = false,
}: MessageContentProps) {
  const [errorExpanded, setErrorExpanded] = useState(false);
  const isError = contentType === "error" || content.startsWith("Error");
  const [imageMetadata, setImageMetadata] = useState<ImageMetadata | null>(null);
  const [upscaling, setUpscaling] = useState(false);

  // Verificar si la imagen puede ser upscaleada (ancho <= 1920)
  const canUpscale = imageMetadata && imageMetadata.width <= 1920;

  // Manejar descarga 2X (upscale)
  const handle2xDownload = async () => {
    if (!imageUrl || !imageMetadata) return;

    setUpscaling(true);
    try {
      const response = await fetch("/api/images/upscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          width: imageMetadata.width,
          height: imageMetadata.height,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Error al procesar imagen");
      }

      const result = await response.json();
      await downloadImage(result.url, "--2x");
    } catch (err) {
      console.error("Error upscaling image:", err);
      alert(err instanceof Error ? err.message : "Error al procesar imagen");
    } finally {
      setUpscaling(false);
    }
  };

  // Cargar metadatos de la imagen cuando se monta el componente
  useEffect(() => {
    if (!imageUrl || isUser) return;

    const loadImageMetadata = async () => {
      try {
        // Cargar dimensiones de la imagen
        const img = new Image();
        img.src = imageUrl;

        img.onload = async () => {
          const width = img.naturalWidth;
          const height = img.naturalHeight;

          // Obtener tamaño del archivo
          let fileSize = "—";
          try {
            const response = await fetch(imageUrl, { method: "HEAD" });
            const contentLength = response.headers.get("content-length");
            if (contentLength) {
              fileSize = formatFileSize(parseInt(contentLength, 10));
            }
          } catch {
            // Si HEAD falla, intentar con GET
            try {
              const response = await fetch(imageUrl);
              const blob = await response.blob();
              fileSize = formatFileSize(blob.size);
            } catch {
              // Ignorar errores de tamaño
            }
          }

          setImageMetadata({
            width,
            height,
            aspectRatio: calculateAspectRatio(width, height),
            format: getImageFormat(imageUrl),
            fileSize,
          });
        };
      } catch (error) {
        console.error("Error cargando metadatos de imagen:", error);
      }
    };

    loadImageMetadata();
  }, [imageUrl, isUser]);

  return (
    <div className="space-y-2">
      {/* Imagen si existe */}
      {imageUrl && (
        <div className={cn(
          "rounded-lg overflow-hidden max-w-sm",
          isImageSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
        )}>
          <div className="relative group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="Imagen adjunta"
              className="w-full h-auto object-cover"
            />
            {/* Botón de selección - esquina inferior izquierda */}
            {allowImageSelection && onImageSelect && (
              <button
                onClick={() => onImageSelect(imageUrl)}
                className={cn(
                  "absolute bottom-2 left-2 p-1.5 rounded-full transition-all",
                  isImageSelected
                    ? "bg-primary text-primary-foreground"
                    : "bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100"
                )}
                title={isImageSelected ? "Quitar selección" : "Seleccionar imagen"}
              >
                <Check className="h-4 w-4" />
              </button>
            )}
            {/* Indicador de selección permanente */}
            {isImageSelected && (
              <div className="absolute top-2 left-2 bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full font-medium">
                Seleccionada
              </div>
            )}
            {/* Botones de descarga - solo para imágenes del modelo (no del usuario) */}
            {!isUser && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => downloadImage(imageUrl)}
                  className="p-2 bg-black/60 hover:bg-black/80 rounded-lg"
                  title="Descargar imagen original"
                >
                  <Download className="h-4 w-4 text-white" />
                </button>
                {canUpscale && (
                  <button
                    onClick={handle2xDownload}
                    disabled={upscaling}
                    className="p-2 bg-green-600/80 hover:bg-green-600 disabled:bg-green-600/50 rounded-lg flex items-center gap-1"
                    title="Descargar en 2X (upscale)"
                  >
                    {upscaling ? (
                      <Loader2 className="h-4 w-4 text-white animate-spin" />
                    ) : (
                      <>
                        <ZoomIn className="h-4 w-4 text-white" />
                        <span className="text-xs text-white font-medium">2X</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
          {/* Metadatos de la imagen - solo para imágenes del modelo */}
          {!isUser && imageMetadata && (
            <div className="bg-card border-t border-border/30 px-3 py-2 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
              <span>{imageMetadata.width} × {imageMetadata.height}</span>
              <span>{imageMetadata.aspectRatio}</span>
              <span>{imageMetadata.format}</span>
              <span>{imageMetadata.fileSize}</span>
            </div>
          )}
        </div>
      )}

      {/* Video en progreso de generación */}
      {isVideoGenerating && videoProgress && (
        <VideoProgress
          status={videoProgress.status}
          message={videoProgress.message}
          progress={videoProgress.progress}
        />
      )}

      {/* Video generado */}
      {videoUrl && !isVideoGenerating && (
        <VideoPlayer
          videoUrl={videoUrl}
          duration={videoDuration || undefined}
          hasAudio={videoHasAudio}
          aspectRatio={videoAspectRatio}
        />
      )}

      {/* Audio en progreso de generación */}
      {isAudioGenerating && audioProgress && (
        <div className="flex items-center gap-3 p-4 bg-violet-500/10 border border-violet-200/50 dark:border-violet-800/50 rounded-lg">
          <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center shrink-0">
            <Mic className="w-5 h-5 text-violet-600 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-violet-700 dark:text-violet-300">
              Generando audio...
            </p>
            <p className="text-xs text-violet-600/70 dark:text-violet-400/70 truncate">
              {audioProgress.message}
            </p>
          </div>
          <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin shrink-0" />
        </div>
      )}

      {/* Audio generado */}
      {audioUrl && !isAudioGenerating && (
        <AudioPlayer
          audioUrl={audioUrl}
          duration={audioDuration || undefined}
          mimeType={audioMimeType || undefined}
          voiceConfig={audioVoiceConfig}
        />
      )}

      {/* Error Message - Collapsible */}
      {content && isError && !isUser && (
        <Collapsible open={errorExpanded} onOpenChange={setErrorExpanded}>
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg overflow-hidden">
            <CollapsibleTrigger className="w-full px-4 py-3 flex items-center gap-3 hover:bg-red-500/5 transition-colors">
              <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-red-400">Error</span>
                  {(() => {
                    const parsed = parseErrorMessage(content);
                    return parsed.code ? (
                      <span className="px-2 py-0.5 bg-red-500/20 text-red-300 text-xs rounded-full font-mono">
                        {parsed.code}
                      </span>
                    ) : null;
                  })()}
                </div>
                <p className="text-xs text-red-300/70 mt-0.5 line-clamp-1">
                  {parseErrorMessage(content).message.substring(0, 100)}
                </p>
              </div>
              <ChevronDown className={cn(
                "h-4 w-4 text-red-400 transition-transform shrink-0",
                errorExpanded && "rotate-180"
              )} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4 pt-2 border-t border-red-500/20">
                <pre className="text-xs text-red-200/80 whitespace-pre-wrap break-all bg-red-950/30 p-3 rounded-md overflow-x-auto max-h-64 overflow-y-auto">
                  {(() => {
                    const parsed = parseErrorMessage(content);
                    if (parsed.details) {
                      try {
                        return JSON.stringify(JSON.parse(parsed.details), null, 2);
                      } catch {
                        return parsed.details;
                      }
                    }
                    return content;
                  })()}
                </pre>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      {/* Contenido de texto con Markdown */}
      {content && !isError && (
        <div
          className={cn(
            "prose prose-sm max-w-none",
            isUser
              ? "prose-invert"
              : "prose-invert prose-p:text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-code:text-foreground"
          )}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Personalizar renderizado de código
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || "");
                const isInline = !match;

                if (isInline) {
                  return (
                    <code
                      className={cn(
                        "px-1.5 py-0.5 rounded text-xs font-mono",
                        isUser
                          ? "bg-white/20"
                          : "bg-secondary text-yellow-300"
                      )}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }

                return (
                  <div className="relative my-2">
                    {match && (
                      <div className="absolute top-0 right-0 px-2 py-1 text-xs text-muted-foreground bg-card rounded-bl">
                        {match[1]}
                      </div>
                    )}
                    <pre
                      className={cn(
                        "p-4 rounded-lg overflow-x-auto text-sm",
                        isUser ? "bg-white/10" : "bg-card"
                      )}
                    >
                      <code className={className} {...props}>
                        {children}
                      </code>
                    </pre>
                  </div>
                );
              },
              // Personalizar enlaces
              a({ href, children, ...props }) {
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "underline underline-offset-2",
                      isUser
                        ? "text-white hover:text-white/80"
                        : "text-primary hover:text-primary/80"
                    )}
                    {...props}
                  >
                    {children}
                  </a>
                );
              },
              // Personalizar listas
              ul({ children, ...props }) {
                return (
                  <ul className="list-disc list-inside space-y-1 my-2" {...props}>
                    {children}
                  </ul>
                );
              },
              ol({ children, ...props }) {
                return (
                  <ol className="list-decimal list-inside space-y-1 my-2" {...props}>
                    {children}
                  </ol>
                );
              },
              // Personalizar párrafos
              p({ children, ...props }) {
                return (
                  <p className="my-1 leading-relaxed" {...props}>
                    {children}
                  </p>
                );
              },
              // Personalizar tablas
              table({ children, ...props }) {
                return (
                  <div className="overflow-x-auto my-2">
                    <table
                      className="min-w-full border-collapse border border-border/50"
                      {...props}
                    >
                      {children}
                    </table>
                  </div>
                );
              },
              th({ children, ...props }) {
                return (
                  <th
                    className="border border-border/50 px-3 py-2 bg-card text-left font-medium"
                    {...props}
                  >
                    {children}
                  </th>
                );
              },
              td({ children, ...props }) {
                return (
                  <td className="border border-border/50 px-3 py-2" {...props}>
                    {children}
                  </td>
                );
              },
              // Personalizar blockquote
              blockquote({ children, ...props }) {
                return (
                  <blockquote
                    className="border-l-4 border-primary/50 pl-4 my-2 italic text-muted-foreground"
                    {...props}
                  >
                    {children}
                  </blockquote>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
          )}
        </div>
      )}
    </div>
  );
}
