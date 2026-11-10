"use client";

import { createContext, useContext } from "react";

import type { CanvasGenerationConfig } from "./canvas-workspace";

export interface CharacterMaterializeResult {
  summary: string;
  warnings: string[];
  addedNodeIds: string[];
  addedEdgeIds: string[];
}

interface CanvasContextValue {
  projectId: number;
  conversationId: number;
  generationConfig: CanvasGenerationConfig[];
  openImagePicker: (onSelect: (imageUrl: string) => void, title?: string) => void;
  emitNodeData: (nodeId: string, updates: Record<string, unknown>) => void;
  // Update + persist node data from inside a node component. Hace el merge en
  // el state, persiste (UPSERT con debounce) y emite a los colaboradores.
  persistNodeData: (nodeId: string, updates: Record<string, unknown>) => void;
  // Lock de edición: false = el usuario está en solo-ver (no es el editor de la
  // sala). Los componentes de nodo ocultan controles de escritura con esto.
  canEdit: boolean;
  // "Generar etapas" de un nodo Personaje.
  materializeCharacter: (characterId: string) => Promise<CharacterMaterializeResult>;
}

const CanvasContext = createContext<CanvasContextValue>({
  projectId: 0,
  conversationId: 0,
  generationConfig: [],
  openImagePicker: () => {},
  emitNodeData: () => {},
  persistNodeData: () => {},
  canEdit: true,
  materializeCharacter: async () => ({ summary: "", warnings: [], addedNodeIds: [], addedEdgeIds: [] }),
});

export const CanvasProvider = CanvasContext.Provider;
export const useCanvasContext = () => useContext(CanvasContext);
