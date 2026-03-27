"use client";

import { createContext, useContext } from "react";

import type { CanvasGenerationConfig } from "./canvas-workspace";
interface CanvasContextValue {
  projectId: number;
  generationConfig: CanvasGenerationConfig[];
  openImagePicker: (onSelect: (imageUrl: string) => void, title?: string) => void;
  emitNodeData: (nodeId: string, updates: Record<string, unknown>) => void;
}

const CanvasContext = createContext<CanvasContextValue>({
  projectId: 0,
  generationConfig: [],
  openImagePicker: () => {},
  emitNodeData: () => {},
});

export const CanvasProvider = CanvasContext.Provider;
export const useCanvasContext = () => useContext(CanvasContext);
