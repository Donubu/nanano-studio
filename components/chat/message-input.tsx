"use client";

import { useState, useRef, useCallback, useEffect, useMemo, useImperativeHandle, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { Send, Paperclip, X, Loader2, FileText, Music, Image as ImageIcon, Film } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AttachedFile {
  dataUrl: string;
  mimeType: string;
  name: string;
  type: "image" | "document" | "audio" | "video";
  size: number;
  assetId?: string; // e.g., "asset1", "asset2" - only set in asset mode
  sourceUrl?: string; // original CDN URL when dragged from grid
}

export interface PreselectedImage {
  url: string;
  dataUrl?: string; // Will be populated when sent
  assetLabel?: string; // e.g., "asset1" - shown in asset mode
}

interface MessageInputProps {
  onSend: (content: string, files?: AttachedFile[], noContext?: boolean) => void;
  disabled?: boolean;
  placeholder?: string;
  supportsFiles?: boolean;
  preselectedImages?: PreselectedImage[];
  onRemovePreselectedImage?: (url: string) => void;
  initialValue?: string;
  onInitialValueUsed?: () => void;
  showNoContextOption?: boolean;
  assetMode?: boolean; // When true, files get auto-incremental asset IDs and @ mentions are enabled
  maxFilesOverride?: number; // Override max files limit (e.g., dynamic Kling limits)
  onAssetsChange?: (assets: { assetId: string; type: string; label: string }[]) => void; // Notify parent of full asset list
  className?: string;
  minimal?: boolean; // Strip borders/bg from textarea for embedding inside a custom wrapper
  extraActions?: React.ReactNode; // Rendered next to the send button
  onExternalFileAdded?: (file: AttachedFile) => void; // Called when user adds a file from file picker/paste (NOT from addFiles imperative)
}

export interface MessageInputHandle {
  addFiles: (files: AttachedFile[]) => void;
  clearFiles: () => void;
  getFiles: () => AttachedFile[];
  removeFileByUrl: (url: string) => void;
  focus: () => void;
}

const MAX_FILES = 5;
const MAX_FILES_ASSET_MODE = 10;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// Tipos de archivo soportados
const SUPPORTED_TYPES = {
  image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  document: ["application/pdf"],
  audio: ["audio/mp3", "audio/mpeg", "audio/wav", "audio/ogg", "audio/webm"],
};

const SUPPORTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

function getFileType(mimeType: string, allowVideo?: boolean): "image" | "document" | "audio" | "video" | null {
  if (SUPPORTED_TYPES.image.includes(mimeType)) return "image";
  if (SUPPORTED_TYPES.document.includes(mimeType)) return "document";
  if (SUPPORTED_TYPES.audio.includes(mimeType)) return "audio";
  if (allowVideo && SUPPORTED_VIDEO_TYPES.includes(mimeType)) return "video";
  return null;
}

function getAcceptString(allowVideo?: boolean): string {
  const types = [
    ...SUPPORTED_TYPES.image,
    ...SUPPORTED_TYPES.document,
    ...SUPPORTED_TYPES.audio,
  ];
  if (allowVideo) {
    types.push(...SUPPORTED_VIDEO_TYPES);
  }
  return types.join(",");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MessageInput = forwardRef<MessageInputHandle, MessageInputProps>(function MessageInput({
  onSend,
  disabled = false,
  placeholder = "Escribe un mensaje...",
  supportsFiles = true,
  preselectedImages = [],
  onRemovePreselectedImage,
  initialValue,
  onInitialValueUsed,
  showNoContextOption = false,
  assetMode = false,
  maxFilesOverride,
  onAssetsChange,
  className: classNameProp,
  minimal = false,
  extraActions,
  onExternalFileAdded,
}, ref) {
  const [message, setMessage] = useState("");
  const [noContext, setNoContext] = useState(false);

  // Set initial value when provided (e.g., when reusing a seed)
  useEffect(() => {
    if (initialValue) {
      setMessage(initialValue);
      onInitialValueUsed?.();
    }
  }, [initialValue, onInitialValueUsed]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);

  // @ mention state
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionStartPos, setMentionStartPos] = useState(-1);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

  // Auto-incremental asset counter - starts after preselected assets
  const nextAssetId = useRef(1);

  // Update asset counter based on preselected assets count
  useEffect(() => {
    if (assetMode) {
      const preselectedCount = preselectedImages.filter(img => img.assetLabel).length;
      const attachedCount = attachedFiles.filter(f => f.assetId).length;
      nextAssetId.current = preselectedCount + attachedCount + 1;
    } else if (attachedFiles.length === 0) {
      nextAssetId.current = 1;
    }
  }, [attachedFiles.length, assetMode, preselectedImages]);

  const maxFiles = maxFilesOverride ?? (assetMode ? MAX_FILES_ASSET_MODE : MAX_FILES);

  // Expose imperative method to inject files from outside
  useImperativeHandle(ref, () => ({
    addFiles: (files: AttachedFile[]) => {
      setAttachedFiles(prev => {
        const totalCurrent = prev.length + preselectedImages.length;
        const remainingSlots = maxFiles - totalCurrent;
        if (remainingSlots <= 0) return prev;

        // If adding into an empty list, reset counter to ensure sequential IDs from 1
        if (assetMode && prev.length === 0 && preselectedImages.length === 0) {
          nextAssetId.current = 1;
        }

        const filesToAdd: AttachedFile[] = [];
        for (const f of files) {
          if (filesToAdd.length >= remainingSlots) break;
          if (assetMode && f.type === "video") {
            const existingVideos = prev.filter(x => x.type === "video").length + filesToAdd.filter(x => x.type === "video").length;
            const preselectedVideos = preselectedImages.filter(img => img.url.includes("/video") || img.url.endsWith(".mp4")).length;
            if (existingVideos + preselectedVideos >= 1) continue; // max 1 video
          }
          const newFile = { ...f };
          if (assetMode && !newFile.assetId) {
            newFile.assetId = `asset${nextAssetId.current}`;
            nextAssetId.current++;
          }
          filesToAdd.push(newFile);
        }
        return filesToAdd.length > 0 ? [...prev, ...filesToAdd] : prev;
      });
    },
    clearFiles: () => {
      setAttachedFiles([]);
      nextAssetId.current = 1;
    },
    getFiles: () => attachedFiles,
    removeFileByUrl: (url: string) => {
      setAttachedFiles(prev => prev.filter(f => f.dataUrl !== url && f.sourceUrl !== url));
    },
    focus: () => {
      textareaRef.current?.focus();
    },
  }), [assetMode, maxFiles, preselectedImages, attachedFiles]);

  // Notify parent about full asset list (for voice bindings, limits, etc.)
  const prevAssetKeyRef = useRef("");
  useEffect(() => {
    if (!assetMode || !onAssetsChange) return;
    const assets: { assetId: string; type: string; label: string }[] = [];
    // Preselected assets from conversation
    preselectedImages.forEach((img) => {
      if (img.assetLabel) {
        const isVideo = img.url.includes("/video") || img.url.endsWith(".mp4");
        assets.push({ assetId: img.assetLabel, type: isVideo ? "video" : "image", label: isVideo ? "video del chat" : "imagen del chat" });
      }
    });
    // Attached files from disk
    attachedFiles.filter(f => f.assetId).forEach(f => {
      assets.push({ assetId: f.assetId!, type: f.type, label: f.name });
    });
    // Only update if list actually changed
    const key = assets.map(a => `${a.assetId}:${a.type}`).join(",");
    if (prevAssetKeyRef.current !== key) {
      prevAssetKeyRef.current = key;
      onAssetsChange(assets);
    }
  }, [assetMode, attachedFiles, preselectedImages, onAssetsChange]);

  // Get list of assets for @ mention (preselected from conversation + attached from disk)
  const assetList = useMemo(() => {
    const assets: Array<{ id: string; name: string; type: string; mimeType: string }> = [];

    // Add preselected images with asset labels (from conversation selection)
    if (assetMode) {
      preselectedImages.forEach((img) => {
        if (img.assetLabel) {
          const isVideo = img.url.includes("/video") || img.url.endsWith(".mp4");
          assets.push({
            id: img.assetLabel,
            name: isVideo ? "video del chat" : "imagen del chat",
            type: isVideo ? "video" : "image",
            mimeType: isVideo ? "video/mp4" : "image/png",
          });
        }
      });
    }

    // Add attached files with asset IDs
    attachedFiles
      .filter(f => f.assetId)
      .forEach(f => {
        assets.push({
          id: f.assetId!,
          name: f.name,
          type: f.type,
          mimeType: f.mimeType,
        });
      });

    return assets;
  }, [attachedFiles, assetMode, preselectedImages]);

  // Filtered assets based on mention filter
  const filteredAssets = useMemo(() => {
    if (!mentionFilter) return assetList;
    const lower = mentionFilter.toLowerCase();
    return assetList.filter(a => a.id.toLowerCase().includes(lower));
  }, [assetList, mentionFilter]);

  const handleFileSelect = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const totalCurrentFiles = attachedFiles.length + preselectedImages.length;
    const remainingSlots = maxFiles - totalCurrentFiles;

    if (remainingSlots <= 0) {
      alert(`Máximo ${maxFiles} archivos permitidos`);
      return;
    }

    const filesToProcess = fileArray.slice(0, remainingSlots);
    setIsProcessing(true);

    const newFiles: AttachedFile[] = [];

    for (const file of filesToProcess) {
      const fileType = getFileType(file.type, assetMode);

      if (!fileType) {
        const videoNote = assetMode ? "\n- Videos: MP4, MOV, WebM" : "";
        alert(`Tipo de archivo no soportado: ${file.name}\n\nFormatos permitidos:\n- Imágenes: JPG, PNG, GIF, WebP\n- Documentos: PDF\n- Audio: MP3, WAV, OGG, WebM${videoNote}`);
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

        const newFile: AttachedFile = {
          dataUrl,
          mimeType: file.type,
          name: file.name,
          type: fileType,
          size: file.size,
        };

        if (assetMode) {
          // Enforce max 1 video in asset mode
          if (fileType === "video") {
            const existingVideos = attachedFiles.filter(f => f.type === "video").length;
            const preselectedVideos = preselectedImages.filter(img => img.url.includes("/video") || img.url.endsWith(".mp4")).length;
            if (existingVideos + preselectedVideos >= 1) {
              alert("Kling soporta maximo 1 video como input");
              continue;
            }
          }
          newFile.assetId = `asset${nextAssetId.current}`;
          nextAssetId.current++;
        }

        newFiles.push(newFile);
      } catch (error) {
        console.error("Error reading file:", error);
      }
    }

    setAttachedFiles((prev) => [...prev, ...newFiles]);
    setIsProcessing(false);

    // Notify parent about externally added files (file picker, paste, desktop drag)
    if (onExternalFileAdded) {
      for (const f of newFiles) {
        onExternalFileAdded(f);
      }
    }
  }, [attachedFiles.length, preselectedImages.length, assetMode, maxFiles, onExternalFileAdded]);

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

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        const dt = new DataTransfer();
        imageFiles.forEach((f) => dt.items.add(f));
        handleFileSelect(dt.files);
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

  // Insert asset mention into message
  const insertMention = useCallback((assetId: string) => {
    const textarea = textareaRef.current;
    if (!textarea || mentionStartPos < 0) return;

    const before = message.substring(0, mentionStartPos);
    const after = message.substring(textarea.selectionStart);
    const newMessage = `${before}@${assetId} ${after}`;
    setMessage(newMessage);
    setShowMentionPopup(false);
    setMentionFilter("");
    setMentionStartPos(-1);
    setMentionSelectedIndex(0);

    // Set cursor position after the inserted mention
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const pos = before.length + assetId.length + 2; // +2 for @ and space
        textareaRef.current.selectionStart = pos;
        textareaRef.current.selectionEnd = pos;
        textareaRef.current.focus();
      }
    });
  }, [message, mentionStartPos]);

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
    onSend(message.trim(), allFiles.length > 0 ? allFiles : undefined, noContext);

    setMessage("");
    setAttachedFiles([]);
    setNoContext(false); // Reset after sending
    nextAssetId.current = 1; // Reset asset counter
  }, [message, attachedFiles, preselectedImages, disabled, onSend, noContext]);

  // Handle textarea changes for @ mention detection
  const handleMessageChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setMessage(value);

    if (assetMode && assetList.length > 0) {
      // Look backwards from cursor for @ trigger
      const textBeforeCursor = value.substring(0, cursorPos);
      const lastAtIndex = textBeforeCursor.lastIndexOf("@");

      if (lastAtIndex >= 0) {
        // Check that @ is at start of text or preceded by whitespace
        const charBefore = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : " ";
        if (charBefore === " " || charBefore === "\n" || lastAtIndex === 0) {
          const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
          // Only show popup if no space after @ (user is still typing the mention)
          if (!textAfterAt.includes(" ") && !textAfterAt.includes("\n")) {
            setMentionStartPos(lastAtIndex);
            setMentionFilter(textAfterAt);
            setShowMentionPopup(true);
            setMentionSelectedIndex(0);
            return;
          }
        }
      }
    }

    setShowMentionPopup(false);
  }, [assetMode, assetList.length]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Handle @ mention navigation
      if (showMentionPopup && filteredAssets.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionSelectedIndex(prev => Math.min(prev + 1, filteredAssets.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionSelectedIndex(prev => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          insertMention(filteredAssets[mentionSelectedIndex].id);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowMentionPopup(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, showMentionPopup, filteredAssets, mentionSelectedIndex, insertMention]
  );

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => {
      const newFiles = prev.filter((_, i) => i !== index);
      // Re-assign asset IDs to keep them sequential (after preselected assets)
      if (assetMode) {
        const preselectedCount = preselectedImages.filter(img => img.assetLabel).length;
        let counter = preselectedCount + 1;
        newFiles.forEach(f => {
          if (f.assetId) {
            f.assetId = `asset${counter}`;
            counter++;
          }
        });
        nextAssetId.current = counter;
      }
      return newFiles;
    });
  }, [assetMode, preselectedImages]);

  const renderFilePreview = (file: AttachedFile, index: number) => {
    const isVideo = file.type === "video";
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
        ) : isVideo ? (
          <div className="w-20 h-20 relative bg-black/20 flex items-center justify-center">
            <video
              src={file.dataUrl}
              className="w-full h-full object-cover"
              muted
            />
            <Film className="absolute h-6 w-6 text-white/80" />
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

        {/* Asset ID badge */}
        {file.assetId && (
          <div className="absolute top-0 left-0 right-0 bg-cyan-600/90 text-[9px] text-white text-center py-0.5 font-mono font-bold">
            {file.assetId}
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
        "bg-white dark:bg-[#111] rounded-2xl  border p-4 transition-colors",
        isDragging && "bg-primary/5 border-primary/50",
        classNameProp
      )}
      onDragOver={supportsFiles ? handleDragOver : undefined}
      onDragLeave={supportsFiles ? handleDragLeave : undefined}
      onDrop={supportsFiles ? handleDrop : undefined}
    >
      <div className="max-w-4xl mx-auto space-y-3">
        {/* Preview de archivos adjuntos e imágenes preseleccionadas */}
        {(attachedFiles.length > 0 || preselectedImages.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {/* Imágenes/videos preseleccionadas de la conversación */}
            {preselectedImages.map((img, index) => {
              const isVideoUrl = img.url.includes("/video") || img.url.endsWith(".mp4");
              return (
                <div
                  key={`preselected-${index}`}
                  className={cn(
                    "relative group rounded-lg overflow-hidden border-2 bg-card",
                    img.assetLabel ? "border-cyan-600/50 dark:border-cyan-500/50" : "border-primary/50"
                  )}
                >
                  <div className="w-20 h-20 relative">
                    {isVideoUrl ? (
                      <div className="w-full h-full bg-black/20 flex items-center justify-center">
                        <video src={img.url} className="w-full h-full object-cover" muted />
                        <Film className="absolute h-6 w-6 text-white/80" />
                      </div>
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={img.url}
                        alt={img.assetLabel || "Preseleccionada"}
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  {/* Badge indicador */}
                  <div className={cn(
                    "absolute top-0 left-0 right-0 text-[9px] text-center py-0.5 font-medium",
                    img.assetLabel
                      ? "bg-cyan-600/90 text-white font-mono font-bold"
                      : "bg-primary/90 text-primary-foreground text-[8px]"
                  )}>
                    {img.assetLabel || "Del chat"}
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
              );
            })}
            {/* Archivos adjuntos subidos */}
            {attachedFiles.map((file, index) => renderFilePreview(file, index))}
            {/* Botón agregar más */}
            {(attachedFiles.length + preselectedImages.length) < maxFiles && supportsFiles && (
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

        {/* Asset mode hint */}
        {assetMode && (attachedFiles.length > 0 || preselectedImages.length > 0) && (
          <div className="text-xs text-muted-foreground bg-cyan-100 dark:bg-cyan-950/30 border border-cyan-300 dark:border-cyan-800/30 rounded-md px-3 py-1.5">
            Usa <span className="font-mono text-cyan-700 dark:text-cyan-400 font-medium">@</span> en el prompt para referenciar assets. Ej: <span className="font-mono text-cyan-700 dark:text-cyan-400 font-medium">@asset1</span> caminando hacia <span className="font-mono text-cyan-700 dark:text-cyan-400 font-medium">@asset2</span>
            {attachedFiles.some(f => f.type === "video") || preselectedImages.some(img => img.url.includes("/video") || img.url.endsWith(".mp4")) ? (
              <span className="block mt-1 text-amber-700 dark:text-amber-400/80">Max 4 imagenes + 1 video. Audio deshabilitado con video input.</span>
            ) : null}
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
                accept={getAcceptString(assetMode)}
                onChange={handleFileInputChange}
                className="hidden"
                multiple
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || isProcessing || (attachedFiles.length + preselectedImages.length) >= maxFiles}
                className="shrink-0 h-10 w-10"
                title={`Adjuntar archivos (${attachedFiles.length + preselectedImages.length}/${maxFiles})`}
              >
                {isProcessing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Paperclip className="h-5 w-5" />
                )}
              </Button>
            </>
          )}

          {/* Textarea with @ mention popup */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={handleMessageChange}
              onKeyDown={handleKeyDown}
              onPaste={supportsFiles ? handlePaste : undefined}
              placeholder={assetMode && attachedFiles.length > 0
                ? "Escribe tu prompt... usa @ para referenciar assets"
                : placeholder
              }
              disabled={disabled}
              rows={minimal ? 2 : 3}
              className={cn(
                "w-full text-sm resize-none",
                minimal
                  ? "bg-transparent border-none px-3 py-1.5 focus:outline-none focus:ring-0"
                  : "bg-card border border-border/50 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50",
                "placeholder:text-muted-foreground",
                minimal ? "min-h-[44px] max-h-[200px]" : "min-h-[132px] max-h-[300px]",
                disabled && "opacity-50 cursor-not-allowed"
              )}
              style={{
                height: "auto",
                minHeight: minimal ? "44px" : "132px",
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, minimal ? 200 : 300)}px`;
              }}
              onBlur={() => {
                // Delay hiding to allow click on mention item
                setTimeout(() => setShowMentionPopup(false), 200);
              }}
            />

            {/* @ Mention Popup */}
            {showMentionPopup && filteredAssets.length > 0 && (
              <div
                ref={mentionListRef}
                className="absolute bottom-full mb-1 left-0 w-64 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50"
              >
                <div className="px-2 py-1.5 text-[10px] text-muted-foreground border-b border-border/50 font-medium uppercase tracking-wider">
                  Assets disponibles
                </div>
                {filteredAssets.map((asset, idx) => (
                  <button
                    key={asset.id}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left",
                      idx === mentionSelectedIndex
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(asset.id);
                    }}
                    onMouseEnter={() => setMentionSelectedIndex(idx)}
                  >
                    <span className={cn(
                      "w-5 h-5 rounded flex items-center justify-center shrink-0",
                      asset.type === "image" ? "bg-blue-500/20 text-blue-400" : "bg-purple-500/20 text-purple-400"
                    )}>
                      {asset.type === "image" ? (
                        <ImageIcon className="h-3 w-3" />
                      ) : (
                        <Film className="h-3 w-3" />
                      )}
                    </span>
                    <span className="font-mono text-cyan-700 dark:text-cyan-400 font-medium">{asset.id}</span>
                    <span className="text-muted-foreground text-xs truncate">
                      {asset.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 ml-auto uppercase">
                      {asset.type}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sin contexto checkbox */}
          {showNoContextOption && (
            <div className="flex items-center shrink-0">
              <label
                className={cn(
                  "flex items-center gap-1.5 text-xs cursor-pointer select-none px-2 py-1 rounded-md transition-colors",
                  noContext
                    ? "bg-orange-500/10 text-orange-400 border border-orange-500/30"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="Solo se enviará este mensaje, sin historial de conversación"
              >
                <input
                  type="checkbox"
                  checked={noContext}
                  onChange={(e) => setNoContext(e.target.checked)}
                  className="sr-only"
                />
                <span className={cn(
                  "w-3 h-3 rounded border flex items-center justify-center transition-colors",
                  noContext
                    ? "bg-orange-500 border-orange-500"
                    : "border-muted-foreground/50"
                )}>
                  {noContext && (
                    <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </span>
                <span>Sin contexto</span>
              </label>
            </div>
          )}

        </div>

        <div className="flex gap-2 justify-end">
          {extraActions}

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
            {assetMode && <Film className="h-4 w-4" />}
            <Music className="h-4 w-4" />
            <span>Suelta los archivos aquí</span>
          </div>
        )}

        {/* Contador de archivos */}
        {(attachedFiles.length > 0 || preselectedImages.length > 0) && (
          <div className="text-xs text-muted-foreground text-center">
            {attachedFiles.length + preselectedImages.length} de {maxFiles} archivos adjuntos
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
});
