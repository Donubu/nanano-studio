"use client";

import { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2, VolumeX, Download, RotateCcw, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { AudioVoiceConfig, AudioSpeakerConfig, getVoiceById } from "@/types/audio";

interface AudioPlayerProps {
  audioUrl: string;
  duration?: number;
  mimeType?: string;
  voiceConfig?: AudioVoiceConfig | AudioSpeakerConfig | null;
  onDownload?: () => void;
}

function isAudioSpeakerConfig(config: AudioVoiceConfig | AudioSpeakerConfig): config is AudioSpeakerConfig {
  return "speakers" in config;
}

export function AudioPlayer({
  audioUrl,
  duration,
  mimeType = "audio/mpeg",
  voiceConfig,
  onDownload,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(duration || 0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (audioRef.current && duration) {
      setAudioDuration(duration);
    }
  }, [duration]);

  const handlePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleMuteToggle = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
      setIsMuted(newVolume === 0);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setAudioDuration(audioRef.current.duration);
      setIsLoading(false);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
    setCurrentTime(0);
  };

  const handleRestart = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (audioRef.current && audioDuration) {
      const rect = e.currentTarget.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      audioRef.current.currentTime = pos * audioDuration;
    }
  };

  const handleDownload = async () => {
    if (onDownload) {
      onDownload();
      return;
    }

    try {
      const response = await fetch(audioUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const extension = mimeType === "audio/mpeg" ? "mp3" : "wav";
      a.download = `audio-${Date.now()}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error downloading audio:", error);
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Get voice display info
  const getVoiceLabel = () => {
    if (!voiceConfig) return null;

    if (isAudioSpeakerConfig(voiceConfig)) {
      return `${voiceConfig.speakers.length} voces`;
    }

    const voice = getVoiceById(voiceConfig.voiceId, voiceConfig.engine);
    return voice?.name || voiceConfig.voiceId;
  };

  const voiceLabel = getVoiceLabel();
  const isChirpEngine = voiceConfig && !isAudioSpeakerConfig(voiceConfig) && voiceConfig.engine === "chirp";

  return (
    <div className="relative w-full max-w-md rounded-lg overflow-hidden bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-200/50 dark:border-violet-800/50">
      {/* Audio element (hidden) */}
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleAudioEnded}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
        onCanPlay={() => setIsLoading(false)}
        preload="metadata"
      />

      <div className="p-4">
        {/* Waveform visualization placeholder + controls */}
        <div className="flex items-center gap-3">
          {/* Play/Pause button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 rounded-full bg-violet-500 hover:bg-violet-600 text-white shrink-0"
            onClick={handlePlayPause}
            disabled={isLoading}
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 ml-0.5" />
            )}
          </Button>

          {/* Progress section */}
          <div className="flex-1 min-w-0">
            {/* Time display */}
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(audioDuration)}</span>
            </div>

            {/* Progress bar */}
            <div
              className="w-full h-2 bg-violet-200/50 dark:bg-violet-800/30 rounded-full cursor-pointer group"
              onClick={handleSeek}
            >
              <div
                className="h-full bg-violet-500 rounded-full transition-all relative"
                style={{
                  width: `${audioDuration ? (currentTime / audioDuration) * 100 : 0}%`,
                }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-violet-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom controls */}
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-1">
            {/* Restart */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={handleRestart}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>

            {/* Volume */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={handleMuteToggle}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </Button>
              <Slider
                value={[isMuted ? 0 : volume]}
                max={1}
                step={0.01}
                onValueChange={handleVolumeChange}
                className="w-16"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Voice badge */}
            {voiceLabel && (
              <div className="flex items-center gap-1 bg-violet-100 dark:bg-violet-900/30 rounded-full px-2 py-1">
                <Mic className="h-3 w-3 text-violet-600 dark:text-violet-400" />
                <span className="text-xs text-violet-700 dark:text-violet-300">{voiceLabel}</span>
                {isChirpEngine && (
                  <span className="text-[9px] bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 px-1 rounded font-medium">HD</span>
                )}
              </div>
            )}

            {/* Download */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={handleDownload}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
