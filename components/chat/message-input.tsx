"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Send, ImagePlus, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AttachedImage {
  dataUrl: string;
  mimeType: string;
  name: string;
}

interface MessageInputProps {
  onSend: (content: string, image?: { dataUrl: string; mimeType: string }) => void;
  disabled?: boolean;
  placeholder?: string;
  supportsImages?: boolean;
}

export function MessageInput({
  onSend,
  disabled = false,
  placeholder = "Escribe un mensaje...",
  supportsImages = true,
}: MessageInputProps) {
  const [message, setMessage] = useState("");
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Solo se permiten archivos de imagen");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("La imagen no puede superar los 10MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setAttachedImage({
        dataUrl,
        mimeType: file.type,
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
  }, []);

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

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [handleFileSelect]
  );

  const handleSend = useCallback(() => {
    if ((!message.trim() && !attachedImage) || disabled) return;

    onSend(
      message.trim(),
      attachedImage
        ? { dataUrl: attachedImage.dataUrl, mimeType: attachedImage.mimeType }
        : undefined
    );

    setMessage("");
    setAttachedImage(null);
  }, [message, attachedImage, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const removeImage = useCallback(() => {
    setAttachedImage(null);
  }, []);

  return (
    <div
      className={cn(
        "border-t border-border/50 p-4 transition-colors",
        isDragging && "bg-primary/5 border-primary/50"
      )}
      onDragOver={supportsImages ? handleDragOver : undefined}
      onDragLeave={supportsImages ? handleDragLeave : undefined}
      onDrop={supportsImages ? handleDrop : undefined}
    >
      <div className="max-w-4xl mx-auto space-y-3">
        {/* Preview de imagen adjunta */}
        {attachedImage && (
          <div className="relative inline-block">
            <div className="relative rounded-lg overflow-hidden border border-border/50 max-w-[200px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachedImage.dataUrl}
                alt={attachedImage.name}
                className="max-h-32 w-auto object-cover"
              />
              <button
                onClick={removeImage}
                className="absolute top-1 right-1 p-1 rounded-full bg-black/50 hover:bg-black/70 transition-colors"
              >
                <X className="h-3 w-3 text-white" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1 truncate max-w-[200px]">
              {attachedImage.name}
            </p>
          </div>
        )}

        {/* Input y botones */}
        <div className="flex gap-2 items-end">
          {/* Botón de imagen */}
          {supportsImages && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileInputChange}
                className="hidden"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                className="shrink-0 h-10 w-10"
                title="Adjuntar imagen"
              >
                <ImagePlus className="h-5 w-5" />
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
                "w-full bg-[#1a1a22] border border-border/50 rounded-lg px-4 py-2.5 text-sm resize-none",
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
            disabled={disabled || (!message.trim() && !attachedImage)}
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
          <div className="text-center text-sm text-primary">
            Suelta la imagen aquí
          </div>
        )}
      </div>
    </div>
  );
}
