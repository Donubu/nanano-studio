"use client";

import { Zap, ChevronDown } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

  // 2 models: segmented control (buttons), neutral styling for both
  if (models.length <= 2) {
    return (
      <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
        {models.map((model) => {
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
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  disabled={disabled}
                >
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

