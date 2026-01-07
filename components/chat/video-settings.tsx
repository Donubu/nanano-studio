"use client";

import { Video, Volume2, VolumeX, ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";
import { VideoDuration, VideoResolution, VideoAspectRatio } from "@/types/video";

interface VideoSettingsProps {
  duration: VideoDuration;
  resolution: VideoResolution;
  aspectRatio: VideoAspectRatio;
  audioEnabled: boolean;
  negativePrompt: string;
  disabled?: boolean;
  onChange: (settings: {
    duration?: VideoDuration;
    resolution?: VideoResolution;
    aspectRatio?: VideoAspectRatio;
    audioEnabled?: boolean;
    negativePrompt?: string;
  }) => void;
}

export function VideoSettings({
  duration,
  resolution,
  aspectRatio,
  audioEnabled,
  negativePrompt,
  disabled = false,
  onChange,
}: VideoSettingsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const durations: { value: VideoDuration; label: string }[] = [
    { value: 4, label: "4s" },
    { value: 6, label: "6s" },
    { value: 8, label: "8s" },
  ];

  const resolutions: { value: VideoResolution; label: string; note?: string }[] = [
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p", note: "Solo 8s" },
  ];

  const aspectRatios: { value: VideoAspectRatio; label: string; icon: string }[] = [
    { value: "16:9", label: "Horizontal", icon: "landscape" },
    { value: "9:16", label: "Vertical", icon: "portrait" },
  ];

  const handleDurationChange = (newDuration: VideoDuration) => {
    // Si selecciona 1080p y la duración no es 8, ajustar
    if (resolution === "1080p" && newDuration !== 8) {
      onChange({ duration: newDuration, resolution: "720p" });
    } else {
      onChange({ duration: newDuration });
    }
  };

  const handleResolutionChange = (newResolution: VideoResolution) => {
    // 1080p solo disponible para 8 segundos
    if (newResolution === "1080p" && duration !== 8) {
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
        <Label className="text-xs text-muted-foreground">Duración</Label>
        <div className="flex gap-2">
          {durations.map((d) => (
            <button
              key={d.value}
              disabled={disabled}
              onClick={() => handleDurationChange(d.value)}
              className={`flex-1 py-2 px-3 text-sm rounded-md border transition-colors ${
                duration === d.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Resolución */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Resolución</Label>
        <div className="flex gap-2">
          {resolutions.map((r) => (
            <button
              key={r.value}
              disabled={disabled || (r.value === "1080p" && duration !== 8)}
              onClick={() => handleResolutionChange(r.value)}
              className={`flex-1 py-2 px-3 text-sm rounded-md border transition-colors ${
                resolution === r.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              } ${disabled || (r.value === "1080p" && duration !== 8) ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              title={r.note}
            >
              {r.label}
            </button>
          ))}
        </div>
        {resolution === "1080p" && duration !== 8 && (
          <p className="text-xs text-muted-foreground">
            1080p solo disponible para videos de 8 segundos
          </p>
        )}
      </div>

      {/* Aspect Ratio */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Proporción</Label>
        <div className="flex gap-2">
          {aspectRatios.map((ar) => (
            <button
              key={ar.value}
              disabled={disabled}
              onClick={() => onChange({ aspectRatio: ar.value })}
              className={`flex-1 py-2 px-3 text-sm rounded-md border transition-colors flex items-center justify-center gap-2 ${
                aspectRatio === ar.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div
                className={`border-2 ${
                  ar.value === "16:9"
                    ? "w-6 h-3.5"
                    : "w-3.5 h-6"
                } ${
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

      {/* Audio Toggle */}
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
        VEO genera audio nativo (diálogos, efectos, ambiente)
      </p>

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
    </div>
  );
}
