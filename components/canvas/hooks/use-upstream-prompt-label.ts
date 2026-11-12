"use client";

import { useHandleConnections, useNodeId, useReactFlow } from "@xyflow/react";
import { HANDLE_IDS, type CharacterNodeData, type LinkedNodeData, type SceneNodeData } from "../lib/canvas-types";
import { findStageForImage } from "../lib/character";

/**
 * For AI nodes (text, image, video, practicante) that accept a prompt input:
 * returns a placeholder describing the upstream connection so the body of the
 * node can show something more useful than "Sin prompt configurado" when the
 * prompt is going to come from a connected node.
 *
 * Returns null when there's no upstream connection on INPUT_PROMPT.
 */
export function useUpstreamPromptLabel(): string | null {
  const promptConnections = useHandleConnections({
    type: "target",
    id: HANDLE_IDS.INPUT_PROMPT,
  });
  const { getNode } = useReactFlow();
  const selfId = useNodeId();

  if (promptConnections.length === 0) return null;

  const sourceNode = getNode(promptConnections[0].source);
  if (!sourceNode) return "Prompt desde nodo conectado";

  switch (sourceNode.type) {
    case "scene": {
      const data = sourceNode.data as unknown as SceneNodeData;
      return `Escena ${data.sceneIndex} conectada como prompt`;
    }
    case "character": {
      const data = sourceNode.data as unknown as CharacterNodeData;
      const stage = selfId ? findStageForImage(data, selfId) : null;
      return stage
        ? `${data.label || "Personaje"} · etapa "${stage.name}"`
        : `ADN y estilo de ${data.label || "Personaje"}`;
    }
    case "linked": {
      const d = sourceNode.data as unknown as LinkedNodeData;
      const snap = d.linkSnapshot;
      if (snap?.kind === "scene") return `Escena ${snap.context.sceneIndex} vinculada de "${d.sourceCanvasTitle ?? "otro canvas"}"`;
      return `${snap?.label || d.label || "Personaje"} (vinculado) conectado como prompt`;
    }
    case "text":
      return "Prompt generado por nodo Texto";
    case "text-practicante":
      return "Prompt generado por Practicante";
    case "static-text":
      return "Prompt desde texto estático";
    default:
      return "Prompt desde nodo conectado";
  }
}
