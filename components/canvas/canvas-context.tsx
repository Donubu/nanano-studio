"use client";

import { createContext, useContext } from "react";

interface CanvasContextValue {
  projectId: number;
  openImagePicker: (onSelect: (imageUrl: string) => void, title?: string) => void;
}

const CanvasContext = createContext<CanvasContextValue>({
  projectId: 0,
  openImagePicker: () => {},
});

export const CanvasProvider = CanvasContext.Provider;
export const useCanvasContext = () => useContext(CanvasContext);
