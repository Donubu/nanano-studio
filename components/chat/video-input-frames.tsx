"use client";

import { useState } from "react";
import { X, Image as ImageIcon, Info, ImagePlus, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ImagePickerModal } from "./image-picker-modal";

export type ReferenceType = "ASSET" | "STYLE";

export interface ReferenceImage {
  image: string;
  type: ReferenceType;
  sourceUrl?: string;
}

export type VideoInputProvider = "google" | "xai" | "kling" | "omni" | "seedance";

interface VideoInputFramesProps {
  projectId: number;
  firstFrame: string | null;
  lastFrame: string | null;
  referenceImages: ReferenceImage[];
  onFirstFrameChange: (image: string | null) => void;
  onLastFrameChange: (image: string | null) => void;
  onReferenceImagesChange: (images: ReferenceImage[]) => void;
  disabled?: boolean;
  supportsReferenceImages?: boolean;
  provider?: VideoInputProvider;
  maxReferenceImages?: number; // default 3 (VEO); Seedance acepta más
  isGeminiBackend?: boolean; // Gemini API: reference images and first/last frame are mutually exclusive
}

type ModalMode = "first" | "last" | "reference" | null;
type DragTarget = "first" | "last" | "reference" | null;

export function VideoInputFrames({
  projectId,
  firstFrame,
  lastFrame,
  referenceImages,
  onFirstFrameChange,
  onLastFrameChange,
  onReferenceImagesChange,
  disabled = false,
  supportsReferenceImages = false,
  provider = "google",
  maxReferenceImages = 3,
  isGeminiBackend = false,
}: VideoInputFramesProps) {
  const isXai = provider === "xai";
  // Seedance: referencias arrobables como @ref1, @ref2… (el backend traduce a @ImageN)
  const isSeedance = provider === "seedance";
  // Gemini Omni v1: solo first frame (sin last frame ni referencias)
  const isOmni = provider === "omni";
  const [modalMode, setModalMode] = useState<ModalMode>(null);

  // Gemini API: reference images and first/last frame are mutually exclusive
  const hasFrames = !!(firstFrame || lastFrame);
  const hasReferences = referenceImages.length > 0;
  const framesDisabledByReferences = isGeminiBackend && hasReferences;
  const referencesDisabledByFrames = isGeminiBackend && hasFrames;
  const [dragOverTarget, setDragOverTarget] = useState<DragTarget>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Convertir URL a base64
  const urlToBase64 = async (url: string): Promise<string> => {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Convertir archivo local a base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Aplicar imagen al target correspondiente
  const applyToTarget = (target: DragTarget, base64: string) => {
    if (target === "first") {
      onFirstFrameChange(base64);
    } else if (target === "last") {
      onLastFrameChange(base64);
    } else if (target === "reference") {
      if (referenceImages.length < maxReferenceImages) {
        onReferenceImagesChange([
          ...referenceImages,
          { image: base64, type: "ASSET" },
        ]);
      }
    }
  };

  // Handler de drag over
  const handleDragOver = (e: React.DragEvent, target: DragTarget) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setDragOverTarget(target);
    }
  };

  // Handler de drag leave
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);
  };

  // Handler de drop
  const handleDrop = async (e: React.DragEvent, target: DragTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);

    if (disabled || !target) return;

    setIsUploading(true);

    try {
      // Caso 1: Imagen del chat (datos de nanano)
      const nanonoData = e.dataTransfer.getData("application/x-nanano-image");
      if (nanonoData) {
        const { url } = JSON.parse(nanonoData);
        const base64 = await urlToBase64(url);
        applyToTarget(target, base64);
        return;
      }

      // Caso 2: URL directa
      const uriList = e.dataTransfer.getData("text/uri-list");
      if (uriList && uriList.startsWith("http")) {
        const base64 = await urlToBase64(uriList);
        applyToTarget(target, base64);
        return;
      }

      // Caso 3: Archivo local del escritorio
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.type.startsWith("image/")) {
          const base64 = await fileToBase64(file);

          // Subir a S3 para guardar en el proyecto
          try {
            await fetch(`/api/projects/${projectId}/uploads`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                imageData: base64,
                fileName: file.name,
              }),
            });
          } catch (uploadError) {
            console.error("Error subiendo imagen:", uploadError);
            // Continuar de todas formas con la imagen local
          }

          applyToTarget(target, base64);
        }
      }
    } catch (error) {
      console.error("Error procesando drop:", error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleImageSelect = (imageUrl: string, referenceType?: ReferenceType) => {
    if (modalMode === "first") {
      onFirstFrameChange(imageUrl);
    } else if (modalMode === "last") {
      onLastFrameChange(imageUrl);
    } else if (modalMode === "reference" && referenceType) {
      if (referenceImages.length < maxReferenceImages) {
        onReferenceImagesChange([
          ...referenceImages,
          { image: imageUrl, type: referenceType },
        ]);
      }
    }
    setModalMode(null);
  };

  const removeReferenceImage = (index: number) => {
    const newImages = [...referenceImages];
    newImages.splice(index, 1);
    onReferenceImagesChange(newImages);
  };

  const getModalTitle = () => {
    switch (modalMode) {
      case "first":
        return "Seleccionar First Frame";
      case "last":
        return "Seleccionar Last Frame";
      case "reference":
        return "Seleccionar Imagen de Referencia";
      default:
        return "";
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ImageIcon className="w-4 h-4" />
          <span>{isXai ? "Imagen de Entrada" : "Frames de Entrada"}</span>
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-3.5 h-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {isXai ? (
                <p>
                  Puedes usar una imagen como base para generar el video (image-to-video).
                </p>
              ) : (
                <p>
                  Puedes usar imagenes para guiar la generacion del video:
                  <br />
                  <strong>First frame:</strong> Imagen inicial del video
                  <br />
                  <strong>Last frame:</strong> Imagen final (el video interpolara entre ambas)
                  <br />
                  <strong>Referencias:</strong> Imagenes de estilo (STYLE) o contenido (ASSET)
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* First Frame / Source Image */}
        <div className={cn("space-y-2", framesDisabledByReferences && "opacity-40 pointer-events-none")}>
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            {isXai ? "Imagen base" : "First Frame"}
            <span className="text-muted-foreground/60">
              {framesDisabledByReferences ? "(bloqueado por referencias)" : "(opcional)"}
            </span>
          </Label>
          {firstFrame ? (
            <div
              className={cn(
                "relative w-full aspect-video rounded-md overflow-hidden border-2 transition-colors",
                dragOverTarget === "first"
                  ? "border-primary bg-primary/10"
                  : "border-border"
              )}
              onDragOver={(e) => handleDragOver(e, "first")}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, "first")}
            >
              <img
                src={firstFrame}
                alt="First frame"
                className="w-full h-full object-cover"
              />
              <Button
                variant="destructive"
                size="icon"
                className="absolute top-1 right-1 h-6 w-6"
                onClick={() => onFirstFrameChange(null)}
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </Button>
              <div className="absolute bottom-1 left-1 bg-black/60 rounded px-1.5 py-0.5 text-xs text-white">
                Inicio
              </div>
              {dragOverTarget === "first" && (
                <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                  <span className="text-sm font-medium text-primary">Reemplazar</span>
                </div>
              )}
            </div>
          ) : (
            <div
              className={cn(
                "w-full aspect-video rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-colors",
                disabled
                  ? "opacity-50 cursor-not-allowed border-border"
                  : dragOverTarget === "first"
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary hover:bg-muted/50 cursor-pointer"
              )}
              onClick={() => !disabled && setModalMode("first")}
              onDragOver={(e) => handleDragOver(e, "first")}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, "first")}
            >
              {isUploading && dragOverTarget === "first" ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-muted-foreground">Procesando...</span>
                </div>
              ) : dragOverTarget === "first" ? (
                <>
                  <Upload className="w-6 h-6 text-primary" />
                  <span className="text-xs text-primary font-medium">Soltar aquí</span>
                </>
              ) : (
                <>
                  <ImagePlus className="w-6 h-6 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Arrastra o haz clic
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Last Frame - not supported by xAI or Gemini Omni */}
        {!isXai && !isOmni && <div className={cn("space-y-2", framesDisabledByReferences && "opacity-40 pointer-events-none")}>
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            Last Frame
            <span className="text-muted-foreground/60">
              {framesDisabledByReferences ? "(bloqueado por referencias)" : "(opcional)"}
            </span>
          </Label>
          {lastFrame ? (
            <div
              className={cn(
                "relative w-full aspect-video rounded-md overflow-hidden border-2 transition-colors",
                dragOverTarget === "last"
                  ? "border-primary bg-primary/10"
                  : "border-border"
              )}
              onDragOver={(e) => handleDragOver(e, "last")}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, "last")}
            >
              <img
                src={lastFrame}
                alt="Last frame"
                className="w-full h-full object-cover"
              />
              <Button
                variant="destructive"
                size="icon"
                className="absolute top-1 right-1 h-6 w-6"
                onClick={() => onLastFrameChange(null)}
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </Button>
              <div className="absolute bottom-1 left-1 bg-black/60 rounded px-1.5 py-0.5 text-xs text-white">
                Final
              </div>
              {dragOverTarget === "last" && (
                <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                  <span className="text-sm font-medium text-primary">Reemplazar</span>
                </div>
              )}
            </div>
          ) : (
            <div
              className={cn(
                "w-full aspect-video rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-colors",
                disabled
                  ? "opacity-50 cursor-not-allowed border-border"
                  : dragOverTarget === "last"
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary hover:bg-muted/50 cursor-pointer"
              )}
              onClick={() => !disabled && setModalMode("last")}
              onDragOver={(e) => handleDragOver(e, "last")}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, "last")}
            >
              {isUploading && dragOverTarget === "last" ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-muted-foreground">Procesando...</span>
                </div>
              ) : dragOverTarget === "last" ? (
                <>
                  <Upload className="w-6 h-6 text-primary" />
                  <span className="text-xs text-primary font-medium">Soltar aquí</span>
                </>
              ) : (
                <>
                  <ImagePlus className="w-6 h-6 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Arrastra o haz clic
                  </span>
                </>
              )}
            </div>
          )}
          {firstFrame && lastFrame && (
            <p className="text-xs text-muted-foreground">
              El video interpolara entre ambas imagenes
            </p>
          )}
        </div>}

        {/* Reference Images - not supported by xAI or Gemini Omni (v1) */}
        {supportsReferenceImages && !isXai && !isOmni && (
          <div className={cn("space-y-2", referencesDisabledByFrames && "opacity-40 pointer-events-none")}>
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              Imágenes de Referencia
              <span className="text-muted-foreground/60">
                {referencesDisabledByFrames ? "(bloqueado por frames)" : `(${referenceImages.length}/${maxReferenceImages})`}
              </span>
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {referenceImages.map((ref, index) => (
                <div
                  key={index}
                  className="relative aspect-square rounded-md overflow-hidden border border-border"
                >
                  <img
                    src={ref.image}
                    alt={`Reference ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-0.5 right-0.5 h-5 w-5"
                    onClick={() => removeReferenceImage(index)}
                    disabled={disabled}
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                  {/* Type badge */}
                  <div className={`absolute bottom-0.5 left-0.5 rounded px-1 py-0.5 text-[9px] font-medium ${
                    ref.type === "STYLE"
                      ? "bg-purple-500/80 text-white"
                      : "bg-blue-500/80 text-white"
                  }`}>
                    {isSeedance ? `@ref${index + 1}` : ref.type}
                  </div>
                </div>
              ))}
              {referenceImages.length < maxReferenceImages && (
                <div
                  className={cn(
                    "aspect-square rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors",
                    disabled
                      ? "opacity-50 cursor-not-allowed border-border"
                      : dragOverTarget === "reference"
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary hover:bg-muted/50 cursor-pointer"
                  )}
                  onClick={() => !disabled && setModalMode("reference")}
                  onDragOver={(e) => handleDragOver(e, "reference")}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, "reference")}
                >
                  {isUploading && dragOverTarget === "reference" ? (
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  ) : dragOverTarget === "reference" ? (
                    <>
                      <Upload className="w-4 h-4 text-primary" />
                      <span className="text-[10px] text-primary font-medium">Soltar</span>
                    </>
                  ) : (
                    <>
                      <ImagePlus className="w-4 h-4 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">Agregar</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="text-blue-400">ASSET</span> = contenido, <span className="text-purple-400">STYLE</span> = estilo visual
            </p>
          </div>
        )}

        {/* Image Picker Modal */}
        <ImagePickerModal
          projectId={projectId}
          isOpen={modalMode !== null}
          onClose={() => setModalMode(null)}
          onSelect={handleImageSelect}
          title={getModalTitle()}
          showReferenceTypeSelector={modalMode === "reference"}
        />
      </div>
    </TooltipProvider>
  );
}
