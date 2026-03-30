"use client";

import { ImageIcon, ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState, useEffect } from "react";

export type ImagenAspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
export type ImagenResolution = "1K" | "2K" | "4K";

interface ImageSettingsProps {
  aspectRatio: ImagenAspectRatio;
  resolution: ImagenResolution;
  numberOfImages: number;
  negativePrompt?: string;
  disabled?: boolean;
  modelId?: string;
  isAdmin?: boolean;
  onChange: (settings: {
    aspectRatio?: ImagenAspectRatio;
    resolution?: ImagenResolution;
    numberOfImages?: number;
    negativePrompt?: string;
  }) => void;
}

/**
 * Calculate daily PIN: DDYYYY - 1500
 */
/**
 * Daily PIN: always 6 digits.
 * Formula: DDMMYY → reverse to YYMMDD → add 1234 → take last 6 digits
 */
export function getDailyPin(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(2);
  const reversed = parseInt(`${yy}${mm}${dd}`, 10);
  return String(reversed + 1234).slice(-6).padStart(6, "0");
}

export function ImageSettings({
  aspectRatio,
  resolution,
  numberOfImages,
  negativePrompt = "",
  disabled = false,
  modelId,
  isAdmin = false,
  onChange,
}: ImageSettingsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pinDialogFor, setPinDialogFor] = useState<number | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);

  const isGrok = modelId?.includes("grok-imagine-image") ?? false;
  const isKling = modelId?.includes("kling-omni-image") ?? false;

  // Auto-correct unsupported values when switching models
  useEffect(() => {
    if ((isGrok || isKling) && resolution === "4K") {
      onChange({ resolution: "2K" });
    }
    if (isGrok && numberOfImages > 10) {
      onChange({ numberOfImages: 10 });
    }
    if (isKling && numberOfImages > 9) {
      onChange({ numberOfImages: 9 });
    }
  }, [isGrok, isKling, resolution, numberOfImages, onChange]);

  const defaultAspectRatios: { value: ImagenAspectRatio; label: string; icon: "square" | "portrait" | "landscape" }[] = [
    { value: "1:1", label: "1:1", icon: "square" },
    { value: "3:4", label: "3:4", icon: "portrait" },
    { value: "4:3", label: "4:3", icon: "landscape" },
    { value: "9:16", label: "9:16", icon: "portrait" },
    { value: "16:9", label: "16:9", icon: "landscape" },
  ];

  const klingAspectRatios: { value: ImagenAspectRatio; label: string; icon: "square" | "portrait" | "landscape" }[] = [
    { value: "1:1", label: "1:1", icon: "square" },
    { value: "3:4", label: "3:4", icon: "portrait" },
    { value: "4:3", label: "4:3", icon: "landscape" },
    { value: "9:16", label: "9:16", icon: "portrait" },
    { value: "16:9", label: "16:9", icon: "landscape" },
    { value: "3:2" as ImagenAspectRatio, label: "3:2", icon: "landscape" },
    { value: "2:3" as ImagenAspectRatio, label: "2:3", icon: "portrait" },
  ];

  const aspectRatios = isKling ? klingAspectRatios : defaultAspectRatios;

  const allResolutions: { value: ImagenResolution; label: string; description: string }[] = [
    { value: "1K", label: "1K", description: "1024px" },
    { value: "2K", label: "2K", description: "2048px" },
    { value: "4K", label: "4K", description: "4096px" },
  ];

  // Grok and Kling only support 1K and 2K
  const resolutions = (isGrok || isKling)
    ? allResolutions.filter(r => r.value !== "4K")
    : allResolutions;

  // Kling: up to 9, Grok: up to 10, Imagen 4: up to 4
  const maxImages = isKling ? 9 : isGrok ? 10 : 4;
  const imageCountOptions = isKling ? [1, 2, 4, 6, 9] : isGrok ? [1, 2, 4, 6, 10] : [1, 2, 3, 4];

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
              onClick={() => {
                if (r.value === "4K" && resolution !== "4K") {
                  if (!window.confirm("La generacion en 4K tarda en promedio 4 minutos. Deseas continuar?")) return;
                }
                onChange({ resolution: r.value });
              }}
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

      {/* Number of Images */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Cantidad de imagenes</Label>
          {isAdmin && <span className="text-xs text-muted-foreground/50 font-mono">PIN: {getDailyPin()}</span>}
        </div>
        <div className="flex gap-2">
          {imageCountOptions.map((n) => (
            <button
              key={n}
              disabled={disabled}
              onClick={() => {
                if (n >= 3) {
                  setPinDialogFor(n);
                  setPinInput("");
                  setPinError(false);
                } else {
                  onChange({ numberOfImages: n });
                }
              }}
              className={`flex-1 py-2 px-3 text-sm rounded-md border transition-colors ${
                numberOfImages === n
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              {n}
            </button>
          ))}
        </div>
        {/* PIN Dialog */}
        {pinDialogFor !== null && (
          <div className="flex items-center gap-2 mt-2 p-2 rounded-md bg-muted/50 border border-border">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={pinInput}
              onChange={(e) => {
                setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6));
                setPinError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (pinInput === getDailyPin()) {
                    onChange({ numberOfImages: pinDialogFor });
                    setPinDialogFor(null);
                  } else {
                    setPinError(true);
                  }
                } else if (e.key === "Escape") {
                  setPinDialogFor(null);
                }
              }}
              placeholder={`PIN para generar ${pinDialogFor} imagenes`}
              className={`flex-1 px-2 py-1 text-sm rounded border bg-background outline-none ${pinError ? "border-red-500" : "border-border"}`}
              autoFocus
            />
            <button
              onClick={() => {
                if (pinInput === getDailyPin()) {
                  onChange({ numberOfImages: pinDialogFor });
                  setPinDialogFor(null);
                } else {
                  setPinError(true);
                }
              }}
              className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90"
            >
              OK
            </button>
            <button
              onClick={() => setPinDialogFor(null)}
              className="px-2 py-1 text-sm rounded text-muted-foreground hover:text-foreground"
            >
              &times;
            </button>
          </div>
        )}
      </div>

      {/* Opciones avanzadas (only for models that support negative prompt) */}
      {!isGrok && !isKling && (
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
      )}
    </div>
  );
}
