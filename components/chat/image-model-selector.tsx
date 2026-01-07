"use client";

import { Image as ImageIcon } from "lucide-react";

interface ProjectModel {
  id: number;
  model_id: number;
  model_model_id: string;
  model_display_name: string;
  is_default: boolean;
  supports_image_generation: boolean;
  supports_video_generation: boolean;
  system_instruction: string | null;
}

interface ImageModelSelectorProps {
  projectModels: ProjectModel[];
  selectedModelId: number | null;
  onChange: (modelId: number) => void;
  disabled?: boolean;
}

export function ImageModelSelector({
  projectModels,
  selectedModelId,
  onChange,
  disabled,
}: ImageModelSelectorProps) {
  // Filtrar solo modelos que soportan imagen
  const imageModels = projectModels.filter((m) => m.supports_image_generation);

  if (imageModels.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-2">
        No hay modelos de imagen disponibles
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ImageIcon className="w-4 h-4 text-muted-foreground" />
        <label className="text-sm font-medium">Modelo de Imagen</label>
      </div>
      <select
        className="w-full bg-[#24242e] border border-border/50 rounded-lg px-3 py-2 text-sm"
        value={selectedModelId?.toString() || ""}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      >
        <option value="" disabled>
          Seleccionar modelo
        </option>
        {imageModels.map((model) => (
          <option key={model.model_id} value={model.model_id.toString()}>
            {model.model_display_name}
          </option>
        ))}
      </select>
    </div>
  );
}
