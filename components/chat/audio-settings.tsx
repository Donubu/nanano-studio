"use client";

import { useState } from "react";
import { Mic, ChevronDown, Plus, Trash2, Users, Volume2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { VoiceSelector } from "./voice-selector";
import {
  AudioVoiceId,
  AudioOutputFormat,
  AudioSpeaker,
  AudioSpeakerConfig,
} from "@/types/audio";

interface AudioSettingsProps {
  voiceId: AudioVoiceId;
  stylePrompt: string;
  multiSpeaker: boolean;
  speakerConfig: AudioSpeakerConfig | null;
  outputFormat: AudioOutputFormat;
  disabled?: boolean;
  onChange: (settings: {
    voiceId?: AudioVoiceId;
    stylePrompt?: string;
    multiSpeaker?: boolean;
    speakerConfig?: AudioSpeakerConfig | null;
    outputFormat?: AudioOutputFormat;
  }) => void;
}

export function AudioSettings({
  voiceId,
  stylePrompt,
  multiSpeaker,
  speakerConfig,
  outputFormat,
  disabled = false,
  onChange,
}: AudioSettingsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const handleAddSpeaker = () => {
    const newSpeaker: AudioSpeaker = {
      name: `Speaker${(speakerConfig?.speakers.length || 0) + 1}`,
      voiceId: "Kore",
    };
    const currentSpeakers = speakerConfig?.speakers || [];
    onChange({
      speakerConfig: {
        speakers: [...currentSpeakers, newSpeaker],
      },
    });
  };

  const handleRemoveSpeaker = (index: number) => {
    if (!speakerConfig) return;
    const newSpeakers = speakerConfig.speakers.filter((_, i) => i !== index);
    onChange({
      speakerConfig: newSpeakers.length > 0 ? { speakers: newSpeakers } : null,
    });
  };

  const handleSpeakerChange = (
    index: number,
    field: "name" | "voiceId",
    value: string
  ): void => {
    if (!speakerConfig) return;
    const newSpeakers = [...speakerConfig.speakers];
    newSpeakers[index] = {
      ...newSpeakers[index],
      [field]: value,
    };
    onChange({
      speakerConfig: { speakers: newSpeakers },
    });
  };

  const handleMultiSpeakerToggle = (checked: boolean) => {
    if (checked && (!speakerConfig || speakerConfig.speakers.length === 0)) {
      // Initialize with 2 default speakers
      onChange({
        multiSpeaker: true,
        speakerConfig: {
          speakers: [
            { name: "Speaker1", voiceId: "Kore" },
            { name: "Speaker2", voiceId: "Charon" },
          ],
        },
      });
    } else {
      onChange({ multiSpeaker: checked });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Mic className="w-4 h-4" />
        <span>Configuración de Audio</span>
      </div>

      {/* Voice Selector (solo visible si no es multi-speaker) */}
      {!multiSpeaker && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Voz</Label>
          <VoiceSelector
            value={voiceId}
            onValueChange={(value) => onChange({ voiceId: value })}
            disabled={disabled}
          />
        </div>
      )}

      {/* Output Format */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Formato de salida</Label>
        <div className="flex gap-2">
          <button
            disabled={disabled}
            onClick={() => onChange({ outputFormat: "mp3" })}
            className={`flex-1 py-2 px-3 text-sm rounded-md border transition-colors ${
              outputFormat === "mp3"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <div className="flex flex-col items-center">
              <span>MP3</span>
              <span className="text-xs opacity-70">Comprimido</span>
            </div>
          </button>
          <button
            disabled={disabled}
            onClick={() => onChange({ outputFormat: "wav" })}
            className={`flex-1 py-2 px-3 text-sm rounded-md border transition-colors ${
              outputFormat === "wav"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <div className="flex flex-col items-center">
              <span>WAV</span>
              <span className="text-xs opacity-70">Alta calidad</span>
            </div>
          </button>
        </div>
      </div>

      {/* Multi-speaker Toggle */}
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <Label className="text-sm">Multi-speaker (diálogo)</Label>
        </div>
        <Switch
          checked={multiSpeaker}
          onCheckedChange={handleMultiSpeakerToggle}
          disabled={disabled}
        />
      </div>

      {/* Speaker Configuration (cuando multi-speaker está activo) */}
      {multiSpeaker && (
        <div className="space-y-3 p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">
              Configuración de voces
            </Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddSpeaker}
              disabled={disabled || (speakerConfig?.speakers.length || 0) >= 10}
              className="h-7 text-xs"
            >
              <Plus className="w-3 h-3 mr-1" />
              Agregar
            </Button>
          </div>

          <div className="space-y-2">
            {speakerConfig?.speakers.map((speaker, index) => (
              <div
                key={index}
                className="flex items-center gap-2 p-2 bg-background rounded-md"
              >
                <Input
                  value={speaker.name}
                  onChange={(e) =>
                    handleSpeakerChange(index, "name", e.target.value)
                  }
                  placeholder="Nombre"
                  className="h-8 w-24 text-sm"
                  disabled={disabled}
                />
                <div className="flex-1">
                  <VoiceSelector
                    value={speaker.voiceId}
                    onValueChange={(value) =>
                      handleSpeakerChange(index, "voiceId", value)
                    }
                    disabled={disabled}
                    compact
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveSpeaker(index)}
                  disabled={disabled || (speakerConfig?.speakers.length || 0) <= 2}
                  className="h-8 w-8 text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            El texto debe incluir los nombres de los speakers seguido de dos puntos.
            Ejemplo: &quot;Speaker1: Hola, cómo estás?&quot;
          </p>
        </div>
      )}

      {/* Opciones avanzadas */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronDown
            className={`w-4 h-4 transition-transform ${
              advancedOpen ? "rotate-180" : ""
            }`}
          />
          <span>Instrucciones de estilo</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Prompt de estilo
            </Label>
            <Textarea
              value={stylePrompt}
              onChange={(e) => onChange({ stylePrompt: e.target.value })}
              placeholder="Describe el tono, emoción o estilo de voz deseado..."
              className="min-h-[80px] text-sm resize-none"
              disabled={disabled}
            />
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Ejemplos:</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                <li>&quot;Habla con un tono cálido y amigable&quot;</li>
                <li>&quot;Lee con entusiasmo y energía&quot;</li>
                <li>&quot;Narra de forma misteriosa y pausada&quot;</li>
              </ul>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Info sobre límites */}
      <div className="flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-950/30 rounded-md">
        <Volume2 className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700 dark:text-blue-300">
          Límite de texto: 4,000 bytes. Duración máxima: ~11 minutos.
        </p>
      </div>
    </div>
  );
}
