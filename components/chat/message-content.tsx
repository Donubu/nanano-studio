"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageContentProps {
  content: string;
  imageUrl?: string | null;
  isUser?: boolean;
  isStreaming?: boolean;
}

interface ImageMetadata {
  width: number;
  height: number;
  aspectRatio: string;
  format: string;
  fileSize: string;
}

// Función para descargar imagen
const downloadImage = async (imageUrl: string) => {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    // Extraer nombre del archivo de la URL o generar uno
    const fileName = imageUrl.split("/").pop() || `imagen_${Date.now()}.png`;
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
  imageUrl,
  isUser = false,
  isStreaming = false,
}: MessageContentProps) {
  const [imageMetadata, setImageMetadata] = useState<ImageMetadata | null>(null);

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
        <div className="rounded-lg overflow-hidden max-w-sm">
          <div className="relative group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="Imagen adjunta"
              className="w-full h-auto object-cover"
            />
            {/* Botón de descarga - solo para imágenes del modelo (no del usuario) */}
            {!isUser && (
              <button
                onClick={() => downloadImage(imageUrl)}
                className="absolute top-2 right-2 p-2 bg-black/60 hover:bg-black/80 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                title="Descargar imagen"
              >
                <Download className="h-4 w-4 text-white" />
              </button>
            )}
          </div>
          {/* Metadatos de la imagen - solo para imágenes del modelo */}
          {!isUser && imageMetadata && (
            <div className="bg-[#1a1a22] border-t border-border/30 px-3 py-2 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
              <span>{imageMetadata.width} × {imageMetadata.height}</span>
              <span>{imageMetadata.aspectRatio}</span>
              <span>{imageMetadata.format}</span>
              <span>{imageMetadata.fileSize}</span>
            </div>
          )}
        </div>
      )}

      {/* Contenido de texto con Markdown */}
      {content && (
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
                          : "bg-[#2a2a36] text-yellow-300"
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
                      <div className="absolute top-0 right-0 px-2 py-1 text-xs text-muted-foreground bg-[#1a1a22] rounded-bl">
                        {match[1]}
                      </div>
                    )}
                    <pre
                      className={cn(
                        "p-4 rounded-lg overflow-x-auto text-sm",
                        isUser ? "bg-white/10" : "bg-[#1a1a22]"
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
                    className="border border-border/50 px-3 py-2 bg-[#1a1a22] text-left font-medium"
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
