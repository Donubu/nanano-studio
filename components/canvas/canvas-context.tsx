"use client";

import { createContext, useContext } from "react";

import type { CanvasGenerationConfig } from "./canvas-workspace";
import type { LinkUsage } from "./lib/canvas-types";

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
  // "Generar escenas" de un Guión (incremental: actualiza, no rehace).
  materializeScript: (scriptId: string, opts: ScriptMaterializeOptions) => Promise<{ summary: string; warnings: string[] }>;
  // Dónde se usan los Personajes / Escenas de este canvas como vinculados en
  // otros canvas del proyecto (id de nodo → canvas).
  linkUsage: LinkUsage;
  // Abre otro canvas en una pestaña y, si se indica, centra un nodo.
  openCanvas?: (conversationId: number, focusNodeId?: string) => void;
}

export interface ScriptMaterializeOptions {
  linkPreviousOutput?: boolean;
  visualReferenceSourceId?: string | null;
  paramsSceneSourceId?: string | null;
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
  materializeScript: async () => ({ summary: "", warnings: [] }),
  linkUsage: {},
});

export const CanvasProvider = CanvasContext.Provider;

// Ids de los nodos seleccionados, para que las conexiones se destaquen o se
// atenúen. Contexto aparte del principal: cambia con cada selección y solo lo
// leen las conexiones.
const SelectedNodesContext = createContext<ReadonlySet<string>>(new Set());
export const SelectedNodesProvider = SelectedNodesContext.Provider;
export const useSelectedNodeIds = () => useContext(SelectedNodesContext);
export const useCanvasContext = () => useContext(CanvasContext);

// Nodos desactualizados (id → aviso): un Personaje o Escena vinculada que les
// entregó algo cambió desde que se generaron (lib/input-stamps.ts). Contexto
// aparte: su valor solo cambia cuando cambia el conjunto de avisos.
const StaleNodesContext = createContext<Readonly<Record<string, string>>>({});
export const StaleNodesProvider = StaleNodesContext.Provider;
export const useStaleMessage = (nodeId: string): string | undefined => useContext(StaleNodesContext)[nodeId];
