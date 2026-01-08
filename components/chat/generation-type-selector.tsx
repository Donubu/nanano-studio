"use client";

import { MessageSquare, ImageIcon, Video, Mic } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type GenerationType = "text" | "image" | "video" | "audio";

interface GenerationTypeConfig {
  type: GenerationType;
  isEnabled: boolean;
}

interface GenerationTypeSelectorProps {
  enabledTypes: GenerationTypeConfig[];
  selectedType: GenerationType | null;
  onSelect: (type: GenerationType) => void;
  disabled?: boolean;
}

const typeConfig: Record<GenerationType, { icon: typeof MessageSquare; label: string }> = {
  text: { icon: MessageSquare, label: "Texto" },
  image: { icon: ImageIcon, label: "Imagen" },
  video: { icon: Video, label: "Video" },
  audio: { icon: Mic, label: "Audio" },
};

const typeOrder: GenerationType[] = ["text", "image", "video", "audio"];

export function GenerationTypeSelector({
  enabledTypes,
  selectedType,
  onSelect,
  disabled,
}: GenerationTypeSelectorProps) {
  // Create a map for quick lookup
  const enabledMap = new Map(enabledTypes.map(t => [t.type, t.isEnabled]));

  return (
    <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
      {typeOrder.map((type) => {
        const config = typeConfig[type];
        const Icon = config.icon;
        const isEnabled = enabledMap.get(type) ?? false;
        const isSelected = selectedType === type;

        if (!enabledMap.has(type)) {
          // Type not configured for this project at all
          return null;
        }

        return (
          <Tooltip key={type}>
            <TooltipTrigger asChild>
              <button
                onClick={() => isEnabled && onSelect(type)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  !isEnabled
                    ? "text-muted-foreground/50 cursor-not-allowed"
                    : isSelected
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                }`}
                disabled={disabled || !isEnabled}
              >
                <Icon className="w-4 h-4" />
                {config.label}
              </button>
            </TooltipTrigger>
            {!isEnabled && (
              <TooltipContent>
                La generación de {config.label.toLowerCase()} no está habilitada para este proyecto
              </TooltipContent>
            )}
          </Tooltip>
        );
      })}
    </div>
  );
}

// Compact version for use in conversation header or sidebar
export function GenerationTypeBadge({ type }: { type: GenerationType }) {
  const config = typeConfig[type];
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="w-3 h-3" />
      <span>{config.label}</span>
    </div>
  );
}
