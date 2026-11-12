// Nodos vinculados a otro canvas: armado de la vista resuelta de un Personaje
// (en el servidor, con los nodos de su canvas) y lectura de esa vista por
// conexión (en la ejecución y en la UI). Puro: sin React, fetch ni BD.

import {
  HANDLE_IDS,
  baseHandleId,
  type CharacterNodeData,
  type LinkedCharacterSnapshot,
  type LinkedCharacterStage,
  type LinkedNodeData,
} from "./canvas-types";
import { composeCharacterPrompt, stageReferenceUrls } from "./character";

type NodeLike = { id: string; type?: string; data: Record<string, unknown> };

/**
 * Texto que entrega un nodo de texto conectado (estático, IA o Practicante),
 * o un vinculado por su salida ADN / Estilo / texto de escena (`sourceHandle`).
 */
export function textOutputOf(node: Pick<NodeLike, "type" | "data"> | null | undefined, sourceHandle?: string | null): string {
  if (!node) return "";
  const d = node.data;
  if (node.type === "linked") return linkedTextForHandle(d as unknown as LinkedNodeData, sourceHandle, "", false);
  if (node.type === "static-text") return typeof d.content === "string" ? d.content : "";
  if ((node.type === "text" || node.type === "text-practicante") && d.status === "completed") {
    return typeof d.outputText === "string" ? d.outputText : "";
  }
  return "";
}

/**
 * Vista resuelta de un Personaje: lo que un canvas vinculado necesita sin
 * cargar el canvas de origen. `galleries` son los nodos conectados a su
 * entrada de galerías; `stageImages` los nodos imagen de sus etapas.
 */
export function buildCharacterSnapshot(params: {
  character: NodeLike;
  styleNode?: NodeLike | null;
  // Salida del nodo de estilo (importa si es un vinculado: ADN/Estilo).
  styleHandle?: string | null;
  galleries: NodeLike[];
  stageImages: NodeLike[];
}): LinkedCharacterSnapshot {
  const data = params.character.data as unknown as CharacterNodeData;
  const images = new Map(params.stageImages.map((n) => [n.id, n]));
  const stages: LinkedCharacterStage[] = (data.stages ?? []).map((st) => {
    const img = st.imageNodeId ? images.get(st.imageNodeId) : undefined;
    const url = img?.type === "image" && typeof img.data.outputUrl === "string" ? img.data.outputUrl : "";
    return {
      id: st.id,
      name: st.name ?? "",
      text: st.text ?? "",
      photoUrls: stageReferenceUrls(st, params.galleries),
      imageUrl: url || null,
    };
  });
  return {
    kind: "character",
    label: (typeof data.label === "string" && data.label.trim()) || "Personaje",
    dna: data.dna ?? "",
    style: textOutputOf(params.styleNode, params.styleHandle),
    stages,
  };
}

/** Etapa elegida en una conexión que sale de un nodo vinculado. */
export function linkedStageForEdge(data: LinkedNodeData, edgeId: string): LinkedCharacterStage | null {
  const stageId = data.imageOutputs?.[edgeId];
  if (!stageId || data.linkSnapshot?.kind !== "character") return null;
  return data.linkSnapshot.stages.find((s) => s.id === stageId) ?? null;
}

/** Imagen que entrega la salida IMAGEN de un Personaje vinculado por esa conexión. */
export function linkedImageForEdge(data: LinkedNodeData, edgeId: string): string | null {
  return linkedStageForEdge(data, edgeId)?.imageUrl ?? null;
}

/**
 * Prompt que entrega la salida PROMPT de un Personaje vinculado: ADN + estilo
 * + la etapa elegida en la conexión (solo ADN + estilo si no se eligió).
 */
export function linkedPromptForEdge(data: LinkedNodeData, edgeId: string, hasReferences: boolean): string {
  const snap = data.linkSnapshot;
  if (snap?.kind !== "character") return "";
  const stage = linkedStageForEdge(data, edgeId);
  return composeCharacterPrompt({
    dna: snap.dna,
    style: snap.style,
    stage: stage ? { id: stage.id, name: stage.name, text: stage.text } : null,
    hasReferences,
  });
}

/**
 * Texto que entrega un nodo vinculado por una de sus salidas:
 * Personaje → PROMPT (ADN + estilo + etapa de la conexión), ADN o Estilo;
 * Escena → su texto.
 */
export function linkedTextForHandle(
  data: LinkedNodeData,
  sourceHandle: string | null | undefined,
  edgeId: string,
  hasReferences: boolean,
): string {
  const snap = data.linkSnapshot;
  if (!snap) return "";
  const handle = baseHandleId(sourceHandle);
  if (snap.kind === "scene") return handle === HANDLE_IDS.OUTPUT_TEXT ? snap.text : "";
  if (handle === HANDLE_IDS.OUTPUT_CHARACTER) return linkedPromptForEdge(data, edgeId, hasReferences);
  if (handle === HANDLE_IDS.OUTPUT_CHARACTER_DNA) return snap.dna;
  if (handle === HANDLE_IDS.OUTPUT_CHARACTER_STYLE) return snap.style;
  return "";
}
