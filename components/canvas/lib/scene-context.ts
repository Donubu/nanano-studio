// Contexto de guion para lo que genera una Escena: información general,
// escenas anteriores de la cadena, estilo (Params Escena) y reglas del Guión.
// Puro: lo usa la ejecución (escena local o vinculada) y el servidor (vista de
// una escena vinculada). Se separa la RECOLECCIÓN (recorre el canvas) del
// ARMADO del texto, así la vista vinculada guarda los ingredientes y el texto
// final (con las reglas obligatorias vigentes) se arma siempre aquí.

import type { Node } from "@xyflow/react";
import {
  HANDLE_IDS,
  baseHandleId,
  type CanvasEdge,
  type LinkedNodeData,
  type ParamsSceneNodeData,
  type SceneContextInputs,
  type SceneNodeData,
} from "./canvas-types";
import { getDirectInputs } from "./topological-sort";
import { lookupFrom, nodeTextOutput, scriptGalleryImages, type OutEdge } from "./node-outputs";

type NodeLike = Pick<Node, "id" | "type" | "data">;
type EdgeLike = OutEdge;

export type { SceneContextInputs };

/** Texto conectado como reglas (estático con sus piezas, IA, vinculado…). */
function rulesTextOf(edge: EdgeLike, nodes: NodeLike[], edges: EdgeLike[]): string | null {
  const lookup = lookupFrom(nodes as never);
  const raw = nodeTextOutput(lookup(edge.source), lookup, edges, edge);
  return raw.trim() ? raw.trim() : null;
}

/** Ingredientes del contexto de una escena, recorriendo su canvas. */
export function collectSceneContext(sceneId: string, nodes: NodeLike[], edges: EdgeLike[]): SceneContextInputs | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sceneNode = byId.get(sceneId);
  if (!sceneNode || sceneNode.type !== "scene") return null;
  const sceneData = sceneNode.data as unknown as SceneNodeData;

  // Sube por la cadena para juntar las escenas anteriores (la más antigua
  // primero) y encontrar el Guión de origen (para sus reglas).
  const previousScenes: { sceneIndex: number; text: string }[] = [];
  let scriptNodeIdFound: string | null = null;
  let cursor = sceneNode.id;
  const visited = new Set<string>([cursor]);
  while (true) {
    const upChain = edges.find(
      (e) => e.target === cursor && baseHandleId(e.targetHandle) === HANDLE_IDS.INPUT_SCRIPT_CHAIN,
    );
    if (!upChain) break;
    if (visited.has(upChain.source)) break;
    visited.add(upChain.source);
    const prev = byId.get(upChain.source);
    if (!prev) break;
    if (prev.type === "scene") {
      const pd = prev.data as unknown as SceneNodeData;
      previousScenes.unshift({ sceneIndex: pd.sceneIndex, text: pd.text });
      cursor = prev.id;
      continue;
    }
    if (prev.type === "script") scriptNodeIdFound = prev.id;
    break;
  }
  // Si la cadena está cortada, la escena guarda de qué Guión viene.
  if (!scriptNodeIdFound && sceneData.scriptNodeId) scriptNodeIdFound = sceneData.scriptNodeId;

  let rulesText: string | null = null;
  if (scriptNodeIdFound) {
    const rulesEdge = edges.find(
      (e) => e.target === scriptNodeIdFound && baseHandleId(e.targetHandle) === HANDLE_IDS.INPUT_RULES,
    );
    if (rulesEdge) rulesText = rulesTextOf(rulesEdge, nodes, edges);
  }
  const scriptImageUrls = scriptNodeIdFound ? scriptGalleryImages(scriptNodeIdFound, lookupFrom(nodes as never), edges) : [];

  let sceneParamsContent: string | null = null;
  const paramsEdge = edges.find(
    (e) => e.target === sceneNode.id && baseHandleId(e.targetHandle) === HANDLE_IDS.INPUT_SCENE_PARAMS,
  );
  if (paramsEdge) {
    const paramsNode = byId.get(paramsEdge.source);
    if (paramsNode && paramsNode.type === "params-scene") {
      const c = (paramsNode.data as unknown as ParamsSceneNodeData).content?.trim();
      if (c) sceneParamsContent = c;
    }
  }

  return {
    sceneIndex: sceneData.sceneIndex,
    totalScenes: sceneData.totalScenes,
    ...(sceneData.variant ? { variant: sceneData.variant } : {}),
    generalInfo: sceneData.generalInfo,
    previousScenes,
    sceneParamsContent,
    rulesText,
    ...(scriptImageUrls.length > 0 ? { scriptImageUrls } : {}),
  };
}

/**
 * Contexto que recibe el modelo destino como instrucción de sistema:
 *   - información general del guion
 *   - texto íntegro de las escenas anteriores
 *   - Params Escena (estilo/visual/técnica) de la escena
 *   - reglas del usuario y las reglas obligatorias (sin texto en pantalla)
 *   - la tarea
 * El texto de la escena y el prompt propio del nodo van en el prompt
 * principal. null si no hay nada útil además de las reglas obligatorias.
 */
export function composeScriptContext(ctx: SceneContextInputs): string | null {
  const parts: string[] = [];
  const generalInfo = ctx.generalInfo;
  if (generalInfo) {
    const lines: string[] = ["[Información general del guion]"];
    if (generalInfo.synopsis) lines.push(`Sinopsis: ${generalInfo.synopsis}`);
    if (generalInfo.tone) lines.push(`Tono: ${generalInfo.tone}`);
    if (generalInfo.genre) lines.push(`Género: ${generalInfo.genre}`);
    if (generalInfo.visualStyle) lines.push(`Estilo visual: ${generalInfo.visualStyle}`);
    if (generalInfo.characters?.length) {
      lines.push("Personajes:");
      for (const c of generalInfo.characters) lines.push(`- ${c.name}: ${c.description}`);
    }
    if (generalInfo.settings?.length) {
      lines.push("Locaciones:");
      for (const s of generalInfo.settings) lines.push(`- ${s.name}: ${s.description}`);
    }
    parts.push(lines.join("\n"));
  }

  if (ctx.previousScenes.length > 0) {
    const lines: string[] = ["[Escenas anteriores (texto íntegro)]"];
    for (const s of ctx.previousScenes) {
      lines.push(`--- Escena ${s.sceneIndex} ---`);
      lines.push(s.text);
    }
    parts.push(lines.join("\n"));
  }

  if (ctx.sceneParamsContent) {
    parts.push(`[Estilo / Visual / Técnica]\n${ctx.sceneParamsContent}`);
  }

  if (ctx.rulesText) {
    parts.push(
      `[Reglas adicionales del usuario]\nRespeta estrictamente las siguientes indicaciones para todas las escenas. Tienen prioridad sobre interpretaciones libres del prompt:\n${ctx.rulesText}`,
    );
  }

  // Reglas fijas para la generación visual.
  parts.push(
    `[Reglas obligatorias para la imagen/video generado]
- REGLA DE ORO: NUNCA generes subtítulos, captions, leyendas, texto narrativo ni cartelas dentro de la imagen o frame del video. La salida es visualmente pura, sin texto sobre-impreso.
- El prompt principal puede contener etiquetas tipo ACCIÓN, VO, DIÁLOGO, S.I, ESCENA. NO interpretes ningún texto que NO esté marcado como "Texto sobre-impreso" o "S.I" como algo a renderizar visualmente.
- VO y DIÁLOGO son narración hablada FUERA de la imagen. JAMÁS los pongas como texto en pantalla.
- Sólo es permitido renderizar exactamente UN bloque de texto sobre-impreso, y SÓLO si el prompt lo declara explícitamente con "S.I:", "SUPER:" o "Texto sobre-impreso". Una línea, contenido literal, sin agregados.
- Si el prompt no menciona ningún S.I, la imagen va SIN ningún texto en pantalla. Cero. Ni firmas, ni marcas de agua, ni decoración tipográfica.
- Si por límite del modelo no puedes evitar texto, prefiere imagen sin texto a imagen con texto inventado.`,
  );

  if (parts.length === 1) return null;

  parts.push(
    `[Tu tarea]\nVas a generar contenido para la Escena ${ctx.sceneIndex}${ctx.variant ?? ""} de ${ctx.totalScenes}${
      ctx.variant === "B" ? ` (versión B: una alternativa de la escena ${ctx.sceneIndex}, no su continuación)` : ""
    }. El prompt que recibes es el texto literal de esa escena (más el prompt local del nodo si lo hay). Aplica la información general, las escenas anteriores y las directrices de estilo como contexto — no las repitas en la salida. Respeta SIEMPRE las reglas obligatorias de arriba.`,
  );

  return parts.join("\n\n");
}

/**
 * Contexto de guion para un nodo cuyo prompt viene de una Escena (local o
 * vinculada desde otro canvas). null si el prompt no viene de una escena.
 */
export function resolveScriptContext(nodeId: string, nodes: NodeLike[], edges: CanvasEdge[]): string | null {
  const promptInput = getDirectInputs(nodeId, edges).find((i) => i.targetHandle === HANDLE_IDS.INPUT_PROMPT);
  if (!promptInput) return null;
  const source = nodes.find((n) => n.id === promptInput.sourceNodeId);
  if (!source) return null;
  if (source.type === "scene") {
    const ctx = collectSceneContext(source.id, nodes, edges);
    return ctx ? composeScriptContext(ctx) : null;
  }
  if (source.type === "linked") {
    const snap = (source.data as unknown as LinkedNodeData).linkSnapshot;
    return snap?.kind === "scene" ? composeScriptContext(snap.context) : null;
  }
  return null;
}

/**
 * Imágenes de la entrada "Galería" del Guión para un nodo cuyo prompt viene
 * de una Escena (local o vinculada). Vacío si no viene de una escena.
 */
export function sceneReferenceImages(nodeId: string, nodes: NodeLike[], edges: CanvasEdge[]): string[] {
  const promptInput = getDirectInputs(nodeId, edges).find((i) => i.targetHandle === HANDLE_IDS.INPUT_PROMPT);
  if (!promptInput) return [];
  const source = nodes.find((n) => n.id === promptInput.sourceNodeId);
  if (!source) return [];
  if (source.type === "scene") return collectSceneContext(source.id, nodes, edges)?.scriptImageUrls ?? [];
  if (source.type === "linked") {
    const snap = (source.data as unknown as LinkedNodeData).linkSnapshot;
    return snap?.kind === "scene" ? snap.context.scriptImageUrls ?? [] : [];
  }
  return [];
}
