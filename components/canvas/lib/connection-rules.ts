import type { Connection, Node } from "@xyflow/react";
import type { CanvasNode, CanvasNodeData, CanvasEdge } from "./canvas-types";
import { HANDLE_IDS, baseHandleId } from "./canvas-types";

interface ConnectionRule {
  sourceType: string;
  sourceHandle: string;
  targetType: string;
  targetHandle: string;
}

const VALID_CONNECTIONS: ConnectionRule[] = [
  // === AI Text output connections ===
  { sourceType: "text", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "image", targetHandle: HANDLE_IDS.INPUT_PROMPT },
  { sourceType: "text", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "video", targetHandle: HANDLE_IDS.INPUT_PROMPT },
  { sourceType: "text", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "text", targetHandle: HANDLE_IDS.INPUT_PROMPT },
  { sourceType: "text", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "text-practicante", targetHandle: HANDLE_IDS.INPUT_PROMPT },

  // === Text Practicante output connections (mirrors AI Text) ===
  { sourceType: "text-practicante", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "image", targetHandle: HANDLE_IDS.INPUT_PROMPT },
  { sourceType: "text-practicante", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "video", targetHandle: HANDLE_IDS.INPUT_PROMPT },
  { sourceType: "text-practicante", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "text", targetHandle: HANDLE_IDS.INPUT_PROMPT },
  { sourceType: "text-practicante", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "text-practicante", targetHandle: HANDLE_IDS.INPUT_PROMPT },

  // === AI Image output connections ===
  { sourceType: "image", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "text", targetHandle: HANDLE_IDS.INPUT_MEDIA },
  { sourceType: "image", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "text-practicante", targetHandle: HANDLE_IDS.INPUT_MEDIA },
  { sourceType: "image", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "video", targetHandle: HANDLE_IDS.INPUT_FIRST_FRAME },
  { sourceType: "image", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "video", targetHandle: HANDLE_IDS.INPUT_LAST_FRAME },
  { sourceType: "image", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "video", targetHandle: HANDLE_IDS.INPUT_REFERENCE },
  { sourceType: "image", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "image", targetHandle: HANDLE_IDS.INPUT_REFERENCE },

  // === Static Text → same targets as AI Text ===
  { sourceType: "static-text", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "image", targetHandle: HANDLE_IDS.INPUT_PROMPT },
  { sourceType: "static-text", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "video", targetHandle: HANDLE_IDS.INPUT_PROMPT },
  { sourceType: "static-text", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "text", targetHandle: HANDLE_IDS.INPUT_PROMPT },
  { sourceType: "static-text", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "text-practicante", targetHandle: HANDLE_IDS.INPUT_PROMPT },

  // === Static Image → same targets as AI Image ===
  { sourceType: "static-image", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "text", targetHandle: HANDLE_IDS.INPUT_MEDIA },
  { sourceType: "static-image", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "text-practicante", targetHandle: HANDLE_IDS.INPUT_MEDIA },
  { sourceType: "static-image", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "video", targetHandle: HANDLE_IDS.INPUT_FIRST_FRAME },
  { sourceType: "static-image", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "video", targetHandle: HANDLE_IDS.INPUT_LAST_FRAME },
  { sourceType: "static-image", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "video", targetHandle: HANDLE_IDS.INPUT_REFERENCE },
  { sourceType: "static-image", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "image", targetHandle: HANDLE_IDS.INPUT_REFERENCE },

  // === AI Video output connections ===
  { sourceType: "video", sourceHandle: HANDLE_IDS.OUTPUT_VIDEO, targetType: "text", targetHandle: HANDLE_IDS.INPUT_MEDIA },
  { sourceType: "video", sourceHandle: HANDLE_IDS.OUTPUT_VIDEO, targetType: "text-practicante", targetHandle: HANDLE_IDS.INPUT_MEDIA },

  // === Static Image Group → same targets as AI Image ===
  { sourceType: "static-image-group", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "text", targetHandle: HANDLE_IDS.INPUT_MEDIA },
  { sourceType: "static-image-group", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "text-practicante", targetHandle: HANDLE_IDS.INPUT_MEDIA },
  { sourceType: "static-image-group", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "video", targetHandle: HANDLE_IDS.INPUT_FIRST_FRAME },
  { sourceType: "static-image-group", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "video", targetHandle: HANDLE_IDS.INPUT_LAST_FRAME },
  { sourceType: "static-image-group", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "video", targetHandle: HANDLE_IDS.INPUT_REFERENCE },
  { sourceType: "static-image-group", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "image", targetHandle: HANDLE_IDS.INPUT_REFERENCE },

  // === Params → AI nodes (1 params per AI node) ===
  { sourceType: "params-text", sourceHandle: HANDLE_IDS.OUTPUT_PARAMS, targetType: "text", targetHandle: HANDLE_IDS.INPUT_PARAMS },
  { sourceType: "params-image", sourceHandle: HANDLE_IDS.OUTPUT_PARAMS, targetType: "image", targetHandle: HANDLE_IDS.INPUT_PARAMS },
  { sourceType: "params-video", sourceHandle: HANDLE_IDS.OUTPUT_PARAMS, targetType: "video", targetHandle: HANDLE_IDS.INPUT_PARAMS },

  // === Script → Scene chain ===
  { sourceType: "script", sourceHandle: HANDLE_IDS.OUTPUT_SCRIPT_CHAIN, targetType: "scene", targetHandle: HANDLE_IDS.INPUT_SCRIPT_CHAIN },
  { sourceType: "scene", sourceHandle: HANDLE_IDS.OUTPUT_SCRIPT_CHAIN, targetType: "scene", targetHandle: HANDLE_IDS.INPUT_SCRIPT_CHAIN },

  // === Scene → AI generation (as prompt) ===
  { sourceType: "scene", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "image", targetHandle: HANDLE_IDS.INPUT_PROMPT },
  { sourceType: "scene", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "video", targetHandle: HANDLE_IDS.INPUT_PROMPT },
  { sourceType: "scene", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "text", targetHandle: HANDLE_IDS.INPUT_PROMPT },
  { sourceType: "scene", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "text-practicante", targetHandle: HANDLE_IDS.INPUT_PROMPT },

  // === Params Escena → Scene (estilo/visual/técnica) ===
  { sourceType: "params-scene", sourceHandle: HANDLE_IDS.OUTPUT_PARAMS, targetType: "scene", targetHandle: HANDLE_IDS.INPUT_SCENE_PARAMS },

  // === Galería/Imagen estática → Script y Params Escena (referencia visual) ===
  // Used as visual context: feed into the first generated target downstream of
  // the Script, or as source for "Extract style" in Params Escena.
  { sourceType: "static-image-group", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "script", targetHandle: HANDLE_IDS.INPUT_VISUAL_REFERENCE },
  { sourceType: "static-image", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "script", targetHandle: HANDLE_IDS.INPUT_VISUAL_REFERENCE },
  { sourceType: "static-image-group", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "params-scene", targetHandle: HANDLE_IDS.INPUT_VISUAL_REFERENCE },
  { sourceType: "static-image", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, targetType: "params-scene", targetHandle: HANDLE_IDS.INPUT_VISUAL_REFERENCE },

  // === Params Escena → Script (referencia para reuso en materialize) ===
  // The user can connect their own Params Escena (with gallery, content, etc.)
  // to the Script. When present, materialize wires that node to all scenes
  // instead of creating a fresh determinístic params-scene.
  { sourceType: "params-scene", sourceHandle: HANDLE_IDS.OUTPUT_PARAMS, targetType: "script", targetHandle: HANDLE_IDS.INPUT_PARAMS_SCENE_REF },

  // === Texto → Script (reglas adicionales para todas las escenas) ===
  // Static text, AI text, or practicante can feed extra rules / golden rules
  // / things to keep/ignore that apply to every scene downstream.
  { sourceType: "static-text", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "script", targetHandle: HANDLE_IDS.INPUT_RULES },
  { sourceType: "text", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "script", targetHandle: HANDLE_IDS.INPUT_RULES },
  { sourceType: "text-practicante", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetType: "script", targetHandle: HANDLE_IDS.INPUT_RULES },
];

/**
 * Checks if a proposed connection is valid based on node types and handles.
 */
export function isValidConnection(
  connection: Connection,
  nodes: Node[],
  edges?: CanvasEdge[]
): boolean {
  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);

  if (!sourceNode || !targetNode) return false;
  if (connection.source === connection.target) return false;

  const sourceType = sourceNode.type;
  const targetType = targetNode.type;

  // Input handles exist twice (left + top twin). Normalize to the base id so
  // rules and uniqueness checks treat both as the same logical input.
  const sourceHandle = baseHandleId(connection.sourceHandle);
  const targetHandle = baseHandleId(connection.targetHandle);

  const isValid = VALID_CONNECTIONS.some(
    (rule) =>
      rule.sourceType === sourceType &&
      rule.sourceHandle === sourceHandle &&
      rule.targetType === targetType &&
      rule.targetHandle === targetHandle
  );
  if (!isValid) return false;

  // Helper: is there already an edge into this target's logical input? Compares
  // by base id so connecting to the top twin still counts as "already used".
  const targetAlreadyUsed = (handleId: string) =>
    !!edges && edges.some(
      (e) => e.target === connection.target && baseHandleId(e.targetHandle) === handleId
    );

  // Enforce: only 1 params node per AI node
  if (targetHandle === HANDLE_IDS.INPUT_PARAMS && targetAlreadyUsed(HANDLE_IDS.INPUT_PARAMS)) return false;

  // Enforce: only 1 params-scene per Scene
  if (targetHandle === HANDLE_IDS.INPUT_SCENE_PARAMS && targetAlreadyUsed(HANDLE_IDS.INPUT_SCENE_PARAMS)) return false;

  // Enforce: only 1 visual reference per Script or Params Escena
  if (targetHandle === HANDLE_IDS.INPUT_VISUAL_REFERENCE && targetAlreadyUsed(HANDLE_IDS.INPUT_VISUAL_REFERENCE)) return false;

  // Enforce: only 1 Params Escena reference per Script
  if (targetHandle === HANDLE_IDS.INPUT_PARAMS_SCENE_REF && targetAlreadyUsed(HANDLE_IDS.INPUT_PARAMS_SCENE_REF)) return false;

  // Enforce: only 1 rules input per Script
  if (targetHandle === HANDLE_IDS.INPUT_RULES && targetAlreadyUsed(HANDLE_IDS.INPUT_RULES)) return false;

  return true;
}

/**
 * Given a source node type and handle, return the compatible target node types
 * with their default target handle. Used for the "drop on empty" menu.
 */
export function getCompatibleTargetTypes(
  sourceType: string,
  sourceHandle: string
): { type: string; label: string; targetHandle: string }[] {
  const seen = new Set<string>();
  const results: { type: string; label: string; targetHandle: string }[] = [];
  const labels: Record<string, string> = { text: "Texto", "text-practicante": "Practicante", image: "Imagen", video: "Video", "static-text": "Texto", "static-image": "Imagen estática", "static-image-group": "Galería", "params-text": "Params Texto", "params-image": "Params Imagen", "params-video": "Params Video", "params-scene": "Params Escena", script: "Guión", scene: "Escena" };
  const baseSource = baseHandleId(sourceHandle);

  for (const rule of VALID_CONNECTIONS) {
    if (rule.sourceType === sourceType && rule.sourceHandle === baseSource) {
      if (!seen.has(rule.targetType)) {
        seen.add(rule.targetType);
        results.push({
          type: rule.targetType,
          label: labels[rule.targetType] || rule.targetType,
          targetHandle: rule.targetHandle,
        });
      }
    }
  }
  return results;
}

/**
 * Given a target node type and handle, return the compatible source node types
 * with their default source handle. Used when dragging from an input handle.
 */
export function getCompatibleSourceTypes(
  targetType: string,
  targetHandle: string
): { type: string; label: string; sourceHandle: string }[] {
  const seen = new Set<string>();
  const results: { type: string; label: string; sourceHandle: string }[] = [];
  const labels: Record<string, string> = { text: "Texto", "text-practicante": "Practicante", image: "Imagen", video: "Video", "static-text": "Texto", "static-image": "Imagen estática", "static-image-group": "Galería", "params-text": "Params Texto", "params-image": "Params Imagen", "params-video": "Params Video", "params-scene": "Params Escena", script: "Guión", scene: "Escena" };
  const baseTarget = baseHandleId(targetHandle);

  for (const rule of VALID_CONNECTIONS) {
    if (rule.targetType === targetType && rule.targetHandle === baseTarget) {
      if (!seen.has(rule.sourceType)) {
        seen.add(rule.sourceType);
        results.push({
          type: rule.sourceType,
          label: labels[rule.sourceType] || rule.sourceType,
          sourceHandle: rule.sourceHandle,
        });
      }
    }
  }
  return results;
}

/**
 * Detects if adding an edge would create a cycle in the graph (DFS).
 */
export function wouldCreateCycle(
  edges: CanvasEdge[],
  newSource: string,
  newTarget: string
): boolean {
  // Build adjacency list including the proposed new edge
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adj.get(edge.source) || [];
    list.push(edge.target);
    adj.set(edge.source, list);
  }
  // Add proposed edge
  const list = adj.get(newSource) || [];
  list.push(newTarget);
  adj.set(newSource, list);

  // DFS from newTarget to see if we can reach newSource
  const visited = new Set<string>();
  const stack = [newTarget];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === newSource) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const neighbors = adj.get(current) || [];
    for (const neighbor of neighbors) {
      stack.push(neighbor);
    }
  }

  return false;
}
