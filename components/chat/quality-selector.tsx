"use client";

import { Sparkles, Zap, ChevronDown } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

// Legacy export for backward compat
export type QualityTier = "normal" | "hq";

export interface ProjectModel {
  id: number;
  model_id: string;
  display_name: string;
  label: string;
  sort_order: number;
  is_default: boolean;
  supports_google_search: boolean;
  api_backend: string | null;
}

interface ModelSelectorProps {
  models: ProjectModel[];
  selectedModelId: number | null;
  onSelect: (modelId: number) => void;
  disabled?: boolean;
}

export function ModelSelector({
  models,
  selectedModelId,
  onSelect,
  disabled,
}: ModelSelectorProps) {
  if (models.length === 0) return null;

  // Auto-select default if nothing selected
  const effectiveSelected = selectedModelId ?? models.find(m => m.is_default)?.id ?? models[0]?.id;

  // 1 model: no selector needed
  if (models.length === 1) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground">
        <Zap className="w-4 h-4 shrink-0" />
        <span className="truncate max-w-[200px]">
          {models[0].label ? `${models[0].label} — ${models[0].display_name}` : models[0].display_name}
        </span>
      </div>
    );
  }

  // 2 models: segmented control (buttons)
  if (models.length <= 2) {
    return (
      <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
        {models.map((model, index) => {
          const isSelected = model.id === effectiveSelected;
          const displayLabel = model.label
            ? `${model.label} — ${model.display_name}`
            : model.display_name;

          return (
            <Tooltip key={model.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSelect(model.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isSelected
                      ? index === 0
                        ? "bg-background text-foreground shadow-sm"
                        : "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  disabled={disabled}
                >
                  {index === 0 ? (
                    <Zap className="w-4 h-4 shrink-0" />
                  ) : (
                    <Sparkles className="w-4 h-4 shrink-0" />
                  )}
                  <span className="truncate max-w-[120px]">{displayLabel}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{model.display_name}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  // 3+ models: dropdown select
  return (
    <div className="relative">
      <select
        value={effectiveSelected ?? ""}
        onChange={(e) => onSelect(Number(e.target.value))}
        disabled={disabled}
        className="appearance-none w-full px-3 py-2 pr-8 rounded-lg text-sm font-medium bg-muted text-foreground border border-border/30 cursor-pointer hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {models.map((model) => {
          const label = model.label
            ? `${model.label} — ${model.display_name}`
            : model.display_name;
          return (
            <option key={model.id} value={model.id}>
              {label}
            </option>
          );
        })}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
    </div>
  );
}

// Badge for displaying model label in gallery/lists
export function QualityBadge({ quality, label }: { quality?: QualityTier | string; label?: string }) {
  // Show label if provided
  if (label && label !== "Normal") {
    return (
      <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 text-[10px] px-1.5 py-0">
        <Sparkles className="w-3 h-3 mr-0.5" />
        {label}
      </Badge>
    );
  }
  // Legacy support
  if (quality === "hq") {
    return (
      <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 text-[10px] px-1.5 py-0">
        <Sparkles className="w-3 h-3 mr-0.5" />
        HQ
      </Badge>
    );
  }
  return null;
}

// Legacy exports for backward compatibility during transition
export function QualitySelector({
  selectedQuality,
  onSelect,
  disabled,
  normalModelName,
  hqModelName,
}: {
  selectedQuality: QualityTier;
  onSelect: (quality: QualityTier) => void;
  disabled?: boolean;
  normalUsage?: { used: number; limit: number };
  hqUsage?: { used: number; limit: number };
  showUsage?: boolean;
  normalModelName?: string | null;
  hqModelName?: string | null;
}) {
  const models: ProjectModel[] = [];
  if (normalModelName) {
    models.push({
      id: -1,
      model_id: "",
      display_name: normalModelName,
      label: "Normal",
      sort_order: 0,
      is_default: true,
      supports_google_search: false,
      api_backend: null,
    });
  }
  if (hqModelName) {
    models.push({
      id: -2,
      model_id: "",
      display_name: hqModelName,
      label: "HQ",
      sort_order: 1,
      is_default: false,
      supports_google_search: false,
      api_backend: null,
    });
  }

  const selectedId = selectedQuality === "hq" ? -2 : -1;

  return (
    <ModelSelector
      models={models}
      selectedModelId={selectedId}
      onSelect={(id) => onSelect(id === -2 ? "hq" : "normal")}
      disabled={disabled}
    />
  );
}

export function QualitySelectorCompact({
  selectedQuality,
  onSelect,
  disabled,
  normalModelName,
  hqModelName,
}: {
  selectedQuality: QualityTier;
  onSelect: (quality: QualityTier) => void;
  disabled?: boolean;
  normalModelName?: string | null;
  hqModelName?: string | null;
}) {
  return (
    <QualitySelector
      selectedQuality={selectedQuality}
      onSelect={onSelect}
      disabled={disabled}
      normalModelName={normalModelName}
      hqModelName={hqModelName}
    />
  );
}
