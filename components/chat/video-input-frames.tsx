"use client";

import { useState } from "react";
import { X, Image as ImageIcon, Info, ImagePlus } from "lucide-react";
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
}

interface VideoInputFramesProps {
  projectId: number;
  firstFrame: string | null;
  lastFrame: string | null;
  referenceImages: ReferenceImage[];
  onFirstFrameChange: (image: string | null) => void;
  onLastFrameChange: (image: string | null) => void;
  onReferenceImagesChange: (images: ReferenceImage[]) => void;
  disabled?: boolean;
}

type ModalMode = "first" | "last" | "reference" | null;

export function VideoInputFrames({
  projectId,
  firstFrame,
  lastFrame,
  referenceImages,
  onFirstFrameChange,
  onLastFrameChange,
  onReferenceImagesChange,
  disabled = false,
}: VideoInputFramesProps) {
  const [modalMode, setModalMode] = useState<ModalMode>(null);

  const handleImageSelect = (imageUrl: string, referenceType?: ReferenceType) => {
    if (modalMode === "first") {
      onFirstFrameChange(imageUrl);
    } else if (modalMode === "last") {
      onLastFrameChange(imageUrl);
    } else if (modalMode === "reference" && referenceType) {
      if (referenceImages.length < 3) {
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
          <span>Frames de Entrada</span>
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-3.5 h-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>
                Puedes usar imágenes para guiar la generación del video:
                <br />
                <strong>First frame:</strong> Imagen inicial del video
                <br />
                <strong>Last frame:</strong> Imagen final (el video interpolará entre ambas)
                <br />
                <strong>Referencias:</strong> Imágenes de estilo (STYLE) o contenido (ASSET)
              </p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* First Frame */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            First Frame
            <span className="text-muted-foreground/60">(opcional)</span>
          </Label>
          {firstFrame ? (
            <div className="relative w-full aspect-video rounded-md overflow-hidden border border-border">
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
            </div>
          ) : (
            <button
              onClick={() => setModalMode("first")}
              disabled={disabled}
              className={`w-full aspect-video rounded-md border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 transition-colors ${
                disabled
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:border-primary hover:bg-muted/50 cursor-pointer"
              }`}
            >
              <ImagePlus className="w-6 h-6 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Seleccionar imagen inicial
              </span>
            </button>
          )}
        </div>

        {/* Last Frame */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            Last Frame
            <span className="text-muted-foreground/60">(opcional)</span>
          </Label>
          {lastFrame ? (
            <div className="relative w-full aspect-video rounded-md overflow-hidden border border-border">
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
            </div>
          ) : (
            <button
              onClick={() => setModalMode("last")}
              disabled={disabled}
              className={`w-full aspect-video rounded-md border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 transition-colors ${
                disabled
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:border-primary hover:bg-muted/50 cursor-pointer"
              }`}
            >
              <ImagePlus className="w-6 h-6 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Seleccionar imagen final
              </span>
            </button>
          )}
          {firstFrame && lastFrame && (
            <p className="text-xs text-muted-foreground">
              El video interpolará entre ambas imágenes
            </p>
          )}
        </div>

        {/* Reference Images */}
        {/* TODO: Cambiar a true cuando Google habilite el acceso */}
        {false ? (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              Imágenes de Referencia
              <span className="text-muted-foreground/60">
                ({referenceImages.length}/3)
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
                    {ref.type}
                  </div>
                </div>
              ))}
              {referenceImages.length < 3 && (
                <button
                  onClick={() => setModalMode("reference")}
                  disabled={disabled}
                  className={`aspect-square rounded-md border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 transition-colors ${
                    disabled
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:border-primary hover:bg-muted/50 cursor-pointer"
                  }`}
                >
                  <ImagePlus className="w-4 h-4 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">Agregar</span>
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="text-blue-400">ASSET</span> = contenido, <span className="text-purple-400">STYLE</span> = estilo visual
            </p>
          </div>
        ) : (
          <div className="space-y-2 opacity-50">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              Imágenes de Referencia
              <span className="text-muted-foreground/60">
                (no disponible)
              </span>
            </Label>
            <div className="p-3 rounded-md border border-dashed border-border bg-muted/20">
              <p className="text-xs text-muted-foreground text-center">
                Esta función requiere acceso especial de Google Cloud.
                <br />
                <span className="text-muted-foreground/60">Solo first/last frame disponibles.</span>
              </p>
            </div>
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
