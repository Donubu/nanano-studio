"use client";

import { Video, Loader2 } from "lucide-react";
import { VideoGenerationStatus } from "@/types/video";

interface VideoProgressProps {
  status: VideoGenerationStatus;
  message: string;
  progress?: number;
}

export function VideoProgress({ status, message, progress }: VideoProgressProps) {
  return (
    <div className="flex flex-col items-center justify-center p-6 bg-muted/50 rounded-lg border border-border max-w-md">
      {/* Icono animado */}
      <div className="relative mb-4">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          {status === "completed" ? (
            <Video className="w-8 h-8 text-primary" />
          ) : status === "failed" ? (
            <Video className="w-8 h-8 text-destructive" />
          ) : (
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          )}
        </div>

        {/* Indicador de progreso circular */}
        {status === "processing" && progress !== undefined && (
          <svg
            className="absolute inset-0 w-16 h-16 -rotate-90"
            viewBox="0 0 64 64"
          >
            <circle
              cx="32"
              cy="32"
              r="28"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              className="text-primary/20"
            />
            <circle
              cx="32"
              cy="32"
              r="28"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeDasharray={`${(progress / 100) * 176} 176`}
              strokeLinecap="round"
              className="text-primary transition-all duration-300"
            />
          </svg>
        )}
      </div>

      {/* Mensaje de estado */}
      <p className="text-sm text-center text-muted-foreground mb-2">
        {message}
      </p>

      {/* Barra de progreso lineal */}
      {status === "processing" && progress !== undefined && (
        <div className="w-full max-w-xs">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Progreso</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Nota sobre tiempo de generación */}
      {status === "processing" && (
        <p className="text-xs text-muted-foreground mt-3 text-center">
          La generación de video puede tomar 1-3 minutos
        </p>
      )}
    </div>
  );
}
