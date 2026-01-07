"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Send, Paperclip, X, Loader2, FileText, Music, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AttachedFile {
  dataUrl: string;
  mimeType: string;
  name: string;
  type: "image" | "document" | "audio";
  size: number;
}

export interface PreselectedImage {
  url: string;
  dataUrl?: string; // Will be populated when sent
}

interface MessageInputProps {
  onSend: (content: string, files?: AttachedFile[]) => void;
  disabled?: boolean;
  placeholder?: string;
  supportsFiles?: boolean;
  preselectedImages?: PreselectedImage[];
  onRemovePreselectedImage?: (url: string) => void;
}

const MAX_FILES = 5;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// Tipos de archivo soportados
const SUPPORTED_TYPES = {
  image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  document: ["application/pdf"],
  audio: ["audio/mp3", "audio/mpeg", "audio/wav", "audio/ogg", "audio/webm"],
};

function getFileType(mimeType: string): "image" | "document" | "audio" | null {
  if (SUPPORTED_TYPES.image.includes(mimeType)) return "image";
  if (SUPPORTED_TYPES.document.includes(mimeType)) return "document";
  if (SUPPORTED_TYPES.audio.includes(mimeType)) return "audio";
  return null;
}

function getAcceptString(): string {
  return [
    ...SUPPORTED_TYPES.image,
    ...SUPPORTED_TYPES.document,
    ...SUPPORTED_TYPES.audio,
  ].join(",");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MessageInput({
  onSend,
  disabled = false,
  placeholder = "Escribe un mensaje...",
  supportsFiles = true,
  preselectedImages = [],
  onRemovePreselectedImage,
}: MessageInputProps) {
  const [message, setMessage] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFileSelect = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const totalCurrentFiles = attachedFiles.length + preselectedImages.length;
    const remainingSlots = MAX_FILES - totalCurrentFiles;

    if (remainingSlots <= 0) {
      alert(`Máximo ${MAX_FILES} archivos permitidos`);
      return;
    }

    const filesToProcess = fileArray.slice(0, remainingSlots);
    setIsProcessing(true);

    const newFiles: AttachedFile[] = [];

    for (const file of filesToProcess) {
      const fileType = getFileType(file.type);

      if (!fileType) {
        alert(`Tipo de archivo no soportado: ${file.name}\n\nFormatos permitidos:\n- Imágenes: JPG, PNG, GIF, WebP\n- Documentos: PDF\n- Audio: MP3, WAV, OGG, WebM`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        alert(`El archivo "${file.name}" supera el límite de 20MB`);
        continue;
      }

      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        newFiles.push({
          dataUrl,
          mimeType: file.type,
          name: file.name,
          type: fileType,
          size: file.size,
        });
      } catch (error) {
        console.error("Error reading file:", error);
      }
    }

    setAttachedFiles((prev) => [...prev, ...newFiles]);
    setIsProcessing(false);
  }, [attachedFiles.length, preselectedImages.length]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFileSelect(files);
      }
    },
    [handleFileSelect]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFileSelect(files);
      }
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [handleFileSelect]
  );

  const handleSend = useCallback(async () => {
    const hasContent = message.trim() || attachedFiles.length > 0 || preselectedImages.length > 0;
    if (!hasContent || disabled) return;

    // Convert preselected images to AttachedFile format
    const preselectedAsFiles: AttachedFile[] = [];
    for (const img of preselectedImages) {
      try {
        const response = await fetch(img.url);
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        preselectedAsFiles.push({
          dataUrl,
          mimeType: blob.type || "image/png",
          name: img.url.split("/").pop() || "image.png",
          type: "image",
          size: blob.size,
        });
      } catch (error) {
        console.error("Error loading preselected image:", error);
      }
    }

    const allFiles = [...preselectedAsFiles, ...attachedFiles];
    onSend(message.trim(), allFiles.length > 0 ? allFiles : undefined);

    setMessage("");
    setAttachedFiles([]);
  }, [message, attachedFiles, preselectedImages, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const renderFilePreview = (file: AttachedFile, index: number) => {
    return (
      <div
        key={index}
        className="relative group rounded-lg overflow-hidden border border-border/50 bg-card"
      >
        {file.type === "image" ? (
          <div className="w-20 h-20 relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={file.dataUrl}
              alt={file.name}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="w-20 h-20 flex flex-col items-center justify-center p-2">
            {file.type === "document" ? (
              <FileText className="h-8 w-8 text-red-400" />
            ) : (
              <Music className="h-8 w-8 text-green-400" />
            )}
            <span className="text-[10px] text-muted-foreground mt-1 uppercase">
              {file.mimeType.split("/")[1]}
            </span>
          </div>
        )}

        {/* Overlay con nombre y botón eliminar */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-1">
          <button
            onClick={() => removeFile(index)}
            className="p-1 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors"
          >
            <X className="h-3 w-3 text-white" />
          </button>
          <p className="text-[9px] text-white mt-1 text-center truncate w-full px-1">
            {file.name}
          </p>
          <p className="text-[8px] text-white/70">
            {formatFileSize(file.size)}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div
      className={cn(
        "border-t border-border/50 p-4 transition-colors",
        isDragging && "bg-primary/5 border-primary/50"
      )}
      onDragOver={supportsFiles ? handleDragOver : undefined}
      onDragLeave={supportsFiles ? handleDragLeave : undefined}
      onDrop={supportsFiles ? handleDrop : undefined}
    >
      <div className="max-w-4xl mx-auto space-y-3">
        {/* Preview de archivos adjuntos e imágenes preseleccionadas */}
        {(attachedFiles.length > 0 || preselectedImages.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {/* Imágenes preseleccionadas de la conversación */}
            {preselectedImages.map((img, index) => (
              <div
                key={`preselected-${index}`}
                className="relative group rounded-lg overflow-hidden border-2 border-primary/50 bg-card"
              >
                <div className="w-20 h-20 relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt="Preseleccionada"
                    className="w-full h-full object-cover"
                  />
                </div>
                {/* Badge indicador */}
                <div className="absolute top-0 left-0 right-0 bg-primary/90 text-[8px] text-primary-foreground text-center py-0.5 font-medium">
                  Del chat
                </div>
                {/* Overlay con botón eliminar */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button
                    onClick={() => onRemovePreselectedImage?.(img.url)}
                    className="p-1 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors"
                  >
                    <X className="h-3 w-3 text-white" />
                  </button>
                </div>
              </div>
            ))}
            {/* Archivos adjuntos subidos */}
            {attachedFiles.map((file, index) => renderFilePreview(file, index))}
            {/* Botón agregar más */}
            {(attachedFiles.length + preselectedImages.length) < MAX_FILES && supportsFiles && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || isProcessing}
                className="w-20 h-20 rounded-lg border-2 border-dashed border-border/50 hover:border-primary/50 flex flex-col items-center justify-center text-muted-foreground hover:text-primary transition-colors"
              >
                <Paperclip className="h-5 w-5" />
                <span className="text-[10px] mt-1">Agregar</span>
              </button>
            )}
          </div>
        )}

        {/* Input y botones */}
        <div className="flex gap-2 items-end">
          {/* Botón de adjuntar archivo */}
          {supportsFiles && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={getAcceptString()}
                onChange={handleFileInputChange}
                className="hidden"
                multiple
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || isProcessing || (attachedFiles.length + preselectedImages.length) >= MAX_FILES}
                className="shrink-0 h-10 w-10"
                title={`Adjuntar archivos (${attachedFiles.length + preselectedImages.length}/${MAX_FILES})`}
              >
                {isProcessing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Paperclip className="h-5 w-5" />
                )}
              </Button>
            </>
          )}

          {/* Textarea */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              className={cn(
                "w-full bg-card border border-border/50 rounded-lg px-4 py-2.5 text-sm resize-none",
                "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50",
                "placeholder:text-muted-foreground",
                "min-h-[44px] max-h-[200px]",
                disabled && "opacity-50 cursor-not-allowed"
              )}
              style={{
                height: "auto",
                minHeight: "44px",
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
              }}
            />
          </div>

          {/* Botón enviar */}
          <Button
            onClick={handleSend}
            disabled={disabled || (!message.trim() && attachedFiles.length === 0 && preselectedImages.length === 0)}
            className="shrink-0 h-10"
          >
            {disabled ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Indicador de drag & drop */}
        {isDragging && (
          <div className="text-center text-sm text-primary flex items-center justify-center gap-2">
            <ImageIcon className="h-4 w-4" />
            <FileText className="h-4 w-4" />
            <Music className="h-4 w-4" />
            <span>Suelta los archivos aquí</span>
          </div>
        )}

        {/* Contador de archivos */}
        {(attachedFiles.length > 0 || preselectedImages.length > 0) && (
          <div className="text-xs text-muted-foreground text-center">
            {attachedFiles.length + preselectedImages.length} de {MAX_FILES} archivos adjuntos
            {preselectedImages.length > 0 && (
              <span className="text-primary ml-1">
                ({preselectedImages.length} del chat)
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
