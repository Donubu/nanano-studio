"use client";

import { createContext, useContext } from "react";

import type { CanvasGenerationConfig } from "./canvas-workspace";

interface CanvasContextValue {
  projectId: number;
  generationConfig: CanvasGenerationConfig[];
  openImagePicker: (onSelect: (imageUrl: string) => void, title?: string) => void;
}

const CanvasContext = createContext<CanvasContextValue>({
  projectId: 0,
  generationConfig: [],
  openImagePicker: () => {},
});

export const CanvasProvider = CanvasContext.Provider;
export const useCanvasContext = () => useContext(CanvasContext);
