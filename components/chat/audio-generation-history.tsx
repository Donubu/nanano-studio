"use client";

import { Volume2, Clock, Loader2, Star } from "lucide-react";
import { AudioPlayer } from "./audio-player";
import { AudioVoiceConfig, AudioSpeakerConfig } from "@/types/audio";

interface AudioMessage {
  id: number;
  role: string;
  content: string;
  audio_url?: string | null;
  audio_duration?: number | null;
  audio_mime_type?: string | null;
  audio_voice_config?: AudioVoiceConfig | AudioSpeakerConfig | null;
  is_favorite?: boolean;
  created_at: string;
  isAudioGenerating?: boolean;
  audioProgress?: { status: string; message: string };
}

// Data structure for restoring audio generation settings
export interface AudioRestoreData {
  content: string;
  voiceConfig: AudioVoiceConfig | AudioSpeakerConfig | null;
  isMultiSpeaker: boolean;
}

interface AudioGenerationHistoryProps {
  messages: AudioMessage[];
  onRestore?: (data: AudioRestoreData) => void;
  onToggleFavorite?: (messageId: number) => void;
}

function parseVoiceConfig(config: AudioVoiceConfig | AudioSpeakerConfig | string | null | undefined): AudioVoiceConfig | AudioSpeakerConfig | null {
  if (!config) return null;
  if (typeof config === "string") {
    try {
      return JSON.parse(config);
    } catch {
      return null;
    }
  }
  return config;
}

export function AudioGenerationHistory({ messages, onRestore, onToggleFavorite }: AudioGenerationHistoryProps) {
  // Filter messages that have audio or are generating audio, most recent first
  const audioMessages = messages
    .filter((msg) => msg.role === "model" && (msg.audio_url || msg.isAudioGenerating))
    .slice()
    .reverse();

  if (audioMessages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="p-4 bg-muted/50 rounded-full mb-4">
          <Volume2 className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium text-muted-foreground">
          Sin generaciones aún
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Los audios generados aparecerán aquí
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Clock className="w-4 h-4" />
        <span>Historial de generaciones</span>
        <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
          {audioMessages.length}
        </span>
      </div>

      <div className="space-y-3">
        {audioMessages.map((msg) => (
          <AudioHistoryItem key={msg.id} message={msg} onToggleFavorite={onToggleFavorite} />
        ))}
      </div>
    </div>
  );
}

function AudioHistoryItem({
  message,
  onToggleFavorite,
}: {
  message: AudioMessage;
  onToggleFavorite?: (messageId: number) => void;
}) {
  // Parse voice config (might be JSON string from DB)
  const voiceConfig = parseVoiceConfig(message.audio_voice_config);

  // If generating, show progress
  if (message.isAudioGenerating) {
    return (
      <div className="p-4 bg-card rounded-lg border border-border/50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">Generando audio...</p>
            {message.audioProgress && (
              <p className="text-xs text-muted-foreground mt-1">
                {message.audioProgress.message}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // If no audio URL, skip
  if (!message.audio_url) {
    return null;
  }

  return (
    <div className="group relative">
      {onToggleFavorite && (
        <button
          onClick={() => onToggleFavorite(message.id)}
          className={`absolute -top-2 -right-2 p-1 rounded-full transition-all z-10 ${
            message.is_favorite
              ? "bg-yellow-500/20 text-yellow-400"
              : "bg-card border border-border/50 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-yellow-400"
          }`}
          title={message.is_favorite ? "Quitar de favoritos" : "Agregar a favoritos"}
        >
          <Star className={`h-4 w-4 ${message.is_favorite ? "fill-yellow-400" : ""}`} />
        </button>
      )}
      <AudioPlayer
        audioUrl={message.audio_url}
        duration={message.audio_duration ?? undefined}
        mimeType={message.audio_mime_type ?? undefined}
        voiceConfig={voiceConfig}
      />
    </div>
  );
}
