"use client";

import { useHandleConnections, useReactFlow } from "@xyflow/react";
import { HANDLE_IDS, type SceneNodeData } from "../lib/canvas-types";

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

  if (promptConnections.length === 0) return null;

  const sourceNode = getNode(promptConnections[0].source);
  if (!sourceNode) return "Prompt desde nodo conectado";

  switch (sourceNode.type) {
    case "scene": {
      const data = sourceNode.data as unknown as SceneNodeData;
      return `Escena ${data.sceneIndex} conectada como prompt`;
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
