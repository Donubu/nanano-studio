"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Mic, Users, User, ChevronDown, Volume2, Loader2, Sparkles, Globe, Gauge, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { VoiceSelector } from "./voice-selector";
import { Slider } from "@/components/ui/slider";
import {
  AudioVoiceId,
  AudioVoiceConfig,
  AudioOutputFormat,
  AudioSpeakerConfig,
  AudioTTSEngine,
  CHIRP_LOCALES,
  getVoiceById,
} from "@/types/audio";
import { AudioRestoreData } from "./audio-generation-history";
import {
  DialogueEditor,
  Character,
  DialogueLine,
  createDefaultCharacters,
  createDefaultLines,
  formatDialogueForAPI,
  extractSpeakersFromDialogue,
} from "./dialogue-editor";

type QualityTier = "normal" | "hq" | "chirp";

interface TTSComposerProps {
  voiceId: AudioVoiceId;
  multiSpeaker: boolean;
  speakerConfig: AudioSpeakerConfig | null;
  stylePrompt: string;
  outputFormat: AudioOutputFormat;
  qualityTier: QualityTier;
  ttsEngine?: AudioTTSEngine;
  lockedEngine?: boolean;
  chirpAvailable?: boolean;
  normalModelName?: string | null;
  hqModelName?: string | null;
  speakingRate?: number;
  locale?: string;
  disabled: boolean;
  isGenerating: boolean;
  generationProgress?: { status: string; message: string };
  restoreData?: AudioRestoreData | null;
  onGenerate: (text: string, speakers?: AudioSpeakerConfig, qualityTier?: QualityTier) => void;
  onSettingsChange: (settings: {
    voiceId?: AudioVoiceId;
    stylePrompt?: string;
    multiSpeaker?: boolean;
    speakerConfig?: AudioSpeakerConfig | null;
    outputFormat?: AudioOutputFormat;
    qualityTier?: QualityTier;
    ttsEngine?: AudioTTSEngine;
    speakingRate?: number;
    locale?: string;
  }) => void;
  onRestoreHandled?: () => void;
}

// Helper to generate unique IDs
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

// Helper to parse dialogue content back into characters and lines
function parseDialogueContent(
  content: string,
  speakers: Array<{ name: string; voiceId: AudioVoiceId }>
): { characters: Character[]; lines: DialogueLine[] } {
  // Create characters from speakers
  const characters: Character[] = speakers.map(speaker => ({
    id: generateId(),
    name: speaker.name,
    voiceId: speaker.voiceId,
  }));

  // Create a map of speaker name to character ID
  const speakerToCharId = new Map<string, string>();
  characters.forEach(char => {
    speakerToCharId.set(char.name, char.id);
  });

  // Parse content lines
  const lines: DialogueLine[] = [];
  const contentLines = content.split("\n").filter(line => line.trim());

  for (const line of contentLines) {
    // Match "SpeakerName: text" format
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      const speakerName = match[1].trim();
      const text = match[2].trim();
      const characterId = speakerToCharId.get(speakerName);

      if (characterId && text) {
        lines.push({
          id: generateId(),
          characterId,
          text,
        });
      }
    }
  }

  return { characters, lines };
}

export function TTSComposer({
  voiceId,
  multiSpeaker,
  speakerConfig,
  stylePrompt,
  outputFormat,
  qualityTier,
  ttsEngine = "gemini",
  lockedEngine = false,
  chirpAvailable = false,
  normalModelName,
  hqModelName,
  speakingRate = 1.0,
  locale = "es-US",
  disabled,
  isGenerating,
  generationProgress,
  restoreData,
  onGenerate,
  onSettingsChange,
  onRestoreHandled,
}: TTSComposerProps) {
  const [text, setText] = useState("");

  // Initialize characters and lines with proper defaults
  const [characters, setCharacters] = useState<Character[]>(() => createDefaultCharacters());
  const [dialogueLines, setDialogueLines] = useState<DialogueLine[]>(() => {
    const defaultChars = createDefaultCharacters();
    return createDefaultLines(defaultChars);
  });

  const [styleOpen, setStyleOpen] = useState(false);
  const [chirpHelpOpen, setChirpHelpOpen] = useState(false);

  // Handle restore data when it changes
  // Using refs to avoid stale closures and dependency issues
  const onSettingsChangeRef = useRef(onSettingsChange);
  const onRestoreHandledRef = useRef(onRestoreHandled);

  // Keep refs updated
  useEffect(() => {
    onSettingsChangeRef.current = onSettingsChange;
    onRestoreHandledRef.current = onRestoreHandled;
  });

  useEffect(() => {
    if (!restoreData) return;

    const { content, voiceConfig, isMultiSpeaker } = restoreData;

    if (isMultiSpeaker && voiceConfig && "speakers" in voiceConfig) {
      // Multi-speaker mode: restore characters and dialogue lines
      const speakers = (voiceConfig as AudioSpeakerConfig).speakers;
      const { characters: restoredChars, lines: restoredLines } = parseDialogueContent(content, speakers);

      setCharacters(restoredChars);
      setDialogueLines(restoredLines);
      onSettingsChangeRef.current({ multiSpeaker: true });
    } else if (voiceConfig && "voiceId" in voiceConfig) {
      // Single speaker mode: restore voice and text
      setText(content);
      onSettingsChangeRef.current({
        multiSpeaker: false,
        voiceId: (voiceConfig as AudioVoiceConfig).voiceId
      });
    } else {
      // Fallback: just set content as text
      setText(content);
      onSettingsChangeRef.current({ multiSpeaker: false });
    }

    // Notify parent that restore was handled
    if (onRestoreHandledRef.current) {
      onRestoreHandledRef.current();
    }
  }, [restoreData]);

  const selectedVoice = getVoiceById(voiceId);

  // Calculate byte count for single speaker mode
  const byteCount = useMemo(() => {
    return new Blob([text]).size;
  }, [text]);

  // Calculate byte count for multi-speaker mode
  const dialogueByteCount = useMemo(() => {
    const formattedText = formatDialogueForAPI(characters, dialogueLines);
    return new Blob([formattedText]).size;
  }, [characters, dialogueLines]);

  const isChirp = ttsEngine === "chirp" && (chirpAvailable || lockedEngine);
  const maxBytes = isChirp ? 5000 : 4000;

  // Auto-select quality tier when current selection has no model
  useEffect(() => {
    if (isChirp) return;
    const hasNormal = !!normalModelName;
    const hasHq = !!hqModelName;
    if (qualityTier === "normal" && !hasNormal && hasHq) {
      onSettingsChange({ qualityTier: "hq" });
    } else if (qualityTier === "hq" && !hasHq && hasNormal) {
      onSettingsChange({ qualityTier: "normal" });
    }
  }, [normalModelName, hqModelName, qualityTier, isChirp, onSettingsChange]);
  const currentByteCount = multiSpeaker ? dialogueByteCount : byteCount;
  const isOverLimit = currentByteCount > maxBytes;

  const handleGenerate = () => {
    const effectiveTier = isChirp ? "chirp" : qualityTier;
    if (multiSpeaker && !isChirp) {
      const formattedText = formatDialogueForAPI(characters, dialogueLines);
      const speakers = extractSpeakersFromDialogue(characters, dialogueLines);
      if (formattedText.trim() && speakers.length >= 2) {
        onGenerate(formattedText, { speakers }, effectiveTier);
      }
    } else {
      if (text.trim()) {
        onGenerate(text, undefined, effectiveTier);
      }
    }
  };

  const handleModeChange = (isMulti: boolean) => {
    onSettingsChange({ multiSpeaker: isMulti });
  };

  // Count lines with text for validation
  const linesWithText = dialogueLines.filter(l => l.text.trim()).length;
  const uniqueSpeakersUsed = new Set(
    dialogueLines.filter(l => l.text.trim()).map(l => l.characterId)
  ).size;

  const canGenerate = multiSpeaker
    ? linesWithText >= 2 && uniqueSpeakersUsed >= 2 && !isOverLimit
    : text.trim().length > 0 && !isOverLimit;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Mic className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Generador de Audio</h2>
          <p className="text-sm text-muted-foreground">
            {isChirp ? "Chirp 3 HD — Google Cloud TTS" : "Convierte texto a voz con Gemini TTS"}
          </p>
        </div>
      </div>

      {/* Engine Toggle — hidden when engine is locked (audio_hd) or chirp not available */}
      {lockedEngine ? (
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg">
          <span className="text-sm font-medium">Chirp 3 HD</span>
          <span className="text-[10px] bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 px-1 rounded font-medium">HD</span>
        </div>
      ) : chirpAvailable ? (
        <div className="flex gap-2 p-1 bg-muted rounded-lg">
          <button
            onClick={() => onSettingsChange({ ttsEngine: "gemini", multiSpeaker: false })}
            disabled={disabled || isGenerating}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all ${
              !isChirp
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            } ${disabled || isGenerating ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            Gemini TTS
          </button>
          <button
            onClick={() => onSettingsChange({ ttsEngine: "chirp", multiSpeaker: false })}
            disabled={disabled || isGenerating}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all ${
              isChirp
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            } ${disabled || isGenerating ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            Chirp 3 HD
            <span className="text-[10px] bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 px-1 rounded font-medium">HD</span>
          </button>
        </div>
      ) : null}

      {/* Chirp-specific: Locale + Speaking Rate */}
      {isChirp && (
        <div className="space-y-4 p-4 bg-muted/30 rounded-lg border border-border/50">
          {/* Locale Selector */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" />
              Idioma
            </Label>
            <select
              value={locale}
              onChange={(e) => onSettingsChange({ locale: e.target.value })}
              disabled={disabled || isGenerating}
              className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {CHIRP_LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name} ({l.code})
                </option>
              ))}
            </select>
          </div>

          {/* Speaking Rate */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5" />
                Velocidad
              </Label>
              <span className="text-xs font-mono text-muted-foreground">{speakingRate.toFixed(2)}x</span>
            </div>
            <Slider
              value={[speakingRate]}
              min={0.25}
              max={2.0}
              step={0.05}
              onValueChange={([value]) => onSettingsChange({ speakingRate: value })}
              disabled={disabled || isGenerating}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0.25x</span>
              <span>1.0x</span>
              <span>2.0x</span>
            </div>
          </div>
        </div>
      )}

      {/* Mode Toggle (Gemini only - Chirp doesn't support multi-speaker) */}
      {!isChirp && (
        <div className="flex gap-2 p-1 bg-muted rounded-lg">
          <button
            onClick={() => handleModeChange(false)}
            disabled={disabled || isGenerating}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-medium transition-all ${
              !multiSpeaker
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            } ${disabled || isGenerating ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <User className="w-4 h-4" />
            Una voz
          </button>
          <button
            onClick={() => handleModeChange(true)}
            disabled={disabled || isGenerating}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-medium transition-all ${
              multiSpeaker
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            } ${disabled || isGenerating ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <Users className="w-4 h-4" />
            Multi-speaker
          </button>
        </div>
      )}

      {/* Single Voice Mode */}
      {!multiSpeaker && (
        <div className="space-y-4">
          {/* Voice Selector */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Voz</Label>
            <VoiceSelector
              value={voiceId}
              onValueChange={(value) => onSettingsChange({ voiceId: value })}
              disabled={disabled || isGenerating}
              ttsEngine={ttsEngine}
            />
          </div>

          {/* Text Input */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-sm font-medium">Texto</Label>
              <span className={`text-xs ${isOverLimit ? "text-destructive" : "text-muted-foreground"}`}>
                {currentByteCount.toLocaleString()} / {maxBytes.toLocaleString()} bytes
              </span>
            </div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={isChirp
                ? "Escribe el texto a convertir... Puedes usar [pause], [pause short], [pause long] o SSML con <speak>.</speak>"
                : "Escribe el texto que quieres convertir a audio..."
              }
              disabled={disabled || isGenerating}
              className="min-h-[200px] text-base resize-none"
            />
          </div>
        </div>
      )}

      {/* Multi-Speaker Mode (Gemini only) */}
      {multiSpeaker && !isChirp && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <Label className="text-sm font-medium">Configuración Multi-Speaker</Label>
            <span className={`text-xs ${isOverLimit ? "text-destructive" : "text-muted-foreground"}`}>
              {currentByteCount.toLocaleString()} / {maxBytes.toLocaleString()} bytes
            </span>
          </div>
          <DialogueEditor
            characters={characters}
            lines={dialogueLines}
            disabled={disabled || isGenerating}
            onCharactersChange={setCharacters}
            onLinesChange={setDialogueLines}
          />
          <p className="text-xs text-muted-foreground">
            Define los personajes con sus voces, luego agrega líneas de diálogo. Mínimo 2 personajes con diálogo.
          </p>
        </div>
      )}

      {/* Chirp HD Help (Collapsible, Chirp only) */}
      {isChirp && (
        <Collapsible open={chirpHelpOpen} onOpenChange={setChirpHelpOpen}>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full">
            <HelpCircle className="w-4 h-4" />
            <span>Guía de formato avanzado (SSML y pausas)</span>
            <ChevronDown
              className={`w-4 h-4 ml-auto transition-transform ${chirpHelpOpen ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="space-y-4 text-xs text-muted-foreground bg-muted/30 rounded-lg p-4 border border-border/50">
              {/* Markup shortcuts */}
              <div>
                <p className="font-medium text-foreground mb-1.5">Pausas rápidas (Markup)</p>
                <p className="mb-1">Inserta directamente en el texto sin necesidad de SSML:</p>
                <div className="space-y-1 font-mono bg-muted rounded-md p-2 text-[11px]">
                  <p><span className="text-blue-600 dark:text-blue-400">[pause short]</span> — pausa breve (~300ms)</p>
                  <p><span className="text-blue-600 dark:text-blue-400">[pause]</span> — pausa media (~750ms)</p>
                  <p><span className="text-blue-600 dark:text-blue-400">[pause long]</span> — pausa larga (~1.5s)</p>
                </div>
                <div className="mt-2 bg-muted rounded-md p-2 font-mono text-[11px] leading-relaxed">
                  <p className="text-foreground/70 mb-0.5">Ejemplo:</p>
                  <p>Bienvenidos al podcast. <span className="text-blue-600 dark:text-blue-400">[pause long]</span> Hoy hablaremos sobre inteligencia artificial. <span className="text-blue-600 dark:text-blue-400">[pause]</span> ¿Están listos? <span className="text-blue-600 dark:text-blue-400">[pause short]</span> Comencemos.</p>
                </div>
              </div>

              {/* Break */}
              <div>
                <p className="font-medium text-foreground mb-1.5">&lt;break&gt; — Pausas exactas</p>
                <p className="mb-1">Control preciso de pausas con duración específica.</p>
                <div className="bg-muted rounded-md p-2 font-mono text-[11px] leading-relaxed">
                  <p className="text-foreground/70 mb-0.5">Ejemplo:</p>
                  <p>&lt;speak&gt;Y el ganador es <span className="text-green-600 dark:text-green-400">&lt;break time=&quot;2s&quot;/&gt;</span> María López. <span className="text-green-600 dark:text-green-400">&lt;break time=&quot;500ms&quot;/&gt;</span> ¡Felicidades!&lt;/speak&gt;</p>
                </div>
              </div>

              {/* Prosody */}
              <div>
                <p className="font-medium text-foreground mb-1.5">&lt;prosody&gt; — Velocidad y tono</p>
                <p className="mb-1">Controla la velocidad (<code className="bg-muted px-1 rounded">rate</code>) y el tono (<code className="bg-muted px-1 rounded">pitch</code>) de fragmentos.</p>
                <div className="space-y-2">
                  <div className="bg-muted rounded-md p-2 font-mono text-[11px] leading-relaxed">
                    <p className="text-foreground/70 mb-0.5">Narración lenta y grave:</p>
                    <p>&lt;speak&gt;<span className="text-green-600 dark:text-green-400">&lt;prosody rate=&quot;slow&quot; pitch=&quot;-3st&quot;&gt;</span>En un lugar de la Mancha, de cuyo nombre no quiero acordarme<span className="text-green-600 dark:text-green-400">&lt;/prosody&gt;</span>&lt;/speak&gt;</p>
                  </div>
                  <div className="bg-muted rounded-md p-2 font-mono text-[11px] leading-relaxed">
                    <p className="text-foreground/70 mb-0.5">Mezcla de ritmos:</p>
                    <p>&lt;speak&gt;Atención: <span className="text-green-600 dark:text-green-400">&lt;prosody rate=&quot;fast&quot;&gt;</span>oferta por tiempo limitado<span className="text-green-600 dark:text-green-400">&lt;/prosody&gt;</span>. <span className="text-green-600 dark:text-green-400">&lt;prosody rate=&quot;x-slow&quot; pitch=&quot;+2st&quot;&gt;</span>No te lo pierdas.<span className="text-green-600 dark:text-green-400">&lt;/prosody&gt;</span>&lt;/speak&gt;</p>
                  </div>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                  <p><span className="text-foreground">rate:</span> x-slow, slow, medium, fast, x-fast, 50%-200%</p>
                  <p><span className="text-foreground">pitch:</span> x-low, low, medium, high, x-high, -10st a +10st</p>
                </div>
              </div>

              {/* Say-as */}
              <div>
                <p className="font-medium text-foreground mb-1.5">&lt;say-as&gt; — Interpretación especial</p>
                <p className="mb-1">Indica cómo pronunciar números, fechas, horas, etc.</p>
                <div className="space-y-2">
                  <div className="bg-muted rounded-md p-2 font-mono text-[11px] leading-relaxed space-y-1">
                    <p><span className="text-foreground/70">Cardinal:</span> &lt;say-as interpret-as=&quot;<span className="text-green-600 dark:text-green-400">cardinal</span>&quot;&gt;1250&lt;/say-as&gt; → <span className="italic">&quot;mil doscientos cincuenta&quot;</span></p>
                    <p><span className="text-foreground/70">Ordinal:</span> &lt;say-as interpret-as=&quot;<span className="text-green-600 dark:text-green-400">ordinal</span>&quot;&gt;3&lt;/say-as&gt; → <span className="italic">&quot;tercero&quot;</span></p>
                    <p><span className="text-foreground/70">Caracteres:</span> &lt;say-as interpret-as=&quot;<span className="text-green-600 dark:text-green-400">characters</span>&quot;&gt;ABC&lt;/say-as&gt; → <span className="italic">&quot;a, be, ce&quot;</span></p>
                    <p><span className="text-foreground/70">Fecha:</span> &lt;say-as interpret-as=&quot;<span className="text-green-600 dark:text-green-400">date</span>&quot; format=&quot;dmy&quot;&gt;18-02-2026&lt;/say-as&gt;</p>
                    <p><span className="text-foreground/70">Hora:</span> &lt;say-as interpret-as=&quot;<span className="text-green-600 dark:text-green-400">time</span>&quot; format=&quot;hms24&quot;&gt;14:30:00&lt;/say-as&gt;</p>
                    <p><span className="text-foreground/70">Teléfono:</span> &lt;say-as interpret-as=&quot;<span className="text-green-600 dark:text-green-400">telephone</span>&quot;&gt;+56912345678&lt;/say-as&gt;</p>
                    <p><span className="text-foreground/70">Unidad:</span> &lt;say-as interpret-as=&quot;<span className="text-green-600 dark:text-green-400">unit</span>&quot;&gt;5km&lt;/say-as&gt; → <span className="italic">&quot;cinco kilómetros&quot;</span></p>
                    <p><span className="text-foreground/70">Fracción:</span> &lt;say-as interpret-as=&quot;<span className="text-green-600 dark:text-green-400">fraction</span>&quot;&gt;3/4&lt;/say-as&gt; → <span className="italic">&quot;tres cuartos&quot;</span></p>
                  </div>
                </div>
              </div>

              {/* Phoneme */}
              <div>
                <p className="font-medium text-foreground mb-1.5">&lt;phoneme&gt; — Pronunciación exacta</p>
                <p className="mb-1">Fuerza una pronunciación específica usando el alfabeto fonético IPA.</p>
                <div className="bg-muted rounded-md p-2 font-mono text-[11px] leading-relaxed">
                  <p className="text-foreground/70 mb-0.5">Ejemplo:</p>
                  <p>&lt;speak&gt;La marca <span className="text-green-600 dark:text-green-400">&lt;phoneme alphabet=&quot;ipa&quot; ph=&quot;ˈnaɪki&quot;&gt;</span>Nike<span className="text-green-600 dark:text-green-400">&lt;/phoneme&gt;</span> es muy popular.&lt;/speak&gt;</p>
                </div>
              </div>

              {/* Sub */}
              <div>
                <p className="font-medium text-foreground mb-1.5">&lt;sub&gt; — Sustitución de texto</p>
                <p className="mb-1">Reemplaza siglas o abreviaturas por su forma hablada.</p>
                <div className="bg-muted rounded-md p-2 font-mono text-[11px] leading-relaxed">
                  <p className="text-foreground/70 mb-0.5">Ejemplo:</p>
                  <p>&lt;speak&gt;La <span className="text-green-600 dark:text-green-400">&lt;sub alias=&quot;Organización Mundial de la Salud&quot;&gt;</span>OMS<span className="text-green-600 dark:text-green-400">&lt;/sub&gt;</span> publicó un informe sobre el <span className="text-green-600 dark:text-green-400">&lt;sub alias=&quot;ácido desoxirribonucleico&quot;&gt;</span>ADN<span className="text-green-600 dark:text-green-400">&lt;/sub&gt;</span>.&lt;/speak&gt;</p>
                </div>
              </div>

              {/* Párrafos y oraciones */}
              <div>
                <p className="font-medium text-foreground mb-1.5">&lt;p&gt; y &lt;s&gt; — Párrafos y oraciones</p>
                <p className="mb-1">Estructura el texto para pausas naturales entre párrafos y oraciones.</p>
                <div className="bg-muted rounded-md p-2 font-mono text-[11px] leading-relaxed">
                  <p className="text-foreground/70 mb-0.5">Ejemplo:</p>
                  <p>&lt;speak&gt;<br/>
                    &nbsp;&nbsp;<span className="text-green-600 dark:text-green-400">&lt;p&gt;</span><br/>
                    &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-green-600 dark:text-green-400">&lt;s&gt;</span>Este es el primer punto.<span className="text-green-600 dark:text-green-400">&lt;/s&gt;</span><br/>
                    &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-green-600 dark:text-green-400">&lt;s&gt;</span>Y este es el segundo.<span className="text-green-600 dark:text-green-400">&lt;/s&gt;</span><br/>
                    &nbsp;&nbsp;<span className="text-green-600 dark:text-green-400">&lt;/p&gt;</span><br/>
                    &nbsp;&nbsp;<span className="text-green-600 dark:text-green-400">&lt;p&gt;</span>Ahora pasamos al siguiente tema.<span className="text-green-600 dark:text-green-400">&lt;/p&gt;</span><br/>
                  &lt;/speak&gt;</p>
                </div>
              </div>

              {/* Ejemplo completo */}
              <div>
                <p className="font-medium text-foreground mb-1.5">Ejemplo completo combinado</p>
                <div className="bg-muted rounded-md p-2 font-mono text-[11px] leading-relaxed">
                  <p>&lt;speak&gt;<br/>
                    &nbsp;&nbsp;<span className="text-green-600 dark:text-green-400">&lt;p&gt;</span><br/>
                    &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-green-600 dark:text-green-400">&lt;prosody rate=&quot;slow&quot;&gt;</span>Bienvenidos al noticiero del día <span className="text-green-600 dark:text-green-400">&lt;say-as interpret-as=&quot;date&quot; format=&quot;dmy&quot;&gt;</span>18-02-2026<span className="text-green-600 dark:text-green-400">&lt;/say-as&gt;</span>.<span className="text-green-600 dark:text-green-400">&lt;/prosody&gt;</span><br/>
                    &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-green-600 dark:text-green-400">&lt;break time=&quot;1s&quot;/&gt;</span><br/>
                    &nbsp;&nbsp;&nbsp;&nbsp;Hoy la <span className="text-green-600 dark:text-green-400">&lt;sub alias=&quot;Organización de las Naciones Unidas&quot;&gt;</span>ONU<span className="text-green-600 dark:text-green-400">&lt;/sub&gt;</span> anunció que <span className="text-green-600 dark:text-green-400">&lt;say-as interpret-as=&quot;cardinal&quot;&gt;</span>195<span className="text-green-600 dark:text-green-400">&lt;/say-as&gt;</span> países firmaron el acuerdo.<br/>
                    &nbsp;&nbsp;<span className="text-green-600 dark:text-green-400">&lt;/p&gt;</span><br/>
                    &nbsp;&nbsp;<span className="text-green-600 dark:text-green-400">&lt;p&gt;</span><br/>
                    &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-green-600 dark:text-green-400">&lt;prosody rate=&quot;fast&quot; pitch=&quot;+2st&quot;&gt;</span>¡Esto es histórico!<span className="text-green-600 dark:text-green-400">&lt;/prosody&gt;</span><br/>
                    &nbsp;&nbsp;<span className="text-green-600 dark:text-green-400">&lt;/p&gt;</span><br/>
                  &lt;/speak&gt;</p>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Style Instructions (Collapsible, Gemini only) */}
      {!isChirp && <Collapsible open={styleOpen} onOpenChange={setStyleOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronDown
            className={`w-4 h-4 transition-transform ${styleOpen ? "rotate-180" : ""}`}
          />
          <span>Instrucciones de estilo (opcional)</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <Textarea
            value={stylePrompt}
            onChange={(e) => onSettingsChange({ stylePrompt: e.target.value })}
            placeholder="Ej: Habla con un tono cálido y amigable, como si estuvieras contando una historia a un niño..."
            disabled={disabled || isGenerating}
            className="min-h-[80px] text-sm resize-none"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Describe el tono, emoción o estilo de voz deseado.
          </p>
        </CollapsibleContent>
      </Collapsible>}

      {/* Footer: Format + Quality + Generate */}
      <div className="flex flex-col gap-4 pt-4 border-t border-border/50">
        {/* Settings Row */}
        <div className="flex items-center justify-between">
          {/* Output Format */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Formato:</Label>
            <div className="flex gap-1">
              <button
                onClick={() => onSettingsChange({ outputFormat: "mp3" })}
                disabled={disabled || isGenerating}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  outputFormat === "mp3"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                } ${disabled || isGenerating ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                MP3
              </button>
              <button
                onClick={() => onSettingsChange({ outputFormat: "wav" })}
                disabled={disabled || isGenerating}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  outputFormat === "wav"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                } ${disabled || isGenerating ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                WAV
              </button>
            </div>
          </div>

          {/* Quality Tier (hidden when Chirp since it's always "chirp" tier) */}
          {!isChirp && (normalModelName || hqModelName) && (
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Calidad:</Label>
              <div className="flex gap-1">
                {normalModelName && (
                  <button
                    onClick={() => onSettingsChange({ qualityTier: "normal" })}
                    disabled={disabled || isGenerating}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors truncate max-w-[140px] ${
                      qualityTier === "normal"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    } ${disabled || isGenerating ? "opacity-50 cursor-not-allowed" : ""}`}
                    title={normalModelName}
                  >
                    {normalModelName}
                  </button>
                )}
                {hqModelName && (
                  <button
                    onClick={() => onSettingsChange({ qualityTier: "hq" })}
                    disabled={disabled || isGenerating}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1 truncate max-w-[140px] ${
                      qualityTier === "hq"
                        ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    } ${disabled || isGenerating ? "opacity-50 cursor-not-allowed" : ""}`}
                    title={hqModelName}
                  >
                    <Sparkles className="w-3 h-3 shrink-0" />
                    {hqModelName}
                  </button>
                )}
              </div>
            </div>
          )}
          {isChirp && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 px-1.5 py-0.5 rounded font-medium">Chirp HD</span>
            </div>
          )}
        </div>

        {/* Generate Button */}
        <Button
          onClick={handleGenerate}
          disabled={disabled || isGenerating || !canGenerate}
          className="w-full"
          size="lg"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generando...
            </>
          ) : (
            <>
              <Volume2 className="w-4 h-4 mr-2" />
              Generar Audio
            </>
          )}
        </Button>
      </div>

      {/* Progress indicator */}
      {isGenerating && generationProgress && (
        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span>{generationProgress.message}</span>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
        <Volume2 className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700 dark:text-blue-300">
          {isChirp
            ? "Chirp 3 HD: 5,000 bytes máx. 51 idiomas, SSML, control de velocidad."
            : "Límite de texto: 4,000 bytes. Duración máxima del audio: ~11 minutos."
          }
        </p>
      </div>
    </div>
  );
}
