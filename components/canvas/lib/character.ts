// Nodo Personaje: armado del prompt de cada etapa y plan de "Generar etapas".
// Puro (sin React ni fetch) para usarlo en la ejecución, el workspace y tests.

import type { Node, Edge } from "@xyflow/react";
import {
  HANDLE_IDS,
  baseHandleId,
  getDefaultNodeData,
  type CharacterNodeData,
  type CharacterStage,
} from "./canvas-types";
import { wouldCreateCycle } from "./connection-rules";

// Tipos de nodo que se pueden conectar como galería de referencias.
export const REFERENCE_SOURCE_TYPES = new Set(["image", "static-image", "static-image-group"]);

// Prioridad con que llegan las fotos elegidas de la etapa (1 = la que manda).
// La continuidad (imagen de la etapa siguiente) va neutra: queda después.
export const OWN_REFERENCE_PRIORITY = 1;

/** Fotos que aporta un nodo conectado como galería, en orden. */
export function galleryImagesOf(node: { type?: string; data: Record<string, unknown> }): { url: string; caption?: string }[] {
  const d = node.data;
  if (node.type === "static-image-group") {
    return ((d.images as { url?: string; caption?: string }[] | undefined) ?? [])
      .filter((i): i is { url: string; caption?: string } => typeof i?.url === "string" && i.url.length > 0);
  }
  if (node.type === "static-image" && typeof d.imageUrl === "string" && d.imageUrl) {
    return [{ url: d.imageUrl, caption: typeof d.caption === "string" ? d.caption : undefined }];
  }
  if (node.type === "image" && typeof d.outputUrl === "string" && d.outputUrl) return [{ url: d.outputUrl }];
  return [];
}

/**
 * URLs elegidas para una etapa que siguen disponibles: la galería sigue
 * conectada al Personaje y todavía contiene la foto.
 */
export function stageReferenceUrls(
  stage: CharacterStage | null | undefined,
  galleries: { id: string; type?: string; data: Record<string, unknown> }[],
): string[] {
  if (!stage?.referenceImages?.length) return [];
  const available = new Map(galleries.map((g) => [g.id, new Set(galleryImagesOf(g).map((i) => i.url))]));
  const out: string[] = [];
  for (const ref of stage.referenceImages) {
    if (available.get(ref.nodeId)?.has(ref.url) && !out.includes(ref.url)) out.push(ref.url);
  }
  return out;
}

const IMAGE_GAP_X = 160;
const IMAGE_SLOT_Y = 420;
const DEFAULT_CHARACTER_W = 360;

export function newStageId(): string {
  return `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Etapa que alimenta a una imagen dada (por el id guardado en la etapa). */
export function findStageForImage(data: CharacterNodeData, imageNodeId: string): CharacterStage | null {
  return (data.stages ?? []).find((s) => s.imageNodeId === imageNodeId) ?? null;
}

/**
 * Prompt que el Personaje entrega a la imagen de una etapa: ADN + estilo
 * global + la etapa. Se arma al ejecutar (vínculo vivo): editar el texto de
 * una etapa cambia lo que recibe su imagen sin regenerar nodos.
 */
export function composeCharacterPrompt(params: {
  dna?: string | null;
  style?: string | null;
  stage?: CharacterStage | null;
  hasReferences?: boolean;
}): string {
  const parts: string[] = [];
  const dna = params.dna?.trim();
  const style = params.style?.trim();
  if (dna) parts.push(`ADN del personaje (rasgos que se mantienen en todas las etapas):\n${dna}`);
  if (style) parts.push(`Estilo global:\n${style}`);
  const stage = params.stage;
  if (stage && (stage.name.trim() || stage.text.trim())) {
    parts.push(`Etapa: ${stage.name.trim() || "sin nombre"}\n${stage.text.trim()}`.trim());
  }
  if (params.hasReferences) {
    parts.push(
      "Mantén la identidad del personaje de las imágenes de referencia (rasgos faciales, proporciones, marcas distintivas); cambia solo lo que corresponde a esta etapa.",
    );
  }
  return parts.join("\n\n");
}

/**
 * Remapea los ids que guarda el Personaje (imagen y fotos de cada etapa,
 * registros de Generar) al copiar/pegar o insertar una plantilla. Las imágenes
 * de etapa que no vienen en la copia se descartan para que "Generar etapas"
 * cree las suyas en vez de apuntar a las del original; las fotos de galerías
 * externas se conservan al pegar (siguen siendo válidas en el mismo canvas).
 */
export function remapCharacterIds(
  data: Record<string, unknown>,
  idMap: Map<string, string>,
  edgeIdMap?: Map<string, string>,
  opts: { keepExternalRefs?: boolean } = { keepExternalRefs: true },
): Partial<CharacterNodeData> {
  const stages = Array.isArray(data.stages) ? (data.stages as CharacterStage[]) : [];
  return {
    stages: stages.map((s) => ({
      ...s,
      imageNodeId: s.imageNodeId && idMap.has(s.imageNodeId) ? idMap.get(s.imageNodeId) : undefined,
      referenceImages: (s.referenceImages ?? []).flatMap((r) => {
        const nodeId = idMap.get(r.nodeId) ?? (opts.keepExternalRefs ? r.nodeId : undefined);
        return nodeId ? [{ nodeId, url: r.url }] : [];
      }),
    })),
    generatedImageIds: ((data.generatedImageIds as string[] | undefined) ?? []).filter((id) => idMap.has(id)).map((id) => idMap.get(id)!),
    managedEdgeIds: ((data.managedEdgeIds as string[] | undefined) ?? []).filter((id) => edgeIdMap?.has(id)).map((id) => edgeIdMap!.get(id)!),
  };
}

export interface CharacterMaterializePlan {
  addNodes: Node[];
  removeNodeIds: string[];
  addEdges: Edge[];
  // Conexiones existentes a las que solo les cambia la prioridad.
  updateEdges: Edge[];
  removeEdgeIds: string[];
  // Nueva data del Personaje (etapas con su imagen + registros).
  characterData: CharacterNodeData;
  warnings: string[];
}

interface DesiredEdge {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  priority: number | null;
}

/**
 * Plan para "Generar etapas": una imagen por etapa (reusa la que ya tenga),
 * conectada al Personaje (que al ejecutar le entrega texto y fotos de su
 * etapa) y a la imagen de la etapa anterior de la lista (continuidad: la 1 es
 * referencia de la 2, la 2 de la 3…). Reconcilia solo lo que puso
 * "Generar etapas" antes (ids en
 * managedEdgeIds / generatedImageIds); las conexiones del usuario no se tocan.
 * Las imágenes de etapas borradas se eliminan solo si nunca se generaron.
 */
export function planCharacterMaterialize(
  character: Node,
  nodes: Node[],
  edges: Edge[],
  opts: { idPrefix?: string } = {},
): CharacterMaterializePlan {
  const data = character.data as unknown as CharacterNodeData;
  const prefix = opts.idPrefix ?? `chr${Date.now().toString(36)}`;
  const warnings: string[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const stages = (data.stages ?? []).filter((s) => s.name.trim() || s.text.trim());
  const charLabel = (data.label || "Personaje").trim();

  // 1. Una imagen por etapa.
  const addNodes: Node[] = [];
  const stageImage = new Map<string, string>();
  const charW = (typeof character.width === "number" ? character.width : character.measured?.width) ?? DEFAULT_CHARACTER_W;
  const columnX = character.position.x + charW + IMAGE_GAP_X;
  // En el orden de la lista, de arriba hacia abajo: la primera se genera
  // primero y alimenta a la siguiente.
  stages.forEach((stage, slot) => {
    const existing = stage.imageNodeId ? byId.get(stage.imageNodeId) : undefined;
    if (existing && existing.type === "image") {
      stageImage.set(stage.id, existing.id);
      return;
    }
    const id = `node-${prefix}-${addNodes.length + 1}`;
    const base = getDefaultNodeData("image") as unknown as Record<string, unknown>;
    addNodes.push({
      id,
      type: "image",
      position: { x: columnX, y: character.position.y + slot * IMAGE_SLOT_Y },
      data: { ...base, label: `${charLabel} · ${stage.name.trim() || `Etapa ${slot + 1}`}`, aspectRatio: "3:4" },
    });
    stageImage.set(stage.id, id);
  });

  // 2. Conexiones deseadas. Las fotos de cada etapa no van como conexión
  // (una galería conectada a la imagen le mandaría TODAS sus fotos): las
  // entrega el Personaje al ejecutar, según la selección de la etapa.
  const desired: DesiredEdge[] = [];
  stages.forEach((stage, i) => {
    const img = stageImage.get(stage.id)!;
    desired.push({ source: character.id, sourceHandle: HANDLE_IDS.OUTPUT_CHARACTER, target: img, targetHandle: HANDLE_IDS.INPUT_PROMPT, priority: null });
    const previous = stages[i - 1];
    if (previous) {
      desired.push({
        source: stageImage.get(previous.id)!,
        sourceHandle: HANDLE_IDS.OUTPUT_IMAGE,
        target: img,
        targetHandle: HANDLE_IDS.INPUT_REFERENCE,
        priority: null,
      });
    }
  });

  // 3. Reconciliar con lo existente.
  const managed = new Set(data.managedEdgeIds ?? []);
  const sameEdge = (e: Edge, d: DesiredEdge) =>
    e.source === d.source && e.target === d.target && baseHandleId(e.targetHandle) === d.targetHandle;
  const edgePriority = (e: Edge) => {
    const p = (e.data as { priority?: unknown } | undefined)?.priority;
    return typeof p === "number" ? p : null;
  };

  const keptEdgeIds = new Set<string>();
  const addEdges: Edge[] = [];
  const updateEdges: Edge[] = [];
  const managedIds: string[] = [];
  let working: Edge[] = edges.filter((e) => !(managed.has(e.id) && !desired.some((d) => sameEdge(e, d))));
  let edgeSeq = 0;

  for (const d of desired) {
    const found = working.find((e) => sameEdge(e, d));
    if (found) {
      keptEdgeIds.add(found.id);
      if (managed.has(found.id)) managedIds.push(found.id);
      // Solo se ajusta la prioridad de conexiones que puso Generar (o si la
      // del usuario no tiene ninguna y la deseada sí).
      if (edgePriority(found) !== d.priority && (managed.has(found.id) || edgePriority(found) == null)) {
        const { priority: _p, ...rest } = (found.data ?? {}) as Record<string, unknown>;
        void _p;
        updateEdges.push({ ...found, data: d.priority != null ? { ...rest, priority: d.priority } : rest });
      }
      continue;
    }
    if (wouldCreateCycle(working, d.source, d.target)) {
      warnings.push(`Se omitió una conexión que formaba un ciclo (${d.source} → ${d.target}).`);
      continue;
    }
    edgeSeq += 1;
    const edge: Edge = {
      id: `e-${prefix}-${edgeSeq}`,
      source: d.source,
      sourceHandle: d.sourceHandle,
      target: d.target,
      targetHandle: d.targetHandle,
      animated: false,
      ...(d.priority != null ? { data: { priority: d.priority } } : {}),
    };
    addEdges.push(edge);
    working = [...working, edge];
    managedIds.push(edge.id);
  }

  const removeEdgeIds = edges
    .filter((e) => managed.has(e.id) && !keptEdgeIds.has(e.id))
    .map((e) => e.id);

  // 4. Imágenes de etapas que ya no existen: fuera solo si nunca se generaron.
  const inUse = new Set(stageImage.values());
  const removeNodeIds: string[] = [];
  const generated = new Set([...(data.generatedImageIds ?? []), ...addNodes.map((n) => n.id)]);
  for (const id of data.generatedImageIds ?? []) {
    if (inUse.has(id)) continue;
    const n = byId.get(id);
    if (!n) {
      generated.delete(id);
      continue;
    }
    const d = n.data as Record<string, unknown>;
    if (!d.outputUrl && !(Array.isArray(d.outputHistory) && d.outputHistory.length > 0)) {
      removeNodeIds.push(id);
      generated.delete(id);
    } else {
      warnings.push(`La imagen "${String(d.label ?? id)}" quedó sin etapa; se conservó porque ya tiene resultados.`);
    }
  }
  // Las conexiones hacia/desde imágenes eliminadas caen con ellas.
  const removedSet = new Set(removeNodeIds);
  const finalRemoveEdgeIds = [
    ...new Set([
      ...removeEdgeIds,
      ...edges.filter((e) => removedSet.has(e.source) || removedSet.has(e.target)).map((e) => e.id),
    ]),
  ];

  const characterData: CharacterNodeData = {
    ...data,
    stages: (data.stages ?? []).map((s) => (stageImage.has(s.id) ? { ...s, imageNodeId: stageImage.get(s.id) } : s)),
    generatedImageIds: [...generated],
    managedEdgeIds: managedIds.filter((id) => !finalRemoveEdgeIds.includes(id)),
    chainStale: false,
  };

  return {
    addNodes,
    removeNodeIds,
    addEdges,
    updateEdges,
    removeEdgeIds: finalRemoveEdgeIds,
    characterData,
    warnings,
  };
}
