// Lo que ENTREGA un nodo a quien se conecta a él, considerando sus entradas:
//   - Texto estático: los textos conectados a su entrada TEXTOS (en el orden
//     de data.partOrder, luego por conexión) y al final su propio texto,
//     separados por una línea en blanco.
//   - Galería: sus fotos subidas + las imágenes conectadas a su entrada de
//     imágenes (imagen, imagen estática, otra galería, IMAGEN de una etapa de
//     un Personaje local o vinculado).
// Es el ÚNICO lugar que arma esas salidas: la ejecución, los paneles, el
// Personaje, el contexto de escenas y el servidor (vinculados) leen de aquí.
// Puro: sin React ni fetch. Tolera ciclos (una pieza ya visitada no aporta).

import {
  HANDLE_IDS,
  baseHandleId,
  type CharacterNodeData,
  type LinkedNodeData,
} from "./canvas-types";
import { galleryImagesOf, stageForImageOutput } from "./character";
import { linkedImageForEdge, linkedTextForHandle } from "./linked";

export type OutNode = { id: string; type?: string; data: Record<string, unknown> };
export type OutEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};
export type NodeLookup = (id: string) => OutNode | undefined;

export const TEXT_PARTS_SEPARATOR = "\n\n";

export function lookupFrom(nodes: OutNode[]): NodeLookup {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (id) => byId.get(id);
}

function incoming(nodeId: string, handle: string, edges: OutEdge[]): OutEdge[] {
  return edges.filter((e) => e.target === nodeId && baseHandleId(e.targetHandle) === handle);
}

/** Conexiones a la entrada TEXTOS de un texto estático, en el orden de las piezas. */
export function textPartEdges(node: OutNode, edges: OutEdge[]): OutEdge[] {
  const parts = incoming(node.id, HANDLE_IDS.INPUT_TEXT_PARTS, edges);
  const order = Array.isArray(node.data.partOrder) ? (node.data.partOrder as string[]) : [];
  const rank = (e: OutEdge) => {
    const i = order.indexOf(e.id);
    return i === -1 ? order.length + parts.indexOf(e) : i;
  };
  return [...parts].sort((a, b) => rank(a) - rank(b));
}

/** Texto que una conexión trae desde su origen ("" si todavía no hay). */
export function textFromEdge(edge: OutEdge, lookup: NodeLookup, edges: OutEdge[], visited: Set<string> = new Set()): string {
  const src = lookup(edge.source);
  if (!src) return "";
  const d = src.data;
  switch (src.type) {
    case "static-text":
      return staticTextOutput(src, lookup, edges, visited);
    case "text":
    case "text-practicante":
      return d.status === "completed" && typeof d.outputText === "string" ? d.outputText : "";
    case "scene":
      return typeof d.text === "string" ? d.text : "";
    case "linked":
      return linkedTextForHandle(d as unknown as LinkedNodeData, edge.sourceHandle, edge.id, false);
    default:
      return "";
  }
}

/**
 * Salida de un texto estático: piezas conectadas (en orden) + su propio
 * texto al final, separadas por una línea en blanco. Sin piezas es su texto.
 */
export function staticTextOutput(node: OutNode, lookup: NodeLookup, edges: OutEdge[], visited: Set<string> = new Set()): string {
  const own = typeof node.data.content === "string" ? node.data.content : "";
  if (visited.has(node.id)) return "";
  const seen = new Set(visited).add(node.id);
  const pieces = textPartEdges(node, edges).map((e) => textFromEdge(e, lookup, edges, seen));
  return [...pieces, own].filter((p) => p.trim().length > 0).join(TEXT_PARTS_SEPARATOR);
}

/** Texto que entrega un nodo de texto cualquiera por una conexión dada. */
export function nodeTextOutput(
  node: OutNode | undefined,
  lookup: NodeLookup,
  edges: OutEdge[],
  via?: Pick<OutEdge, "id" | "sourceHandle"> | null,
): string {
  if (!node) return "";
  const withSelf: NodeLookup = (id) => (id === node.id ? node : lookup(id));
  return textFromEdge({ id: via?.id ?? "", source: node.id, target: "", sourceHandle: via?.sourceHandle ?? null }, withSelf, edges);
}

/** Imágenes que una conexión trae desde su origen. */
export function imagesFromEdge(
  edge: OutEdge,
  lookup: NodeLookup,
  edges: OutEdge[],
  visited: Set<string> = new Set(),
): { url: string; caption?: string }[] {
  const src = lookup(edge.source);
  if (!src) return [];
  const handle = baseHandleId(edge.sourceHandle);
  if (src.type === "static-image-group") return galleryOutput(src, lookup, edges, visited);
  if (src.type === "character" && handle === HANDLE_IDS.OUTPUT_CHARACTER_IMAGE) {
    const stage = stageForImageOutput(src.data as unknown as CharacterNodeData, edge.id);
    const img = stage?.imageNodeId ? lookup(stage.imageNodeId) : undefined;
    const url = img && typeof img.data.outputUrl === "string" ? img.data.outputUrl : "";
    return url ? [{ url }] : [];
  }
  if (src.type === "linked" && handle === HANDLE_IDS.OUTPUT_CHARACTER_IMAGE) {
    const url = linkedImageForEdge(src.data as unknown as LinkedNodeData, edge.id);
    return url ? [{ url }] : [];
  }
  return galleryImagesOf(src);
}

/** Fotos de una galería: las subidas + las conectadas a su entrada (sin repetir). */
export function galleryOutput(
  node: OutNode,
  lookup: NodeLookup,
  edges: OutEdge[],
  visited: Set<string> = new Set(),
): { url: string; caption?: string }[] {
  const own = galleryImagesOf(node);
  if (visited.has(node.id)) return [];
  const seen = new Set(visited).add(node.id);
  const out = [...own];
  const known = new Set(own.map((i) => i.url));
  for (const e of incoming(node.id, HANDLE_IDS.INPUT_GALLERY_IMAGES, edges)) {
    for (const img of imagesFromEdge(e, lookup, edges, seen)) {
      if (known.has(img.url)) continue;
      known.add(img.url);
      out.push(img);
    }
  }
  return out;
}

/** Imágenes que entrega un nodo (galería con sus entradas; el resto, lo propio). */
export function nodeImages(node: OutNode, lookup: NodeLookup, edges: OutEdge[]): { url: string; caption?: string }[] {
  return node.type === "static-image-group" ? galleryOutput(node, lookup, edges) : galleryImagesOf(node);
}

/** Imágenes conectadas a la entrada "Galería" de un Guión (en orden, sin repetir). */
export function scriptGalleryImages(scriptId: string, lookup: NodeLookup, edges: OutEdge[]): string[] {
  const out: string[] = [];
  for (const e of incoming(scriptId, HANDLE_IDS.INPUT_GALLERY_IMAGES, edges)) {
    for (const img of imagesFromEdge(e, lookup, edges)) if (!out.includes(img.url)) out.push(img.url);
  }
  return out;
}
