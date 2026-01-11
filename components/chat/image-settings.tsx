"use client";

import { ImageIcon, ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";

export type ImagenAspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
export type ImagenResolution = "1K" | "2K" | "4K";

interface ImageSettingsProps {
  aspectRatio: ImagenAspectRatio;
  resolution: ImagenResolution;
  negativePrompt?: string;
  disabled?: boolean;
  onChange: (settings: {
    aspectRatio?: ImagenAspectRatio;
    resolution?: ImagenResolution;
    negativePrompt?: string;
  }) => void;
}

export function ImageSettings({
  aspectRatio,
  resolution,
  negativePrompt = "",
  disabled = false,
  onChange,
}: ImageSettingsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const aspectRatios: { value: ImagenAspectRatio; label: string; icon: "square" | "portrait" | "landscape" }[] = [
    { value: "1:1", label: "1:1", icon: "square" },
    { value: "3:4", label: "3:4", icon: "portrait" },
    { value: "4:3", label: "4:3", icon: "landscape" },
    { value: "9:16", label: "9:16", icon: "portrait" },
    { value: "16:9", label: "16:9", icon: "landscape" },
  ];

  const resolutions: { value: ImagenResolution; label: string; description: string }[] = [
    { value: "1K", label: "1K", description: "1024px" },
    { value: "2K", label: "2K", description: "2048px" },
    { value: "4K", label: "4K", description: "4096px" },
  ];

  const getIconDimensions = (icon: "square" | "portrait" | "landscape") => {
    switch (icon) {
      case "square":
        return "w-4 h-4";
      case "portrait":
        return "w-3 h-5";
      case "landscape":
        return "w-5 h-3";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ImageIcon className="w-4 h-4" />
        <span>Configuracion de Imagen</span>
      </div>

      {/* Aspect Ratio */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Proporcion</Label>
        <div className="grid grid-cols-5 gap-1">
          {aspectRatios.map((ar) => (
            <button
              key={ar.value}
              disabled={disabled}
              onClick={() => onChange({ aspectRatio: ar.value })}
              className={`py-2 px-1 text-xs rounded-md border transition-colors flex flex-col items-center justify-center gap-1 ${
                aspectRatio === ar.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div
                className={`border-2 ${getIconDimensions(ar.icon)} ${
                  aspectRatio === ar.value
                    ? "border-primary-foreground"
                    : "border-current"
                } rounded-sm`}
              />
              <span>{ar.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Resolution */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Resolucion</Label>
        <div className="flex gap-2">
          {resolutions.map((r) => (
            <button
              key={r.value}
              disabled={disabled}
              onClick={() => onChange({ resolution: r.value })}
              className={`flex-1 py-2 px-3 text-sm rounded-md border transition-colors ${
                resolution === r.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div className="font-medium">{r.label}</div>
              <div className={`text-xs ${resolution === r.value ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                {r.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Opciones avanzadas */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronDown
            className={`w-4 h-4 transition-transform ${
              advancedOpen ? "rotate-180" : ""
            }`}
          />
          <span>Opciones avanzadas</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Prompt negativo
            </Label>
            <Textarea
              value={negativePrompt}
              onChange={(e) => onChange({ negativePrompt: e.target.value })}
              placeholder="Describe lo que NO quieres en la imagen..."
              className="min-h-[60px] text-sm resize-none"
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              Contenido que deseas evitar en la imagen generada
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
