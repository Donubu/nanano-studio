"use client";

import { Video, Image as ImageIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type GenerationMode = "video" | "image";

interface GenerationModeSelectorProps {
  mode: GenerationMode;
  onChange: (mode: GenerationMode) => void;
  disabled?: boolean;
  imageDisabled?: boolean;
}

export function GenerationModeSelector({
  mode,
  onChange,
  disabled,
  imageDisabled,
}: GenerationModeSelectorProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
      <button
        onClick={() => onChange("video")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          mode === "video"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
        disabled={disabled}
      >
        <Video className="w-4 h-4" />
        Video
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => !imageDisabled && onChange("image")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              imageDisabled
                ? "text-muted-foreground/50 cursor-not-allowed"
                : mode === "image"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
            }`}
            disabled={disabled || imageDisabled}
          >
            <ImageIcon className="w-4 h-4" />
            Imagen
          </button>
        </TooltipTrigger>
        {imageDisabled && (
          <TooltipContent>
            No hay modelos de imagen disponibles en este proyecto
          </TooltipContent>
        )}
      </Tooltip>
    </div>
  );
}
