"use client";

import { useState } from "react";
import { Mic, ChevronDown, Plus, Trash2, Users, Volume2, Globe, Gauge } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
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
  AudioTTSEngine,
  CHIRP_LOCALES,
} from "@/types/audio";

interface AudioSettingsProps {
  voiceId: AudioVoiceId;
  stylePrompt: string;
  multiSpeaker: boolean;
  speakerConfig: AudioSpeakerConfig | null;
  outputFormat: AudioOutputFormat;
  ttsEngine: AudioTTSEngine;
  speakingRate: number;
  locale: string;
  disabled?: boolean;
  onChange: (settings: {
    voiceId?: AudioVoiceId;
    stylePrompt?: string;
    multiSpeaker?: boolean;
    speakerConfig?: AudioSpeakerConfig | null;
    outputFormat?: AudioOutputFormat;
    ttsEngine?: AudioTTSEngine;
    speakingRate?: number;
    locale?: string;
  }) => void;
}

export function AudioSettings({
  voiceId,
  stylePrompt,
  multiSpeaker,
  speakerConfig,
  outputFormat,
  ttsEngine,
  speakingRate,
  locale,
  disabled = false,
  onChange,
}: AudioSettingsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const isChirp = ttsEngine === "chirp";

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

  const handleEngineToggle = (engine: AudioTTSEngine) => {
    onChange({
      ttsEngine: engine,
      // When switching to chirp, disable multi-speaker
      ...(engine === "chirp" ? { multiSpeaker: false } : {}),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Mic className="w-4 h-4" />
        <span>Configuración de Audio</span>
      </div>

      {/* TTS Engine Selector */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Motor TTS</Label>
        <div className="flex gap-2">
          <button
            disabled={disabled}
            onClick={() => handleEngineToggle("gemini")}
            className={`flex-1 py-2 px-3 text-sm rounded-md border transition-colors ${
              !isChirp
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <div className="flex flex-col items-center">
              <span>Gemini TTS</span>
              <span className="text-xs opacity-70">Estándar</span>
            </div>
          </button>
          <button
            disabled={disabled}
            onClick={() => handleEngineToggle("chirp")}
            className={`flex-1 py-2 px-3 text-sm rounded-md border transition-colors ${
              isChirp
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <div className="flex flex-col items-center">
              <span className="flex items-center gap-1">
                Chirp 3 HD
                <span className="text-[10px] bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 px-1 rounded font-medium">HD</span>
              </span>
              <span className="text-xs opacity-70">Alta calidad</span>
            </div>
          </button>
        </div>
      </div>

      {/* Voice Selector (solo visible si no es multi-speaker) */}
      {!multiSpeaker && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Voz</Label>
          <VoiceSelector
            value={voiceId}
            onValueChange={(value) => onChange({ voiceId: value })}
            disabled={disabled}
            ttsEngine={ttsEngine}
          />
        </div>
      )}

      {/* Chirp-specific controls */}
      {isChirp && (
        <>
          {/* Locale Selector */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Globe className="w-3 h-3" />
              Idioma / Locale
            </Label>
            <select
              value={locale}
              onChange={(e) => onChange({ locale: e.target.value })}
              disabled={disabled}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {CHIRP_LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name} ({l.code})
                </option>
              ))}
            </select>
          </div>

          {/* Speaking Rate Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Gauge className="w-3 h-3" />
                Velocidad de habla
              </Label>
              <span className="text-xs font-mono text-muted-foreground">{speakingRate.toFixed(2)}x</span>
            </div>
            <Slider
              value={[speakingRate]}
              min={0.25}
              max={2.0}
              step={0.05}
              onValueChange={([value]) => onChange({ speakingRate: value })}
              disabled={disabled}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0.25x</span>
              <span>1.0x</span>
              <span>2.0x</span>
            </div>
          </div>
        </>
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

      {/* Multi-speaker Toggle (hidden for Chirp) */}
      {!isChirp && (
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
      )}

      {/* Speaker Configuration (cuando multi-speaker está activo, solo Gemini) */}
      {!isChirp && multiSpeaker && (
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
                    ttsEngine="gemini"
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

      {/* Opciones avanzadas (solo Gemini - Chirp usa SSML en vez de prompts) */}
      {!isChirp && (
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
      )}

      {/* Info sobre límites */}
      <div className="flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-950/30 rounded-md">
        <Volume2 className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700 dark:text-blue-300">
          {isChirp
            ? "Chirp 3 HD: 5,000 bytes máx. 51 idiomas, SSML, control de velocidad."
            : "Límite de texto: 4,000 bytes. Duración máxima: ~11 minutos."
          }
        </p>
      </div>
    </div>
  );
}
