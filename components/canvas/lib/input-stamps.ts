// Generaciones desactualizadas: al ejecutar un nodo se guarda una huella de
// lo que le entregó cada Personaje (local o vinculado) o Escena vinculada
// (`data.inputStamps`, id de conexión → huella). Si después cambia lo que esa
// conexión entrega (ADN, estilo, texto o fotos de la etapa, la imagen de la
// etapa, el texto de la escena…), el nodo queda "desactualizado".
//
// La huella mira el CONTENIDO que llega por la conexión, no el nodo entero:
// cambiar la etapa 3 de Mike no desactualiza lo que se generó con la etapa 1.
// Se calcula sobre las conexiones originales (no las reescritas para ejecutar).
// Puro: sin React ni fetch.

import {
  HANDLE_IDS,
  baseHandleId,
  type CharacterNodeData,
  type LinkedNodeData,
} from "./canvas-types";
import { findStageForImage, stageForImageOutput, stageReferenceUrls } from "./character";
import { linkedStageForEdge } from "./linked";
import { galleryOutput, nodeTextOutput, type NodeLookup, type OutEdge, type OutNode } from "./node-outputs";

export type InputStamps = Record<string, string>;

/** Huella corta (FNV-1a de 32 bits, hex). Basta para detectar cambios. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Contenido que entrega una conexión que sale de un Personaje (local o
 * vinculado) o de una Escena vinculada, serializado. null si la conexión no
 * sale de uno de ellos (esas no se vigilan).
 */
export function characterDelivery(edge: OutEdge, lookup: NodeLookup, edges: OutEdge[]): string | null {
  const src = lookup(edge.source);
  if (!src) return null;
  const handle = baseHandleId(edge.sourceHandle);

  if (src.type === "character") {
    const d = src.data as unknown as CharacterNodeData;
    if (handle === HANDLE_IDS.OUTPUT_CHARACTER_IMAGE) {
      const stage = stageForImageOutput(d, edge.id);
      const img = stage?.imageNodeId ? lookup(stage.imageNodeId) : undefined;
      const url = img && typeof img.data.outputUrl === "string" ? img.data.outputUrl : null;
      return JSON.stringify({ image: url });
    }
    if (handle === HANDLE_IDS.OUTPUT_CHARACTER) {
      const into = edges.filter((e) => e.target === src.id);
      const styleEdge = into.find((e) => baseHandleId(e.targetHandle) === HANDLE_IDS.INPUT_CHARACTER_STYLE);
      const style = styleEdge ? nodeTextOutput(lookup(styleEdge.source), lookup, edges, styleEdge) : "";
      const galleries = into
        .filter((e) => baseHandleId(e.targetHandle) === HANDLE_IDS.INPUT_CHARACTER_GALLERY)
        .map((e) => lookup(e.source))
        .filter((n): n is OutNode => !!n);
      const stage = findStageForImage(d, edge.target);
      const photos = stage ? stageReferenceUrls(stage, galleries, (g) => galleryOutput(g, lookup, edges)) : [];
      return JSON.stringify({
        dna: d.dna ?? "",
        style,
        stage: stage ? { name: stage.name ?? "", text: stage.text ?? "" } : null,
        photos,
      });
    }
    return null;
  }

  if (src.type === "linked") {
    const d = src.data as unknown as LinkedNodeData;
    const snap = d.linkSnapshot;
    if (!snap) return null;
    if (snap.kind === "scene") {
      return handle === HANDLE_IDS.OUTPUT_TEXT ? JSON.stringify({ text: snap.text, context: snap.context }) : null;
    }
    const stage = linkedStageForEdge(d, edge.id);
    switch (handle) {
      case HANDLE_IDS.OUTPUT_CHARACTER_IMAGE:
        return JSON.stringify({ image: stage?.imageUrl ?? null });
      case HANDLE_IDS.OUTPUT_CHARACTER:
        return JSON.stringify({
          dna: snap.dna,
          style: snap.style,
          stage: stage ? { name: stage.name, text: stage.text } : null,
          photos: stage?.photoUrls ?? [],
        });
      case HANDLE_IDS.OUTPUT_CHARACTER_DNA:
        return JSON.stringify({ dna: snap.dna });
      case HANDLE_IDS.OUTPUT_CHARACTER_STYLE:
        return JSON.stringify({ style: snap.style });
      default:
        return null;
    }
  }
  return null;
}

/** Huellas de lo que los Personajes / Escenas vinculadas entregan hoy a un nodo. */
export function computeInputStamps(nodeId: string, lookup: NodeLookup, edges: OutEdge[]): InputStamps {
  const stamps: InputStamps = {};
  for (const e of edges) {
    if (e.target !== nodeId) continue;
    const delivered = characterDelivery(e, lookup, edges);
    if (delivered !== null) stamps[e.id] = fingerprint(delivered);
  }
  return stamps;
}

export interface StaleInput {
  edgeId: string;
  /** Nombre del Personaje o Escena de origen. */
  source: string;
  /** Etapa de la conexión, si eligió una. */
  stage?: string;
}

function sourceName(src: OutNode, edge: OutEdge): { source: string; stage?: string } {
  if (src.type === "linked") {
    const d = src.data as unknown as LinkedNodeData;
    const stage = linkedStageForEdge(d, edge.id);
    return { source: d.linkSnapshot?.label || String(d.label || "Vinculado"), stage: stage?.name || undefined };
  }
  const d = src.data as unknown as CharacterNodeData;
  const stage = baseHandleId(edge.sourceHandle) === HANDLE_IDS.OUTPUT_CHARACTER_IMAGE
    ? stageForImageOutput(d, edge.id)
    : findStageForImage(d, edge.target);
  return { source: (typeof d.label === "string" && d.label.trim()) || "Personaje", stage: stage?.name || undefined };
}

/**
 * Conexiones cuyo contenido cambió desde que se generó el nodo. Solo mira
 * conexiones que existían al generar (las nuevas o quitadas no cuentan) y
 * nodos con un resultado.
 */
export function staleInputs(node: OutNode, lookup: NodeLookup, edges: OutEdge[]): StaleInput[] {
  const stamps = node.data.inputStamps as InputStamps | undefined;
  if (!stamps || typeof stamps !== "object" || node.data.status !== "completed") return [];
  const out: StaleInput[] = [];
  for (const [edgeId, stamp] of Object.entries(stamps)) {
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge || edge.target !== node.id) continue;
    const delivered = characterDelivery(edge, lookup, edges);
    if (delivered === null || fingerprint(delivered) === stamp) continue;
    const src = lookup(edge.source);
    out.push({ edgeId, ...(src ? sourceName(src, edge) : { source: "Personaje" }) });
  }
  return out;
}

/** Texto para el aviso: "Mike (Adulto), Vicky cambió/cambiaron". */
export function describeStale(items: StaleInput[]): string {
  const names = [...new Set(items.map((i) => (i.stage ? `${i.source} (${i.stage})` : i.source)))];
  return `${names.join(", ")} ${names.length === 1 ? "cambió" : "cambiaron"} desde que se generó`;
}
