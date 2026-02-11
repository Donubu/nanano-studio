"use client";

import { Sparkles, Zap } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

export type QualityTier = "normal" | "hq";

interface UsageInfo {
  used: number;
  limit: number;
}

interface QualitySelectorProps {
  selectedQuality: QualityTier;
  onSelect: (quality: QualityTier) => void;
  disabled?: boolean;
  normalUsage?: UsageInfo;
  hqUsage?: UsageInfo;
  showUsage?: boolean;
  normalModelName?: string | null;
  hqModelName?: string | null;
}

export function QualitySelector({
  selectedQuality,
  onSelect,
  disabled,
  normalUsage,
  hqUsage,
  showUsage = true,
  normalModelName,
  hqModelName,
}: QualitySelectorProps) {
  const normalDisabled = normalUsage ? normalUsage.limit > 0 && normalUsage.used >= normalUsage.limit : false;
  const hqDisabled = hqUsage ? hqUsage.limit > 0 && hqUsage.used >= hqUsage.limit : false;

  const formatUsage = (usage?: UsageInfo) => {
    if (!usage || usage.limit === 0) return null;
    return `${usage.used}/${usage.limit}`;
  };

  const normalLabel = normalModelName || "Normal";
  const hqLabel = hqModelName || "HQ";

  return (
    <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => !normalDisabled && onSelect("normal")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              normalDisabled
                ? "text-muted-foreground/50 cursor-not-allowed"
                : selectedQuality === "normal"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
            }`}
            disabled={disabled || normalDisabled}
          >
            <Zap className="w-4 h-4 shrink-0" />
            <span className="truncate max-w-[120px]">{normalLabel}</span>
            {showUsage && formatUsage(normalUsage) && (
              <span className="text-xs opacity-60 shrink-0">({formatUsage(normalUsage)})</span>
            )}
          </button>
        </TooltipTrigger>
        {normalDisabled ? (
          <TooltipContent>
            Has alcanzado el límite de generaciones normales para este mes
          </TooltipContent>
        ) : normalModelName ? (
          <TooltipContent>Normal — {normalModelName}</TooltipContent>
        ) : null}
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => !hqDisabled && onSelect("hq")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              hqDisabled
                ? "text-muted-foreground/50 cursor-not-allowed"
                : selectedQuality === "hq"
                  ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
            }`}
            disabled={disabled || hqDisabled}
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span className="truncate max-w-[120px]">{hqLabel}</span>
            {showUsage && formatUsage(hqUsage) && (
              <span className="text-xs opacity-60 shrink-0">({formatUsage(hqUsage)})</span>
            )}
          </button>
        </TooltipTrigger>
        {hqDisabled ? (
          <TooltipContent>
            Has alcanzado el límite de generaciones HQ para este mes
          </TooltipContent>
        ) : hqModelName ? (
          <TooltipContent>HQ — {hqModelName}</TooltipContent>
        ) : (
          <TooltipContent>
            Alta calidad - Modelo premium con mejores resultados
          </TooltipContent>
        )}
      </Tooltip>
    </div>
  );
}

// Badge for displaying quality in gallery/lists
export function QualityBadge({ quality }: { quality: QualityTier }) {
  if (quality === "hq") {
    return (
      <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 text-[10px] px-1.5 py-0">
        <Sparkles className="w-3 h-3 mr-0.5" />
        HQ
      </Badge>
    );
  }
  return null; // Don't show badge for normal quality
}

// Compact inline selector for tight spaces
export function QualitySelectorCompact({
  selectedQuality,
  onSelect,
  disabled,
  normalModelName,
  hqModelName,
}: Pick<QualitySelectorProps, "selectedQuality" | "onSelect" | "disabled" | "normalModelName" | "hqModelName">) {
  const normalLabel = normalModelName || "Normal";
  const hqLabel = hqModelName || "HQ";

  return (
    <div className="flex items-center gap-0.5 p-0.5 bg-muted rounded-md">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => onSelect("normal")}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors truncate max-w-[100px] ${
              selectedQuality === "normal"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            disabled={disabled}
          >
            {normalLabel}
          </button>
        </TooltipTrigger>
        {normalModelName && <TooltipContent>{normalModelName}</TooltipContent>}
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => onSelect("hq")}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors truncate max-w-[100px] ${
              selectedQuality === "hq"
                ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            disabled={disabled}
          >
            {hqLabel}
          </button>
        </TooltipTrigger>
        {hqModelName && <TooltipContent>{hqModelName}</TooltipContent>}
      </Tooltip>
    </div>
  );
}
