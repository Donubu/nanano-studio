"use client";

import { Video, Volume2, VolumeX, ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";
import { VideoDuration, VideoResolution, VideoAspectRatio } from "@/types/video";

export type VideoProvider = "google" | "xai" | "kling";

interface VideoSettingsProps {
  duration: VideoDuration;
  resolution: VideoResolution;
  aspectRatio: VideoAspectRatio;
  audioEnabled: boolean;
  negativePrompt: string;
  disabled?: boolean;
  hasReferenceImages?: boolean;
  provider?: VideoProvider;
  onChange: (settings: {
    duration?: VideoDuration;
    resolution?: VideoResolution;
    aspectRatio?: VideoAspectRatio;
    audioEnabled?: boolean;
    negativePrompt?: string;
  }) => void;
}

// Provider-specific options
const GOOGLE_DURATIONS: { value: VideoDuration; label: string }[] = [
  { value: 4, label: "4s" },
  { value: 6, label: "6s" },
  { value: 8, label: "8s" },
];

const GOOGLE_RESOLUTIONS: { value: VideoResolution; label: string; note?: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p", note: "Solo 8s" },
];

const GOOGLE_ASPECT_RATIOS: { value: VideoAspectRatio; label: string }[] = [
  { value: "16:9", label: "Horizontal" },
  { value: "9:16", label: "Vertical" },
];

const XAI_RESOLUTIONS: { value: VideoResolution; label: string; note?: string }[] = [
  { value: "480p", label: "480p" },
  { value: "720p", label: "720p" },
];

const XAI_ASPECT_RATIOS: { value: VideoAspectRatio; label: string }[] = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
];

const KLING_RESOLUTIONS: { value: VideoResolution; label: string; note?: string }[] = [
  { value: "720p", label: "720p", note: "Standard" },
  { value: "1080p", label: "1080p", note: "Pro" },
];

const KLING_ASPECT_RATIOS: { value: VideoAspectRatio; label: string }[] = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
];

export function VideoSettings({
  duration,
  resolution,
  aspectRatio,
  audioEnabled,
  negativePrompt,
  disabled = false,
  hasReferenceImages = false,
  provider = "google",
  onChange,
}: VideoSettingsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const isXai = provider === "xai";
  const isKling = provider === "kling";

  const resolutions = isKling ? KLING_RESOLUTIONS : isXai ? XAI_RESOLUTIONS : GOOGLE_RESOLUTIONS;
  const aspectRatios = isKling ? KLING_ASPECT_RATIOS : isXai ? XAI_ASPECT_RATIOS : GOOGLE_ASPECT_RATIOS;

  // Google VEO: 1080p only available for 8s. Kling: 1080p (pro) available for all durations.
  const has1080pRestriction = !isKling && !isXai;

  const handleDurationChange = (newDuration: VideoDuration) => {
    if (has1080pRestriction && resolution === "1080p" && newDuration !== 8) {
      onChange({ duration: newDuration, resolution: "720p" });
    } else {
      onChange({ duration: newDuration });
    }
  };

  const handleResolutionChange = (newResolution: VideoResolution) => {
    if (has1080pRestriction && newResolution === "1080p" && duration !== 8) {
      onChange({ resolution: newResolution, duration: 8 });
    } else {
      onChange({ resolution: newResolution });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Video className="w-4 h-4" />
        <span>Configuración de Video</span>
      </div>

      {/* Duración */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">
          Duración {(isXai || isKling) && <span className="text-muted-foreground/60">({duration}s)</span>}
        </Label>
        {(isXai || isKling) ? (
          <>
            <Slider
              value={[duration]}
              onValueChange={([val]) => onChange({ duration: val })}
              min={isKling ? 3 : 1}
              max={15}
              step={1}
              disabled={disabled}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground/60">
              <span>{isKling ? "3s" : "1s"}</span>
              <span>15s</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-2">
              {GOOGLE_DURATIONS.map((d) => {
                const isDisabledByRefImages = hasReferenceImages && d.value !== 8;
                const isButtonDisabled = disabled || isDisabledByRefImages;
                return (
                  <button
                    key={d.value}
                    disabled={isButtonDisabled}
                    onClick={() => handleDurationChange(d.value)}
                    className={`flex-1 py-2 px-3 text-sm rounded-md border transition-colors ${
                      duration === d.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border hover:bg-muted"
                    } ${isButtonDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            {hasReferenceImages && (
              <p className="text-xs text-amber-500">
                Con imagenes de referencia solo se permite 8 segundos
              </p>
            )}
          </>
        )}
      </div>

      {/* Resolución */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Resolución</Label>
        <div className="flex gap-2">
          {resolutions.map((r) => {
            const is1080pDisabled = has1080pRestriction && r.value === "1080p" && duration !== 8;
            return (
              <button
                key={r.value}
                disabled={disabled || is1080pDisabled}
                onClick={() => handleResolutionChange(r.value)}
                className={`flex-1 py-2 px-3 text-sm rounded-md border transition-colors ${
                  resolution === r.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                } ${disabled || is1080pDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                title={r.note}
              >
                <div className="font-medium">{r.label}</div>
                {r.note && (
                  <div className={`text-xs ${resolution === r.value ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                    {r.note}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {has1080pRestriction && resolution === "1080p" && duration !== 8 && (
          <p className="text-xs text-muted-foreground">
            1080p solo disponible para videos de 8 segundos
          </p>
        )}
      </div>

      {/* Aspect Ratio */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Proporcion</Label>
        <div className={`grid gap-2 ${isXai ? "grid-cols-4" : isKling ? "grid-cols-3" : "grid-cols-2"}`}>
          {aspectRatios.map((ar) => (
            <button
              key={ar.value}
              disabled={disabled}
              onClick={() => onChange({ aspectRatio: ar.value })}
              className={`py-2 px-2 text-sm rounded-md border transition-colors flex items-center justify-center gap-1.5 ${
                aspectRatio === ar.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <span>{ar.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Audio Toggle - Google and Kling support audio, xAI does not */}
      {!isXai && (
        <>
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              {audioEnabled ? (
                <Volume2 className="w-4 h-4 text-muted-foreground" />
              ) : (
                <VolumeX className="w-4 h-4 text-muted-foreground" />
              )}
              <Label className="text-sm">Audio nativo</Label>
            </div>
            <Switch
              checked={audioEnabled}
              onCheckedChange={(checked) => onChange({ audioEnabled: checked })}
              disabled={disabled}
            />
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            {isKling
              ? "Kling genera audio nativo sincronizado (dialogos, efectos)"
              : "VEO genera audio nativo (dialogos, efectos, ambiente)"}
          </p>
        </>
      )}

      {/* Opciones avanzadas - Google and Kling support negative prompt, xAI does not */}
      {!isXai && (
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
                placeholder="Describe lo que NO quieres en el video..."
                className="min-h-[60px] text-sm resize-none"
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                Contenido que deseas evitar en el video generado
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
