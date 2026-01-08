"use client";

import { Plus, Trash2, Users, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AudioVoiceId, AUDIO_VOICES, getVoiceById } from "@/types/audio";

// Character definition
export interface Character {
  id: string;
  name: string;
  voiceId: AudioVoiceId;
}

// Dialogue line references a character by ID
export interface DialogueLine {
  id: string;
  characterId: string;
  text: string;
}

// For backwards compatibility - exported for API formatting
export interface LegacyDialogueLine {
  id: string;
  speakerName: string;
  voiceId: AudioVoiceId;
  text: string;
}

interface DialogueEditorProps {
  characters: Character[];
  lines: DialogueLine[];
  disabled: boolean;
  onCharactersChange: (characters: Character[]) => void;
  onLinesChange: (lines: DialogueLine[]) => void;
}

// Group voices by style for better organization
const voiceGroups = {
  "Brillantes / Animadas": AUDIO_VOICES.filter(v => ["bright", "upbeat", "lively"].includes(v.style)),
  "Informativas / Claras": AUDIO_VOICES.filter(v => ["informative", "clear"].includes(v.style)),
  "Firmes / Suaves": AUDIO_VOICES.filter(v => ["firm", "smooth", "even"].includes(v.style)),
  "Expresivas / Casuales": AUDIO_VOICES.filter(v => ["excitable", "breezy", "easygoing", "casual", "friendly"].includes(v.style)),
  "Distintivas": AUDIO_VOICES.filter(v => ["breathy", "gravelly", "soft", "mature", "forward", "gentle", "warm"].includes(v.style)),
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

export function createDefaultCharacters(): Character[] {
  return [
    { id: generateId(), name: "Narrador", voiceId: "Kore" },
    { id: generateId(), name: "Personaje 1", voiceId: "Puck" },
  ];
}

export function createDefaultLines(characters: Character[]): DialogueLine[] {
  if (characters.length < 2) return [];
  return [
    { id: generateId(), characterId: characters[0].id, text: "" },
    { id: generateId(), characterId: characters[1].id, text: "" },
  ];
}

export function DialogueEditor({
  characters,
  lines,
  disabled,
  onCharactersChange,
  onLinesChange,
}: DialogueEditorProps) {
  // Character management
  const handleAddCharacter = () => {
    const newCharacter: Character = {
      id: generateId(),
      name: `Personaje ${characters.length + 1}`,
      voiceId: "Charon",
    };
    onCharactersChange([...characters, newCharacter]);
  };

  const handleRemoveCharacter = (characterId: string) => {
    if (characters.length <= 2) return; // Minimum 2 characters
    // Remove character and all their dialogue lines
    onCharactersChange(characters.filter(c => c.id !== characterId));
    onLinesChange(lines.filter(l => l.characterId !== characterId));
  };

  const handleCharacterChange = (characterId: string, field: keyof Character, value: string) => {
    onCharactersChange(
      characters.map(char =>
        char.id === characterId ? { ...char, [field]: value } : char
      )
    );
  };

  // Dialogue line management
  const handleAddLine = () => {
    // Alternate between characters based on last line
    const lastLine = lines[lines.length - 1];
    let nextCharacterId = characters[0]?.id || "";

    if (lastLine && characters.length >= 2) {
      const lastCharIndex = characters.findIndex(c => c.id === lastLine.characterId);
      const nextIndex = (lastCharIndex + 1) % characters.length;
      nextCharacterId = characters[nextIndex].id;
    }

    const newLine: DialogueLine = {
      id: generateId(),
      characterId: nextCharacterId,
      text: "",
    };
    onLinesChange([...lines, newLine]);
  };

  const handleRemoveLine = (lineId: string) => {
    onLinesChange(lines.filter(l => l.id !== lineId));
  };

  const handleLineChange = (lineId: string, field: keyof DialogueLine, value: string) => {
    onLinesChange(
      lines.map(line =>
        line.id === lineId ? { ...line, [field]: value } : line
      )
    );
  };

  // Get character by ID
  const getCharacter = (characterId: string): Character | undefined => {
    return characters.find(c => c.id === characterId);
  };

  return (
    <div className="space-y-6">
      {/* Characters Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Users className="w-4 h-4" />
          <span>Personajes</span>
          <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
            {characters.length}
          </span>
        </div>

        <div className="space-y-2">
          {characters.map((character) => {
            const voice = getVoiceById(character.voiceId);
            return (
              <div
                key={character.id}
                className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg border border-border/50"
              >
                {/* Character Name */}
                <Input
                  value={character.name}
                  onChange={(e) => handleCharacterChange(character.id, "name", e.target.value)}
                  placeholder="Nombre del personaje"
                  disabled={disabled}
                  className="h-8 text-sm font-medium flex-1 max-w-[180px]"
                />

                {/* Voice Selector */}
                <Select
                  value={character.voiceId}
                  onValueChange={(value: string) => handleCharacterChange(character.id, "voiceId", value as AudioVoiceId)}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-8 flex-1">
                    <SelectValue>
                      {voice ? (
                        <span className="text-sm">{voice.name} - {voice.description}</span>
                      ) : (
                        "Seleccionar voz"
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-[250px]">
                    {Object.entries(voiceGroups).map(([groupName, voices]) => (
                      <SelectGroup key={groupName}>
                        <SelectLabel className="text-xs text-muted-foreground">
                          {groupName}
                        </SelectLabel>
                        {voices.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            <span className="text-sm">{v.name} - {v.description}</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>

                {/* Delete Button */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveCharacter(character.id)}
                  disabled={disabled || characters.length <= 2}
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          })}
        </div>

        {/* Add Character Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddCharacter}
          disabled={disabled || characters.length >= 6}
          className="w-full h-8 border-dashed text-xs"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Agregar personaje
        </Button>

        {characters.length >= 6 && (
          <p className="text-xs text-muted-foreground text-center">
            Máximo 6 personajes
          </p>
        )}
      </div>

      {/* Dialogue Lines Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <User className="w-4 h-4" />
          <span>Diálogo</span>
          <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
            {lines.filter(l => l.text.trim()).length} líneas
          </span>
        </div>

        <div className="space-y-2">
          {lines.map((line) => {
            const character = getCharacter(line.characterId);
            return (
              <div
                key={line.id}
                className="flex items-start gap-2 p-2 bg-card rounded-lg border border-border/50"
              >
                {/* Character Selector */}
                <Select
                  value={line.characterId}
                  onValueChange={(value: string) => handleLineChange(line.id, "characterId", value)}
                  disabled={disabled}
                >
                  <SelectTrigger className="h-8 w-[140px] shrink-0">
                    <SelectValue>
                      {character?.name || "Seleccionar"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {characters.map((char) => (
                      <SelectItem key={char.id} value={char.id}>
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor: `hsl(${characters.indexOf(char) * 60}, 70%, 50%)`,
                            }}
                          />
                          {char.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Text Input */}
                <Textarea
                  value={line.text}
                  onChange={(e) => handleLineChange(line.id, "text", e.target.value)}
                  placeholder={character ? `${character.name} dice...` : "Selecciona un personaje..."}
                  disabled={disabled || !character}
                  className="min-h-[32px] h-8 py-1.5 text-sm resize-none flex-1"
                  rows={1}
                />

                {/* Delete Button */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveLine(line.id)}
                  disabled={disabled}
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          })}
        </div>

        {/* Add Line Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddLine}
          disabled={disabled || characters.length === 0 || lines.length >= 20}
          className="w-full h-8 border-dashed text-xs"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Agregar línea de diálogo
        </Button>

        {lines.length >= 20 && (
          <p className="text-xs text-muted-foreground text-center">
            Máximo 20 líneas de diálogo
          </p>
        )}

        {lines.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            Agrega líneas de diálogo para comenzar
          </p>
        )}
      </div>
    </div>
  );
}

// Helper function to convert dialogue to API format
export function formatDialogueForAPI(characters: Character[], lines: DialogueLine[]): string {
  return lines
    .filter(line => line.text.trim() !== "")
    .map(line => {
      const character = characters.find(c => c.id === line.characterId);
      return `${character?.name || "Unknown"}: ${line.text}`;
    })
    .join("\n");
}

// Helper function to extract unique speakers for API
export function extractSpeakersFromDialogue(characters: Character[], lines: DialogueLine[]): Array<{ name: string; voiceId: AudioVoiceId }> {
  // Get only characters that have dialogue lines with text
  const usedCharacterIds = new Set(
    lines.filter(l => l.text.trim()).map(l => l.characterId)
  );

  return characters
    .filter(c => usedCharacterIds.has(c.id))
    .map(c => ({ name: c.name, voiceId: c.voiceId }));
}

// Backwards compatible exports for existing code
export function createDefaultLinesLegacy(): LegacyDialogueLine[] {
  return [
    { id: generateId(), speakerName: "Narrador", voiceId: "Kore", text: "" },
    { id: generateId(), speakerName: "Personaje1", voiceId: "Puck", text: "" },
  ];
}

export function formatDialogueForAPILegacy(lines: LegacyDialogueLine[]): string {
  return lines
    .filter(line => line.text.trim() !== "")
    .map(line => `${line.speakerName}: ${line.text}`)
    .join("\n");
}

export function extractSpeakersFromLines(lines: LegacyDialogueLine[]): Array<{ name: string; voiceId: AudioVoiceId }> {
  const uniqueSpeakers = new Map<string, AudioVoiceId>();
  lines.forEach(line => {
    if (line.text.trim() !== "") {
      uniqueSpeakers.set(line.speakerName, line.voiceId);
    }
  });
  return Array.from(uniqueSpeakers.entries()).map(([name, voiceId]) => ({ name, voiceId }));
}
