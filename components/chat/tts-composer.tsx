"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Mic, Users, User, ChevronDown, Volume2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AudioVoiceId,
  AudioVoiceConfig,
  AudioOutputFormat,
  AudioSpeakerConfig,
  AUDIO_VOICES,
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

interface TTSComposerProps {
  voiceId: AudioVoiceId;
  multiSpeaker: boolean;
  speakerConfig: AudioSpeakerConfig | null;
  stylePrompt: string;
  outputFormat: AudioOutputFormat;
  disabled: boolean;
  isGenerating: boolean;
  generationProgress?: { status: string; message: string };
  restoreData?: AudioRestoreData | null;
  onGenerate: (text: string, speakers?: AudioSpeakerConfig) => void;
  onSettingsChange: (settings: {
    voiceId?: AudioVoiceId;
    stylePrompt?: string;
    multiSpeaker?: boolean;
    speakerConfig?: AudioSpeakerConfig | null;
    outputFormat?: AudioOutputFormat;
  }) => void;
  onRestoreHandled?: () => void;
}

// Group voices by style
const voiceGroups = {
  "Brillantes / Animadas": AUDIO_VOICES.filter(v => ["bright", "upbeat", "lively"].includes(v.style)),
  "Informativas / Claras": AUDIO_VOICES.filter(v => ["informative", "clear"].includes(v.style)),
  "Firmes / Suaves": AUDIO_VOICES.filter(v => ["firm", "smooth", "even"].includes(v.style)),
  "Expresivas / Casuales": AUDIO_VOICES.filter(v => ["excitable", "breezy", "easygoing", "casual", "friendly"].includes(v.style)),
  "Distintivas": AUDIO_VOICES.filter(v => ["breathy", "gravelly", "soft", "mature", "forward", "gentle", "warm"].includes(v.style)),
};

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

  const currentByteCount = multiSpeaker ? dialogueByteCount : byteCount;
  const isOverLimit = currentByteCount > 4000;

  const handleGenerate = () => {
    if (multiSpeaker) {
      const formattedText = formatDialogueForAPI(characters, dialogueLines);
      const speakers = extractSpeakersFromDialogue(characters, dialogueLines);
      if (formattedText.trim() && speakers.length >= 2) {
        onGenerate(formattedText, { speakers });
      }
    } else {
      if (text.trim()) {
        onGenerate(text);
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
            Convierte texto a voz con Gemini TTS
          </p>
        </div>
      </div>

      {/* Mode Toggle */}
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

      {/* Single Voice Mode */}
      {!multiSpeaker && (
        <div className="space-y-4">
          {/* Voice Selector */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Voz</Label>
            <Select
              value={voiceId}
              onValueChange={(value: string) => onSettingsChange({ voiceId: value as AudioVoiceId })}
              disabled={disabled || isGenerating}
            >
              <SelectTrigger className="w-full h-11">
                <SelectValue>
                  {selectedVoice ? (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{selectedVoice.name}</span>
                      <span className="text-muted-foreground">
                        - {selectedVoice.description}
                      </span>
                    </div>
                  ) : (
                    "Seleccionar voz..."
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {Object.entries(voiceGroups).map(([groupName, voices]) => (
                  <SelectGroup key={groupName}>
                    <SelectLabel className="text-xs text-muted-foreground">
                      {groupName}
                    </SelectLabel>
                    {voices.map((voice) => (
                      <SelectItem key={voice.id} value={voice.id}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{voice.name}</span>
                          <span className="text-xs text-muted-foreground">
                            ({voice.description})
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Text Input */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-sm font-medium">Texto</Label>
              <span className={`text-xs ${isOverLimit ? "text-destructive" : "text-muted-foreground"}`}>
                {currentByteCount.toLocaleString()} / 4,000 bytes
              </span>
            </div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Escribe el texto que quieres convertir a audio..."
              disabled={disabled || isGenerating}
              className="min-h-[200px] text-base resize-none"
            />
          </div>
        </div>
      )}

      {/* Multi-Speaker Mode */}
      {multiSpeaker && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <Label className="text-sm font-medium">Configuración Multi-Speaker</Label>
            <span className={`text-xs ${isOverLimit ? "text-destructive" : "text-muted-foreground"}`}>
              {currentByteCount.toLocaleString()} / 4,000 bytes
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

      {/* Style Instructions (Collapsible) */}
      <Collapsible open={styleOpen} onOpenChange={setStyleOpen}>
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
      </Collapsible>

      {/* Footer: Format + Generate */}
      <div className="flex items-center justify-between pt-4 border-t border-border/50">
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

        {/* Generate Button */}
        <Button
          onClick={handleGenerate}
          disabled={disabled || isGenerating || !canGenerate}
          className="min-w-[160px]"
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
          Límite de texto: 4,000 bytes. Duración máxima del audio: ~11 minutos.
        </p>
      </div>
    </div>
  );
}
