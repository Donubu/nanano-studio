"use client";

import { Volume2, Clock, Users, User, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AudioPlayer } from "./audio-player";
import { AudioVoiceConfig, AudioSpeakerConfig, getVoiceById } from "@/types/audio";

interface AudioMessage {
  id: number;
  role: string;
  content: string;
  audio_url?: string | null;
  audio_duration?: number | null;
  audio_mime_type?: string | null;
  audio_voice_config?: AudioVoiceConfig | AudioSpeakerConfig | null;
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
}

function isAudioSpeakerConfig(config: AudioVoiceConfig | AudioSpeakerConfig | string | null | undefined): config is AudioSpeakerConfig {
  if (!config) return false;
  // Handle case where config is still a JSON string
  const parsed = typeof config === "string" ? JSON.parse(config) : config;
  return parsed && typeof parsed === "object" && "speakers" in parsed;
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

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AudioGenerationHistory({ messages, onRestore }: AudioGenerationHistoryProps) {
  // Filter messages that have audio or are generating audio
  const audioMessages = messages.filter(
    (msg) => msg.role === "model" && (msg.audio_url || msg.isAudioGenerating)
  );

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
          <AudioHistoryItem key={msg.id} message={msg} onRestore={onRestore} />
        ))}
      </div>
    </div>
  );
}

function AudioHistoryItem({
  message,
  onRestore
}: {
  message: AudioMessage;
  onRestore?: (data: AudioRestoreData) => void;
}) {
  // Parse voice config (might be JSON string from DB)
  const voiceConfig = parseVoiceConfig(message.audio_voice_config);
  const isMultiSpeaker = isAudioSpeakerConfig(voiceConfig);

  // Get voice info for display
  let voiceInfo: string;
  if (isMultiSpeaker && voiceConfig) {
    const speakerCount = (voiceConfig as AudioSpeakerConfig).speakers.length;
    voiceInfo = `${speakerCount} voces`;
  } else if (voiceConfig && "voiceId" in voiceConfig) {
    const voice = getVoiceById((voiceConfig as AudioVoiceConfig).voiceId);
    voiceInfo = voice?.name || (voiceConfig as AudioVoiceConfig).voiceId;
  } else {
    voiceInfo = "Voz desconocida";
  }

  // Handle restore button click
  const handleRestore = () => {
    if (onRestore) {
      onRestore({
        content: message.content,
        voiceConfig,
        isMultiSpeaker,
      });
    }
  };

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
    <div className="p-4 bg-card rounded-lg border border-border/50 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isMultiSpeaker ? (
            <Users className="w-4 h-4 text-muted-foreground" />
          ) : (
            <User className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{voiceInfo}</span>
          {message.audio_duration && (
            <span className="text-xs text-muted-foreground">
              {formatDuration(message.audio_duration)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onRestore && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRestore}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              title="Restaurar en el formulario"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Restaurar
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {formatTime(message.created_at)}
          </span>
        </div>
      </div>

      {/* Audio Player */}
      <AudioPlayer
        audioUrl={message.audio_url}
        duration={message.audio_duration ?? undefined}
        mimeType={message.audio_mime_type ?? undefined}
        voiceConfig={voiceConfig}
      />

      {/* Original text preview (if content exists) */}
      {message.content && (
        <div className="pt-2 border-t border-border/50">
          <p className="text-xs text-muted-foreground line-clamp-2">
            {message.content}
          </p>
        </div>
      )}
    </div>
  );
}
