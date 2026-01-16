"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Play, Square, Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AUDIO_VOICES, getVoiceById, AudioVoiceId } from "@/types/audio";

// Group voices by style
const voiceGroups = {
  "Brillantes / Animadas": AUDIO_VOICES.filter(v => ["bright", "upbeat", "lively"].includes(v.style)),
  "Informativas / Claras": AUDIO_VOICES.filter(v => ["informative", "clear"].includes(v.style)),
  "Firmes / Suaves": AUDIO_VOICES.filter(v => ["firm", "smooth", "even"].includes(v.style)),
  "Expresivas / Casuales": AUDIO_VOICES.filter(v => ["excitable", "breezy", "easygoing", "casual", "friendly"].includes(v.style)),
  "Distintivas": AUDIO_VOICES.filter(v => ["breathy", "gravelly", "soft", "mature", "forward", "gentle", "warm"].includes(v.style)),
};

interface VoiceSelectorProps {
  value: string;
  onValueChange: (value: AudioVoiceId) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}

export function VoiceSelector({
  value,
  onValueChange,
  disabled = false,
  compact = false,
  className,
}: VoiceSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selectedVoice = getVoiceById(value);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  // Stop audio when closing dropdown
  useEffect(() => {
    if (!open && audioRef.current) {
      audioRef.current.pause();
      setPlayingVoice(null);
    }
  }, [open]);

  // Filter voices by search
  const filterVoices = (voices: typeof AUDIO_VOICES[number][]) => {
    if (!search) return voices;
    const searchLower = search.toLowerCase();
    return voices.filter(
      v => v.name.toLowerCase().includes(searchLower) ||
           v.description.toLowerCase().includes(searchLower)
    );
  };

  const handlePlayPreview = (voiceId: string) => {
    // Si ya está reproduciendo esta voz, detener
    if (playingVoice === voiceId) {
      audioRef.current?.pause();
      setPlayingVoice(null);
      return;
    }

    // Detener cualquier reproducción anterior
    audioRef.current?.pause();

    // Crear nuevo audio y reproducir
    const audio = new Audio(`https://www.gstatic.com/aistudio/voices/samples/${voiceId}.wav`);
    audioRef.current = audio;
    setPlayingVoice(voiceId);

    audio.play().catch((err) => {
      console.error("Error playing voice preview:", err);
      setPlayingVoice(null);
    });

    audio.onended = () => {
      setPlayingVoice(null);
    };

    audio.onerror = () => {
      setPlayingVoice(null);
    };
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={cn(
          "justify-between w-full",
          compact ? "h-8" : "h-11"
        )}
      >
        {selectedVoice ? (
          <div className="flex items-center gap-2 truncate">
            <span className={compact ? "" : "font-medium"}>{selectedVoice.name}</span>
            {!compact && (
              <span className="text-muted-foreground">
                - {selectedVoice.description}
              </span>
            )}
          </div>
        ) : (
          "Seleccionar voz..."
        )}
        <ChevronDown className={cn("ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform", open && "rotate-180")} />
      </Button>

      {open && (
        <div className="absolute z-50 mt-1 w-[340px] rounded-md border bg-popover p-0 shadow-md">
          {/* Search input */}
          <div className="flex items-center border-b px-3 py-2">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              type="text"
              placeholder="Buscar voz..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </div>

          {/* Voice list */}
          <div className="max-h-[300px] overflow-y-auto p-1">
            {Object.entries(voiceGroups).map(([groupName, voices]) => {
              const filteredVoices = filterVoices(voices);
              if (filteredVoices.length === 0) return null;

              return (
                <div key={groupName}>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    {groupName}
                  </div>
                  {filteredVoices.map((voice) => (
                    <div
                      key={voice.id}
                      className={cn(
                        "flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent",
                        value === voice.id && "bg-accent"
                      )}
                      onClick={() => {
                        onValueChange(voice.id as AudioVoiceId);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0",
                          value === voice.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <button
                        type="button"
                        className={cn(
                          "p-1.5 rounded-full transition-colors shrink-0 flex items-center justify-center",
                          playingVoice === voice.id
                            ? "bg-primary/20 text-primary"
                            : "bg-muted hover:bg-primary/10"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayPreview(voice.id);
                        }}
                        title={playingVoice === voice.id ? "Detener" : "Escuchar preview"}
                      >
                        {playingVoice === voice.id ? (
                          <Square className="h-3 w-3 fill-current" />
                        ) : (
                          <Play className="h-3 w-3 fill-current" />
                        )}
                      </button>
                      <span className="flex-1 font-medium">{voice.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {voice.description}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* No results */}
            {Object.values(voiceGroups).every(voices => filterVoices(voices).length === 0) && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No se encontró ninguna voz.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
