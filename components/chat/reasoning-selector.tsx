"use client";

import { Brain, ChevronDown, Eye } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type ThinkingLevel = "none" | "low" | "medium" | "high";

const THINKING_LEVELS: { value: ThinkingLevel; label: string; description: string }[] = [
  { value: "none", label: "Off", description: "Sin razonamiento extendido" },
  { value: "low", label: "Bajo", description: "Razonamiento ligero (~1K tokens)" },
  { value: "medium", label: "Medio", description: "Razonamiento moderado (~8K tokens)" },
  { value: "high", label: "Alto", description: "Razonamiento profundo (~24K tokens)" },
];

interface ReasoningSelectorProps {
  value: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
  showThoughts: boolean;
  onShowThoughtsChange: (show: boolean) => void;
  disabled?: boolean;
}

export function ReasoningSelector({ value, onChange, showThoughts, onShowThoughtsChange, disabled }: ReasoningSelectorProps) {
  const isActive = value !== "none";

  return (
    <div className="inline-flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative inline-flex items-center">
            <Brain className={`absolute left-2.5 w-4 h-4 pointer-events-none ${isActive ? "text-purple-500" : "text-muted-foreground"}`} />
            <select
              value={value}
              onChange={(e) => onChange(e.target.value as ThinkingLevel)}
              disabled={disabled}
              className={`appearance-none pl-8 pr-7 py-1.5 rounded-lg text-sm font-medium border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isActive
                  ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30 hover:bg-purple-500/15"
                  : "bg-muted text-muted-foreground border-border/30 hover:bg-muted/80"
              }`}
            >
              {THINKING_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-1.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {THINKING_LEVELS.find(l => l.value === value)?.description || "Nivel de razonamiento"}
        </TooltipContent>
      </Tooltip>

      {isActive && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onShowThoughtsChange(!showThoughts)}
              disabled={disabled}
              className={`p-1.5 rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                showThoughts
                  ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30"
                  : "bg-muted text-muted-foreground border-border/30 hover:bg-muted/80"
              }`}
            >
              <Eye className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {showThoughts ? "Ocultar razonamiento" : "Mostrar razonamiento"}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
