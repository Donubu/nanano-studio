"use client";

import { useState } from "react";
import { Music, Plus, Trash2, ChevronDown, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  MUSIC_SCALES,
  MUSIC_GENERATION_MODES,
  type MusicGenerationSettings,
  type WeightedPrompt,
  type MusicScale,
  type MusicGenerationMode,
} from "@/types/music";

interface MusicSettingsProps {
  settings: MusicGenerationSettings;
  disabled?: boolean;
  isGenerating?: boolean;
  generationProgress?: {
    status: string;
    message: string;
    percent?: number;
  };
  onChange: (settings: Partial<MusicGenerationSettings>) => void;
  onGenerate: () => void;
}

export function MusicSettings({
  settings,
  disabled = false,
  isGenerating = false,
  generationProgress,
  onChange,
  onGenerate,
}: MusicSettingsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const updatePrompt = (index: number, field: "text" | "weight", value: string | number) => {
    const newPrompts = [...settings.prompts];
    newPrompts[index] = { ...newPrompts[index], [field]: value };
    onChange({ prompts: newPrompts });
  };

  const addPrompt = () => {
    onChange({ prompts: [...settings.prompts, { text: "", weight: 0.5 }] });
  };

  const removePrompt = (index: number) => {
    if (settings.prompts.length <= 1) return;
    const newPrompts = settings.prompts.filter((_, i) => i !== index);
    onChange({ prompts: newPrompts });
  };

  const hasValidPrompt = settings.prompts.some(p => p.text.trim().length > 0);

  return (
    <div className="p-4 flex flex-col h-full">
      <div className="max-w-lg mx-auto w-full space-y-5 flex-1">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Music className="h-5 w-5 text-teal-500" />
          <h3 className="text-sm font-semibold">Generador de Musica</h3>
        </div>

        {/* Prompts */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">Prompts</Label>
          {settings.prompts.map((prompt, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={prompt.text}
                onChange={(e) => updatePrompt(index, "text", e.target.value)}
                placeholder="Describe el estilo de musica..."
                disabled={disabled || isGenerating}
                className="text-sm flex-1"
              />
              <div className="flex items-center gap-1 shrink-0 w-24">
                <Slider
                  value={[prompt.weight]}
                  min={0}
                  max={1}
                  step={0.1}
                  onValueChange={(v) => updatePrompt(index, "weight", v[0])}
                  disabled={disabled || isGenerating}
                  className="flex-1"
                />
                <span className="text-[10px] text-muted-foreground w-5 text-right">
                  {prompt.weight.toFixed(1)}
                </span>
              </div>
              {settings.prompts.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-red-500 shrink-0"
                  onClick={() => removePrompt(index)}
                  disabled={disabled || isGenerating}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
          {settings.prompts.length < 4 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground h-7"
              onClick={addPrompt}
              disabled={disabled || isGenerating}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Agregar prompt
            </Button>
          )}
        </div>

        {/* BPM + Duration side by side */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">BPM</Label>
              <span className="text-xs font-mono text-muted-foreground">{settings.bpm}</span>
            </div>
            <Slider
              value={[settings.bpm]}
              min={60}
              max={200}
              step={1}
              onValueChange={(v) => onChange({ bpm: v[0] })}
              disabled={disabled || isGenerating}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>60</span>
              <span>200</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">Duracion</Label>
              <span className="text-xs font-mono text-muted-foreground">{settings.duration}s</span>
            </div>
            <Slider
              value={[settings.duration]}
              min={10}
              max={120}
              step={5}
              onValueChange={(v) => onChange({ duration: v[0] })}
              disabled={disabled || isGenerating}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>10s</span>
              <span>120s</span>
            </div>
          </div>
        </div>

        {/* Scale + Mode side by side */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Escala</Label>
            <select
              value={settings.scale}
              onChange={(e) => onChange({ scale: e.target.value as MusicScale })}
              disabled={disabled || isGenerating}
              className="w-full text-sm bg-background border border-input rounded-md px-2.5 py-1.5"
            >
              {MUSIC_SCALES.map((scale) => (
                <option key={scale.id} value={scale.id}>
                  {scale.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Modo</Label>
            <div className="flex gap-1.5">
              {MUSIC_GENERATION_MODES.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => onChange({ generationMode: mode.id as MusicGenerationMode })}
                  disabled={disabled || isGenerating}
                  className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    settings.generationMode === mode.id
                      ? "bg-teal-500/20 text-teal-700 dark:text-teal-300 border border-teal-500/40"
                      : "bg-muted text-muted-foreground border border-transparent hover:border-border"
                  }`}
                >
                  {mode.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Advanced Settings */}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            Configuracion avanzada
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-4">
            {/* Density + Brightness side by side */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">Densidad</Label>
                  <span className="text-xs font-mono text-muted-foreground">{settings.density.toFixed(2)}</span>
                </div>
                <Slider
                  value={[settings.density]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={(v) => onChange({ density: v[0] })}
                  disabled={disabled || isGenerating}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Disperso</span>
                  <span>Denso</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-muted-foreground">Brillo</Label>
                  <span className="text-xs font-mono text-muted-foreground">{settings.brightness.toFixed(2)}</span>
                </div>
                <Slider
                  value={[settings.brightness]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={(v) => onChange({ brightness: v[0] })}
                  disabled={disabled || isGenerating}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Oscuro</span>
                  <span>Brillante</span>
                </div>
              </div>
            </div>

            {/* Guidance */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground">Guia</Label>
                <span className="text-xs font-mono text-muted-foreground">{settings.guidance.toFixed(1)}</span>
              </div>
              <Slider
                value={[settings.guidance]}
                min={1}
                max={6}
                step={0.5}
                onValueChange={(v) => onChange({ guidance: v[0] })}
                disabled={disabled || isGenerating}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Libre (1)</span>
                <span>Estricto (6)</span>
              </div>
            </div>

            {/* Instrument Mutes - inline */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Instrumentos</Label>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={settings.muteBass}
                    onCheckedChange={(v) => onChange({ muteBass: v })}
                    disabled={disabled || isGenerating || settings.onlyBassAndDrums}
                    className="scale-90"
                  />
                  <span className="text-xs">Silenciar bajo</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={settings.muteDrums}
                    onCheckedChange={(v) => onChange({ muteDrums: v })}
                    disabled={disabled || isGenerating || settings.onlyBassAndDrums}
                    className="scale-90"
                  />
                  <span className="text-xs">Silenciar bateria</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={settings.onlyBassAndDrums}
                    onCheckedChange={(v) => onChange({
                      onlyBassAndDrums: v,
                      ...(v ? { muteBass: false, muteDrums: false } : {}),
                    })}
                    disabled={disabled || isGenerating}
                    className="scale-90"
                  />
                  <span className="text-xs">Solo bajo y bateria</span>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Bottom: Progress + Generate Button (sticky at bottom) */}
      <div className="max-w-lg mx-auto w-full pt-4 space-y-3">
        {/* Generation Progress */}
        {isGenerating && generationProgress && (
          <div className="flex items-center gap-3 p-3 bg-teal-500/10 border border-teal-200/50 dark:border-teal-800/50 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center shrink-0">
              <Music className="w-4 h-4 text-teal-600 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-teal-600/70 dark:text-teal-400/70 truncate">
                {generationProgress.message}
              </p>
              {generationProgress.percent !== undefined && (
                <div className="w-full h-1.5 bg-teal-200/30 dark:bg-teal-800/30 rounded-full mt-1.5">
                  <div
                    className="h-full bg-teal-500 rounded-full transition-all"
                    style={{ width: `${generationProgress.percent}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Generate Button */}
        <Button
          className="w-full bg-teal-600 hover:bg-teal-700 text-white"
          onClick={onGenerate}
          disabled={disabled || isGenerating || !hasValidPrompt}
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generando...
            </>
          ) : (
            <>
              <Music className="h-4 w-4 mr-2" />
              Generar Musica
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
