"use client";

import { useState, useRef, useEffect } from "react";
import { Play, Pause, Volume2, VolumeX, Download, Music, Save, Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { getScaleById, type MusicGenerationSettings } from "@/types/music";

interface MusicPlayerProps {
  musicUrl: string;
  duration?: number;
  config?: MusicGenerationSettings | null;
  // Preview mode props
  isPreview?: boolean;
  onSave?: () => void;
  onDiscard?: () => void;
  onRegenerate?: () => void;
  isSaving?: boolean;
  // Reuse config
  onReuse?: () => void;
}

export function MusicPlayer({
  musicUrl,
  duration,
  config,
  isPreview = false,
  onSave,
  onDiscard,
  onRegenerate,
  isSaving = false,
  onReuse,
}: MusicPlayerProps) {
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

  // Pause this player when another player starts playing
  useEffect(() => {
    const handleOtherPlay = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail !== audioRef.current && audioRef.current) {
        audioRef.current.pause();
        setIsPlaying(false);
      }
    };
    document.addEventListener("audio-player-play", handleOtherPlay);
    return () => document.removeEventListener("audio-player-play", handleOtherPlay);
  }, []);

  const handlePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        document.dispatchEvent(new CustomEvent("audio-player-play", { detail: audioRef.current }));
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

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (audioRef.current && audioDuration) {
      const rect = e.currentTarget.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      audioRef.current.currentTime = pos * audioDuration;
    }
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(musicUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `music-${Date.now()}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error downloading music:", error);
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const scaleInfo = config?.scale ? getScaleById(config.scale) : null;

  return (
    <div className={`relative w-full max-w-md rounded-lg overflow-hidden bg-gradient-to-r from-teal-500/10 to-emerald-500/10 border ${
      isPreview
        ? "border-dashed border-teal-400/60 dark:border-teal-600/60"
        : "border-teal-200/50 dark:border-teal-800/50"
    }`}>
      <audio
        ref={audioRef}
        src={musicUrl}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleAudioEnded}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
        onCanPlay={() => setIsLoading(false)}
        preload="metadata"
      />

      <div className="p-4">
        {/* Preview badge */}
        {isPreview && (
          <div className="flex items-center gap-1.5 mb-3">
            <div className="h-2 w-2 rounded-full bg-teal-500 animate-pulse" />
            <span className="text-xs font-medium text-teal-600 dark:text-teal-400">Preview</span>
          </div>
        )}

        {/* Player controls */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 rounded-full bg-teal-500 hover:bg-teal-600 text-white shrink-0"
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

          <div className="flex-1 min-w-0">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(audioDuration)}</span>
            </div>

            <div
              className="w-full h-2 bg-teal-200/50 dark:bg-teal-800/30 rounded-full cursor-pointer group"
              onClick={handleSeek}
            >
              <div
                className="h-full bg-teal-500 rounded-full transition-all relative"
                style={{
                  width: `${audioDuration ? (currentTime / audioDuration) * 100 : 0}%`,
                }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-teal-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom controls */}
        <div className="flex items-center justify-between mt-3">
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

          <div className="flex items-center gap-2">
            {/* Config badges */}
            {config?.bpm && (
              <div className="flex items-center gap-1 bg-teal-100 dark:bg-teal-900/30 rounded-full px-2 py-1">
                <Music className="h-3 w-3 text-teal-600 dark:text-teal-400" />
                <span className="text-xs text-teal-700 dark:text-teal-300">{config.bpm} BPM</span>
              </div>
            )}
            {scaleInfo && scaleInfo.id !== "UNSPECIFIED" && (
              <div className="bg-teal-100 dark:bg-teal-900/30 rounded-full px-2 py-1">
                <span className="text-xs text-teal-700 dark:text-teal-300">{scaleInfo.name}</span>
              </div>
            )}

            {!isPreview && onReuse && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-teal-500 hover:text-teal-600 hover:bg-teal-500/10"
                onClick={onReuse}
                title="Reutilizar configuración"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
            {!isPreview && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={handleDownload}
              >
                <Download className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Preview actions */}
        {isPreview && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-teal-200/30 dark:border-teal-800/30">
            <Button
              size="sm"
              className="flex-1 bg-teal-600 hover:bg-teal-700 text-white"
              onClick={onSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5" />
              ) : (
                <Save className="h-4 w-4 mr-1.5" />
              )}
              Guardar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300"
              onClick={onRegenerate}
              disabled={isSaving}
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Regenerar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
              onClick={onDiscard}
              disabled={isSaving}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
