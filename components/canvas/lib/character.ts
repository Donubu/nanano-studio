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
  // Imagen vinculada de otro canvas (la vista guardada en el nodo).
  if (node.type === "linked") {
    const snap = d.linkSnapshot as { kind?: string; imageUrl?: string | null } | null | undefined;
    if (snap?.kind === "image" && snap.imageUrl) return [{ url: snap.imageUrl }];
  }
  return [];
}

/**
 * URLs elegidas para una etapa que siguen disponibles: la galería sigue
 * conectada al Personaje y todavía contiene la foto.
 */
export function stageReferenceUrls(
  stage: CharacterStage | null | undefined,
  galleries: { id: string; type?: string; data: Record<string, unknown> }[],
  // Fotos que entrega cada galería (por defecto, solo las propias; con
  // node-outputs también las que recibe por su entrada de imágenes).
  imagesOf: (g: { id: string; type?: string; data: Record<string, unknown> }) => { url: string }[] = galleryImagesOf,
): string[] {
  if (!stage?.referenceImages?.length) return [];
  const available = new Map(galleries.map((g) => [g.id, new Set(imagesOf(g).map((i) => i.url))]));
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

/**
 * Etapa elegida en una conexión de la salida "imagen de una etapa". null si no
 * se eligió o la etapa ya no existe.
 */
export function stageForImageOutput(data: CharacterNodeData, edgeId: string): CharacterStage | null {
  const stageId = data.imageOutputs?.[edgeId];
  if (!stageId) return null;
  return (data.stages ?? []).find((s) => s.id === stageId) ?? null;
}

/**
 * Reescribe cada conexión de la salida "imagen de una etapa" como si saliera
 * de la imagen de la etapa elegida (mismo id, destino y prioridad). Así la
 * ejecución (orden topológico, dependencias, referencias, frames) la trata
 * igual que una imagen conectada directo y espera a que esa imagen termine.
 * Las conexiones sin etapa elegida, o cuya etapa todavía no tiene imagen, se
 * descartan: no entregan nada.
 */
export function resolveCharacterImageEdges<E extends Edge>(nodes: Pick<Node, "id" | "type" | "data">[], edges: E[]): E[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let changed = false;
  const out: E[] = [];
  for (const e of edges) {
    if (baseHandleId(e.sourceHandle) !== HANDLE_IDS.OUTPUT_CHARACTER_IMAGE) {
      out.push(e);
      continue;
    }
    const character = byId.get(e.source);
    // Personaje vinculado: la imagen viene de su vista, no de un nodo de este
    // canvas; la conexión queda tal cual y la lee resolveNodeInputs.
    if (character?.type === "linked") {
      out.push(e);
      continue;
    }
    changed = true;
    if (character?.type !== "character") continue;
    const stage = stageForImageOutput(character.data as unknown as CharacterNodeData, e.id);
    const imageId = stage?.imageNodeId;
    if (!imageId || !byId.has(imageId) || imageId === e.target) continue;
    out.push({ ...e, source: imageId, sourceHandle: HANDLE_IDS.OUTPUT_IMAGE });
  }
  return changed ? out : edges;
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

/** Remapea el mapa conexión → etapa al copiar/pegar o insertar plantillas. */
export function remapImageOutputs(
  map: Record<string, string> | undefined,
  edgeIdMap?: Map<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(map ?? {})
      .filter(([edgeId]) => edgeIdMap?.has(edgeId))
      .map(([edgeId, stageId]) => [edgeIdMap!.get(edgeId)!, stageId]),
  );
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
    // La etapa elegida en cada salida de imagen sigue a su conexión copiada.
    imageOutputs: remapImageOutputs(data.imageOutputs as Record<string, string> | undefined, edgeIdMap),
    imageLabels: Object.fromEntries(
      Object.entries((data.imageLabels as Record<string, string> | undefined) ?? {})
        .filter(([id]) => idMap.has(id))
        .map(([id, label]) => [idMap.get(id)!, label]),
    ),
  };
}

/**
 * Conexiones de la imagen de una etapa que NO puso "Generar etapas" (ni la
 * del Personaje): las hizo el usuario, así que borrar la imagen las rompería.
 * Devuelve los ids de los otros nodos conectados, sin repetir.
 */
export function externalConnections(
  imageNodeId: string,
  characterId: string,
  data: Pick<CharacterNodeData, "managedEdgeIds">,
  edges: { id: string; source: string; target: string }[],
): string[] {
  const managed = new Set(data.managedEdgeIds ?? []);
  const others = new Set<string>();
  for (const e of edges) {
    if (managed.has(e.id)) continue;
    if (e.source === imageNodeId && e.target !== characterId) others.add(e.target);
    else if (e.target === imageNodeId && e.source !== characterId) others.add(e.source);
  }
  return [...others];
}

export interface CharacterMaterializePlan {
  addNodes: Node[];
  // Imágenes existentes cuyo nombre se actualiza al título actual de su etapa.
  renameNodes: { id: string; label: string }[];
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
  const renameNodes: { id: string; label: string }[] = [];
  const imageLabels: Record<string, string> = {};
  const generatedBefore = new Set(data.generatedImageIds ?? []);
  const stageLabel = (stage: CharacterStage, slot: number) => `${charLabel} · ${stage.name.trim() || `Etapa ${slot + 1}`}`;
  const charW = (typeof character.width === "number" ? character.width : character.measured?.width) ?? DEFAULT_CHARACTER_W;
  const columnX = character.position.x + charW + IMAGE_GAP_X;
  // En el orden de la lista, de arriba hacia abajo: la primera se genera
  // primero y alimenta a la siguiente.
  stages.forEach((stage, slot) => {
    const existing = stage.imageNodeId ? byId.get(stage.imageNodeId) : undefined;
    if (existing && existing.type === "image") {
      stageImage.set(stage.id, existing.id);
      // Renombrar solo si el nombre sigue siendo el que puso Generar (o, en
      // imágenes generadas antes de guardar ese registro, si tiene la forma
      // "Personaje · etapa"): un nombre puesto a mano se respeta.
      const current = String((existing.data as Record<string, unknown>).label ?? "");
      const assigned = data.imageLabels?.[existing.id];
      const managed = assigned !== undefined ? current === assigned : generatedBefore.has(existing.id) && / · /.test(current);
      const desired = stageLabel(stage, slot);
      if (managed) {
        if (current !== desired) renameNodes.push({ id: existing.id, label: desired });
        imageLabels[existing.id] = desired;
      }
      return;
    }
    const id = `node-${prefix}-${addNodes.length + 1}`;
    const base = getDefaultNodeData("image") as unknown as Record<string, unknown>;
    addNodes.push({
      id,
      type: "image",
      position: { x: columnX, y: character.position.y + slot * IMAGE_SLOT_Y },
      data: { ...base, label: stageLabel(stage, slot), aspectRatio: "3:4" },
    });
    stageImage.set(stage.id, id);
    imageLabels[id] = stageLabel(stage, slot);
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

  // 4. Imágenes de etapas que ya no existen: fuera solo si nunca se generaron
  // y no tienen conexiones del usuario (borrarlas rompería el flujo de los
  // nodos que alimentan o que las alimentan).
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
    const label = String(d.label ?? id);
    const userLinks = externalConnections(id, character.id, data, edges);
    if (userLinks.length > 0) {
      warnings.push(`La imagen "${label}" quedó sin etapa; se conservó porque está conectada a otros nodos.`);
    } else if (!d.outputUrl && !(Array.isArray(d.outputHistory) && d.outputHistory.length > 0)) {
      removeNodeIds.push(id);
      generated.delete(id);
    } else {
      warnings.push(`La imagen "${label}" quedó sin etapa; se conservó porque ya tiene resultados.`);
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
    imageLabels,
    chainStale: false,
  };

  return {
    addNodes,
    renameNodes,
    removeNodeIds,
    addEdges,
    updateEdges,
    removeEdgeIds: finalRemoveEdgeIds,
    characterData,
    warnings,
  };
}

/**
 * Etapas como texto para copiar: solo los títulos (uno por línea) o títulos
 * con su descripción (bloques separados por una línea en blanco). Omite las
 * etapas vacías; una sin título usa "Etapa N".
 */
export function stagesAsText(stages: Pick<CharacterStage, "name" | "text">[], withText: boolean): string {
  const filled = stages
    .map((s, i) => ({ name: s.name.trim() || `Etapa ${i + 1}`, text: s.text.trim(), empty: !s.name.trim() && !s.text.trim() }))
    .filter((s) => !s.empty);
  if (!withText) return filled.map((s) => s.name).join("\n");
  return filled.map((s) => (s.text ? `${s.name}\n${s.text}` : s.name)).join("\n\n");
}
