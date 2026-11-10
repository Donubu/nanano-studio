// Asistente del canvas: convierte las operaciones que propone Gemini en un
// plan concreto y válido (nodos nuevos con su data completa, cambios por
// nodo, conexiones con handles reales, borrados). Puro: lo usa la ruta
// /api/conversations/[id]/canvas/ai/assist y los tests.
//
// La IA solo decide QUÉ nodos, con qué textos y cómo conectarlos; todo lo
// demás (ids, handles, defaults, reglas de conexión, ciclos, capacidades de
// video por modelo) lo resuelve este módulo con las mismas reglas que la UI.
// Lo que no pasa la validación se descarta con un aviso, nunca se aplica.

import {
  HANDLE_IDS,
  baseHandleId,
  getDefaultNodeData,
  MAX_CHARACTER_STAGES,
  type CanvasEdge,
  type CanvasNodeType,
} from "@/components/canvas/lib/canvas-types";
import { VALID_CONNECTIONS, isValidConnection, wouldCreateCycle } from "@/components/canvas/lib/connection-rules";
import { getVideoCapabilities, reconcileVideoSettings } from "@/components/canvas/lib/video-capabilities";

// ---------------------------------------------------------------------------
// Entrada: snapshot compacto del canvas (lo arma el cliente)
// ---------------------------------------------------------------------------

export interface AssistSnapshotNode {
  id: string;
  type: string;
  label?: string;
  // Prompt / contenido / texto de escena, ya recortado por el cliente.
  text?: string;
  modelId?: number;
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  hasOutput?: boolean;
  locked?: boolean;
  // Solo nodos character.
  stages?: AssistSnapshotStage[];
  dna?: string;
  // Fotos de una galería / imagen estática / imagen generada, en orden.
  images?: string[];
  // Resultado de un nodo imagen (para que el asistente pueda verlo).
  outputUrl?: string;
}

export interface AssistSnapshotStage {
  id: string;
  name: string;
  text: string;
  referenceImages?: { nodeId: string; url: string }[];
  imageNodeId?: string;
}

export interface AssistSnapshotEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface AssistModel {
  id: number;
  model_id: string;
  display_name: string;
  api_backend: string | null;
  is_default: boolean;
}

// Modelos habilitados del proyecto por tipo de generación.
export type AssistModels = Partial<Record<"text" | "image" | "video", AssistModel[]>>;

// ---------------------------------------------------------------------------
// Salida de Gemini (schema en assist-prompt.ts)
// ---------------------------------------------------------------------------

export type AssistOpKind = "add_node" | "update_node" | "remove_node" | "connect" | "disconnect";

export const INPUT_KINDS = {
  prompt: HANDLE_IDS.INPUT_PROMPT,
  reference: HANDLE_IDS.INPUT_REFERENCE,
  first_frame: HANDLE_IDS.INPUT_FIRST_FRAME,
  last_frame: HANDLE_IDS.INPUT_LAST_FRAME,
  media: HANDLE_IDS.INPUT_MEDIA,
  params: HANDLE_IDS.INPUT_PARAMS,
  scene_params: HANDLE_IDS.INPUT_SCENE_PARAMS,
  visual_reference: HANDLE_IDS.INPUT_VISUAL_REFERENCE,
  rules: HANDLE_IDS.INPUT_RULES,
  script_chain: HANDLE_IDS.INPUT_SCRIPT_CHAIN,
  params_scene_ref: HANDLE_IDS.INPUT_PARAMS_SCENE_REF,
  character_style: HANDLE_IDS.INPUT_CHARACTER_STYLE,
  character_gallery: HANDLE_IDS.INPUT_CHARACTER_GALLERY,
} as const;
export type InputKind = keyof typeof INPUT_KINDS;

export interface AssistOp {
  op: AssistOpKind;
  ref?: string;
  node?: string;
  node_type?: string;
  label?: string;
  prompt?: string;
  model_id?: number;
  aspect_ratio?: string;
  duration?: number;
  resolution?: string;
  audio_enabled?: boolean;
  number_of_images?: number;
  negative_prompt?: string;
  system_instruction?: string;
  temperature?: number;
  output_as_prompt?: boolean;
  from?: string;
  to?: string;
  input?: string;
  // character: ADN y etapas de la más antigua a la más reciente.
  dna?: string;
  stages?: { id?: string; name?: string; text?: string; photos?: { gallery: string; number: number }[] }[];
  generate_stages?: boolean;
}

export interface AssistResponse {
  reply?: string;
  ops?: AssistOp[];
  relayout?: "none" | "all";
}

// ---------------------------------------------------------------------------
// Plan resultante (lo aplica el cliente)
// ---------------------------------------------------------------------------

export interface PlanNode {
  id: string;
  type: CanvasNodeType;
  data: Record<string, unknown>;
}

export interface PlanEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface AssistPlan {
  reply: string;
  addNodes: PlanNode[];
  updates: { id: string; patch: Record<string, unknown> }[];
  removeNodeIds: string[];
  addEdges: PlanEdge[];
  removeEdgeIds: string[];
  relayout: boolean;
  // Personajes a los que aplicar "Generar etapas" después del plan.
  materializeCharacterIds: string[];
  warnings: string[];
}

// Tipos que la IA puede crear. Escena queda fuera: la crea "Leer guion" →
// materializar, con datos que la IA no tiene (scriptNodeId, generalInfo).
export const CREATABLE_TYPES: CanvasNodeType[] = [
  "text", "text-practicante", "image", "video", "note", "static-text",
  "static-image", "static-image-group", "params-text", "params-image",
  "params-video", "params-scene", "script", "character",
];

const REFERENCE_TYPES = new Set(["image", "static-image", "static-image-group"]);
const PROMPT_FIELD_TYPES = new Set(["text", "text-practicante", "image", "video", "script"]);
const CONTENT_FIELD_TYPES = new Set(["note", "static-text", "params-scene"]);
const IMAGE_ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"];

// Topes para que una respuesta desbocada no llene el canvas.
export const MAX_NEW_NODES = 40;
export const MAX_OPS = 120;
const MAX_PROMPT_CHARS = 8000;
const MAX_LABEL_CHARS = 60;

// Tipo de generación cuyo modelo usa cada tipo de nodo.
function generationTypeOf(nodeType: string): "text" | "image" | "video" | null {
  if (nodeType === "text" || nodeType === "params-text" || nodeType === "script") return "text";
  if (nodeType === "image" || nodeType === "params-image") return "image";
  if (nodeType === "video" || nodeType === "params-video") return "video";
  return null;
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

interface BuildOptions {
  // Genera ids únicos (inyectable para tests).
  idPrefix?: string;
}

export function buildAssistPlan(
  response: AssistResponse,
  snapshot: { nodes: AssistSnapshotNode[]; edges: AssistSnapshotEdge[] },
  models: AssistModels,
  opts: BuildOptions = {},
): AssistPlan {
  const prefix = opts.idPrefix ?? `ai${Date.now().toString(36)}`;
  const warnings: string[] = [];
  const plan: AssistPlan = {
    reply: (response.reply ?? "").trim(),
    addNodes: [],
    updates: [],
    removeNodeIds: [],
    addEdges: [],
    removeEdgeIds: [],
    relayout: response.relayout === "all",
    materializeCharacterIds: [],
    warnings,
  };

  // Estado simulado: se va actualizando op por op para validar las
  // siguientes (una conexión a un nodo recién creado, un borrado previo…).
  const nodeType = new Map<string, string>(snapshot.nodes.map((n) => [n.id, n.type]));
  const existing = new Map(snapshot.nodes.map((n) => [n.id, n]));
  let edges: CanvasEdge[] = snapshot.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
  }));
  const refToId = new Map<string, string>();
  const newById = new Map<string, PlanNode>();
  const removed = new Set<string>();
  let nodeSeq = 0;
  let edgeSeq = 0;

  // Resuelve una referencia de la IA: ref de nodo nuevo o id existente.
  const resolve = (key: string | undefined): string | null => {
    if (!key) return null;
    const k = key.trim();
    if (refToId.has(k)) return refToId.get(k)!;
    if (nodeType.has(k) && !removed.has(k)) return k;
    return null;
  };

  const nameOf = (id: string): string => {
    const n = newById.get(id);
    const label = (n?.data.label as string | undefined) ?? existing.get(id)?.label;
    return label ? `"${label}"` : id;
  };

  const modelFor = (type: string, modelId: number | undefined): AssistModel | null => {
    const gen = generationTypeOf(type);
    if (!gen) return null;
    const list = models[gen] ?? [];
    if (modelId != null) {
      const found = list.find((m) => m.id === modelId);
      if (found) return found;
      warnings.push(`El modelo ${modelId} no está habilitado en el proyecto; se usa el predeterminado.`);
    }
    return list.find((m) => m.is_default) ?? list[0] ?? null;
  };

  // Mapea los campos de la op a la data del nodo según su tipo. `base` es
  // la data actual (para reconciliar video con lo que ya tenía).
  const fieldsFor = (type: string, op: AssistOp, base: Record<string, unknown>): Record<string, unknown> => {
    const patch: Record<string, unknown> = {};
    if (typeof op.label === "string" && op.label.trim()) patch.label = clip(op.label.trim(), MAX_LABEL_CHARS);
    if (typeof op.prompt === "string") {
      const text = clip(op.prompt, MAX_PROMPT_CHARS);
      if (PROMPT_FIELD_TYPES.has(type)) patch.prompt = text;
      else if (CONTENT_FIELD_TYPES.has(type)) patch.content = text;
      else if (type === "static-image") patch.caption = clip(text, 300);
    }

    if (type === "character" && typeof op.dna === "string") patch.dna = clip(op.dna.trim(), MAX_PROMPT_CHARS);

    const gen = generationTypeOf(type);
    if (gen && op.model_id != null) {
      const m = modelFor(type, op.model_id);
      if (m) {
        patch.modelId = m.id;
        patch.modelName = m.display_name;
      }
    }

    if (gen === "text") {
      if (typeof op.system_instruction === "string") patch.systemInstruction = clip(op.system_instruction, MAX_PROMPT_CHARS);
      if (typeof op.temperature === "number") patch.temperature = Math.min(2, Math.max(0, op.temperature));
      if (typeof op.output_as_prompt === "boolean" && type !== "script") patch.outputAsPrompt = op.output_as_prompt;
    }
    if (type === "text-practicante" && typeof op.output_as_prompt === "boolean") {
      patch.outputAsPrompt = op.output_as_prompt;
    }

    if (gen === "image") {
      if (op.aspect_ratio) {
        if (IMAGE_ASPECTS.includes(op.aspect_ratio)) patch.aspectRatio = op.aspect_ratio;
        else warnings.push(`Proporción ${op.aspect_ratio} no válida para imagen; se mantiene ${base.aspectRatio ?? "16:9"}.`);
      }
      if (op.resolution) {
        const r = op.resolution.toUpperCase();
        if (IMAGE_RESOLUTIONS.includes(r)) patch.resolution = r;
      }
      if (typeof op.number_of_images === "number") {
        patch.numberOfImages = Math.min(4, Math.max(1, Math.round(op.number_of_images)));
      }
      if (typeof op.negative_prompt === "string") patch.negativePrompt = clip(op.negative_prompt, 2000);
    }

    if (gen === "video") {
      const requested = {
        duration: typeof op.duration === "number" ? Math.round(op.duration) : (base.duration as number | undefined),
        aspectRatio: op.aspect_ratio ?? (base.aspectRatio as string | undefined),
        resolution: op.resolution ?? (base.resolution as string | undefined),
      };
      const modelId = (patch.modelId as number | undefined) ?? (base.modelId as number | undefined);
      const model = modelFor(type, modelId);
      const caps = getVideoCapabilities(model);
      const snap = reconcileVideoSettings(requested, caps);
      const final = { ...requested, ...snap };
      if (op.duration != null && snap.duration != null) {
        warnings.push(`${model?.display_name ?? "El modelo de video"} no admite ${op.duration}s; queda en ${snap.duration}s.`);
      }
      if (op.aspect_ratio && snap.aspectRatio != null) {
        warnings.push(`${model?.display_name ?? "El modelo de video"} no admite ${op.aspect_ratio}; queda en ${snap.aspectRatio}.`);
      }
      if (op.duration != null || snap.duration != null) patch.duration = final.duration;
      if (op.aspect_ratio != null || snap.aspectRatio != null) patch.aspectRatio = final.aspectRatio;
      if (op.resolution != null || snap.resolution != null) patch.resolution = final.resolution;
      if (typeof op.audio_enabled === "boolean") patch.audioEnabled = caps.audioAlwaysOn ? true : op.audio_enabled;
      if (typeof op.negative_prompt === "string" && caps.supportsNegativePrompt !== false) {
        patch.negativePrompt = clip(op.negative_prompt, 2000);
      }
    }
    return patch;
  };

  // Conecta source → target con la regla que corresponda (o la entrada
  // pedida). Devuelve false y deja un aviso si no se puede.
  const connect = (source: string, target: string, input?: string): boolean => {
    const sType = nodeType.get(source)!;
    const tType = nodeType.get(target)!;
    const wanted = input && input in INPUT_KINDS ? INPUT_KINDS[input as InputKind] : null;
    const rules = VALID_CONNECTIONS.filter(
      (r) => r.sourceType === sType && r.targetType === tType && (!wanted || r.targetHandle === wanted),
    );
    if (rules.length === 0) {
      warnings.push(`${nameOf(source)} (${sType}) no se puede conectar a ${nameOf(target)} (${tType})${input ? ` como ${input}` : ""}.`);
      return false;
    }
    if (edges.some((e) => e.source === source && e.target === target && rules.some((r) => r.targetHandle === baseHandleId(e.targetHandle)))) {
      return true; // ya conectados
    }
    const simNodes = [...nodeType.entries()].map(([id, type]) => ({ id, type, position: { x: 0, y: 0 }, data: {} }));
    const rule = rules.find((r) =>
      isValidConnection({ source, target, sourceHandle: r.sourceHandle, targetHandle: r.targetHandle }, simNodes, edges),
    );
    if (!rule) {
      warnings.push(`La entrada de ${nameOf(target)} ya está ocupada; no se conectó ${nameOf(source)}.`);
      return false;
    }
    if (wouldCreateCycle(edges, source, target)) {
      warnings.push(`Conectar ${nameOf(source)} → ${nameOf(target)} crearía un ciclo.`);
      return false;
    }
    edgeSeq += 1;
    const edge: PlanEdge = { id: `e-${prefix}-${edgeSeq}`, source, sourceHandle: rule.sourceHandle, target, targetHandle: rule.targetHandle };
    plan.addEdges.push(edge);
    edges.push({ ...edge });
    return true;
  };

  // Etapas de un Personaje desde la op. Conserva id, imagen y fotos de las
  // etapas existentes con el mismo nombre (así "Generar etapas" no duplica
  // imágenes al editar). Las fotos se eligen por número dentro de una
  // galería del canvas; si la galería no está conectada al Personaje, se
  // conecta.
  let stageSeq = 0;
  const stagesFor = (op: AssistOp, previous: AssistSnapshotStage[], characterId: string): AssistSnapshotStage[] | null => {
    if (!Array.isArray(op.stages)) return null;
    // Una etapa existente se reconoce por su id (así renombrarla no pierde su
    // imagen) y, si el modelo no lo manda, por el nombre.
    const byId = new Map(previous.map((st) => [st.id, st]));
    const byName = new Map(previous.map((st) => [st.name.trim().toLowerCase(), st]));
    const used = new Set<string>();
    const out: AssistSnapshotStage[] = [];
    for (const raw of op.stages.slice(0, MAX_CHARACTER_STAGES)) {
      const name = clip((raw.name ?? "").trim(), MAX_LABEL_CHARS);
      const text = clip((raw.text ?? "").trim(), MAX_PROMPT_CHARS);
      if (!name && !text) continue;
      let prev = raw.id ? byId.get(raw.id.trim()) : undefined;
      if (!prev) prev = byName.get(name.toLowerCase());
      if (prev && used.has(prev.id)) prev = undefined;
      if (prev) used.add(prev.id);
      stageSeq += 1;
      const stage: AssistSnapshotStage = prev ? { ...prev, name, text } : { id: `st-${prefix}-${stageSeq}`, name, text };
      if (Array.isArray(raw.photos)) {
        const refs: { nodeId: string; url: string }[] = [];
        for (const ph of raw.photos) {
          const gid = resolve(ph.gallery);
          const gType = gid ? nodeType.get(gid) : undefined;
          if (!gid || !gType || !REFERENCE_TYPES.has(gType)) {
            warnings.push(`"${ph.gallery}" no es una galería o imagen del canvas (etapa "${name}").`);
            continue;
          }
          const images = existing.get(gid)?.images ?? [];
          const url = images[Math.round(ph.number) - 1];
          if (!url) {
            warnings.push(`${nameOf(gid)} no tiene una foto número ${ph.number} (etapa "${name}").`);
            continue;
          }
          if (!refs.some((r) => r.url === url)) refs.push({ nodeId: gid, url });
          connect(gid, characterId, "character_gallery");
        }
        stage.referenceImages = refs;
      }
      out.push(stage);
    }
    if (op.stages.length > MAX_CHARACTER_STAGES) {
      warnings.push(`Un Personaje admite hasta ${MAX_CHARACTER_STAGES} etapas; se usaron las primeras.`);
    }
    return out;
  };
  const markGenerate = (op: AssistOp, id: string) => {
    if (op.generate_stages && !plan.materializeCharacterIds.includes(id)) plan.materializeCharacterIds.push(id);
  };

  const ops = (response.ops ?? []).slice(0, MAX_OPS);
  if ((response.ops ?? []).length > MAX_OPS) {
    warnings.push(`La IA propuso demasiados cambios; se aplicaron los primeros ${MAX_OPS}.`);
  }

  for (const op of ops) {
    switch (op.op) {
      case "add_node": {
        const type = op.node_type as CanvasNodeType;
        if (!CREATABLE_TYPES.includes(type)) {
          warnings.push(`No se puede crear un nodo de tipo "${op.node_type}".`);
          break;
        }
        if (plan.addNodes.length >= MAX_NEW_NODES) {
          warnings.push(`Se alcanzó el máximo de ${MAX_NEW_NODES} nodos nuevos por pedido.`);
          break;
        }
        const ref = (op.ref ?? "").trim();
        if (ref && refToId.has(ref)) {
          warnings.push(`La referencia ${ref} se repitió; se ignoró el segundo nodo.`);
          break;
        }
        nodeSeq += 1;
        const id = `node-${prefix}-${nodeSeq}`;
        const base = getDefaultNodeData(type) as unknown as Record<string, unknown>;
        // En video, fieldsFor ajusta duración/proporción/resolución a las
        // capacidades del modelo (el elegido o el predeterminado del proyecto).
        const data = { ...base, ...fieldsFor(type, op, base) };
        const node: PlanNode = { id, type, data };
        plan.addNodes.push(node);
        newById.set(id, node);
        nodeType.set(id, type);
        if (ref) refToId.set(ref, id);
        if (type === "character") {
          data.stages = stagesFor(op, [], id) ?? [];
          markGenerate(op, id);
        }
        break;
      }

      case "update_node": {
        const id = resolve(op.node);
        if (!id) {
          warnings.push(`No encontré el nodo "${op.node}" para editarlo.`);
          break;
        }
        const type = nodeType.get(id)!;
        const fresh = newById.get(id);
        if (fresh) {
          Object.assign(fresh.data, fieldsFor(type, op, fresh.data));
          if (type === "character") {
            const st = stagesFor(op, (fresh.data.stages as AssistSnapshotStage[]) ?? [], id);
            if (st) fresh.data.stages = st;
            markGenerate(op, id);
          }
          break;
        }
        const snap = existing.get(id)!;
        if (snap.locked) {
          warnings.push(`El nodo ${nameOf(id)} está bloqueado; no se modificó.`);
          break;
        }
        if (type === "scene") {
          warnings.push(`Las escenas se editan desde el Guión; no se modificó ${nameOf(id)}.`);
          break;
        }
        const base: Record<string, unknown> = {
          modelId: snap.modelId,
          duration: snap.duration,
          aspectRatio: snap.aspectRatio,
          resolution: snap.resolution,
        };
        const patch = fieldsFor(type, op, base);
        if (type === "character") {
          const st = stagesFor(op, snap.stages ?? [], id);
          if (st) {
            patch.stages = st;
            // Etapas con imagen reordenadas o quitadas: la cadena queda
            // desalineada hasta volver a "Generar etapas".
            const withImage = (list: AssistSnapshotStage[]) => list.filter((x) => x.imageNodeId).map((x) => x.imageNodeId).join(",");
            if (withImage(st) !== withImage(snap.stages ?? [])) patch.chainStale = true;
          }
          markGenerate(op, id);
        }
        if (Object.keys(patch).length === 0) break;
        const prev = plan.updates.find((u) => u.id === id);
        if (prev) Object.assign(prev.patch, patch);
        else plan.updates.push({ id, patch });
        break;
      }

      case "remove_node": {
        const id = resolve(op.node);
        if (!id) {
          warnings.push(`No encontré el nodo "${op.node}" para borrarlo.`);
          break;
        }
        if (newById.has(id)) {
          // Crear y borrar en el mismo pedido: se cancela la creación.
          plan.addNodes = plan.addNodes.filter((n) => n.id !== id);
          newById.delete(id);
        } else {
          if (existing.get(id)?.locked) {
            warnings.push(`El nodo ${nameOf(id)} está bloqueado; no se borró.`);
            break;
          }
          plan.removeNodeIds.push(id);
          plan.updates = plan.updates.filter((u) => u.id !== id);
        }
        removed.add(id);
        nodeType.delete(id);
        plan.materializeCharacterIds = plan.materializeCharacterIds.filter((x) => x !== id);
        for (const [ref, rid] of refToId) if (rid === id) refToId.delete(ref);
        plan.addEdges = plan.addEdges.filter((e) => e.source !== id && e.target !== id);
        edges = edges.filter((e) => e.source !== id && e.target !== id);
        break;
      }

      case "connect": {
        const source = resolve(op.from);
        const target = resolve(op.to);
        if (!source || !target) {
          warnings.push(`No pude conectar "${op.from}" → "${op.to}": falta uno de los nodos.`);
          break;
        }
        connect(source, target, op.input);
        break;
      }

      case "disconnect": {
        const source = resolve(op.from);
        const target = resolve(op.to);
        if (!source || !target) break;
        const wanted = op.input && op.input in INPUT_KINDS ? INPUT_KINDS[op.input as InputKind] : null;
        const matches = edges.filter(
          (e) => e.source === source && e.target === target && (!wanted || baseHandleId(e.targetHandle) === wanted),
        );
        if (matches.length === 0) {
          warnings.push(`${nameOf(source)} y ${nameOf(target)} no estaban conectados.`);
          break;
        }
        for (const m of matches) {
          if (plan.addEdges.some((e) => e.id === m.id)) {
            plan.addEdges = plan.addEdges.filter((e) => e.id !== m.id);
          } else {
            plan.removeEdgeIds.push(m.id);
          }
        }
        const ids = new Set(matches.map((m) => m.id));
        edges = edges.filter((e) => !ids.has(e.id));
        break;
      }

      default:
        warnings.push(`Operación desconocida "${(op as AssistOp).op}".`);
    }
  }

  // Un Personaje nuevo sin etapas (el modelo a veces olvida mandarlas) se
  // avisa: "Generar etapas" no tendría nada que crear.
  for (const n of plan.addNodes) {
    if (n.type === "character" && (!Array.isArray(n.data.stages) || n.data.stages.length === 0)) {
      warnings.push(`El Personaje ${nameOf(n.id)} quedó sin etapas: agrégalas en el nodo o vuelve a pedírselas a la IA.`);
      plan.materializeCharacterIds = plan.materializeCharacterIds.filter((x) => x !== n.id);
    }
  }

  return plan;
}

export function planIsEmpty(plan: AssistPlan): boolean {
  return (
    plan.addNodes.length === 0 &&
    plan.updates.length === 0 &&
    plan.removeNodeIds.length === 0 &&
    plan.addEdges.length === 0 &&
    plan.removeEdgeIds.length === 0 &&
    plan.materializeCharacterIds.length === 0 &&
    !plan.relayout
  );
}


// ---------------------------------------------------------------------------
// Textos de etapa inventados
// ---------------------------------------------------------------------------

const DESCRIBE_REQUEST = /\b(describ|redact|escrib|invent|prop[oó]n|suger|complet|detall|desarroll|mejor|ajust|corrig|cambi|reescrib|agreg|añad)/i;
const STOPWORDS = new Set([
  "para", "como", "pero", "este", "esta", "esto", "estos", "estas", "sobre", "entre", "desde", "hasta",
  "cuando", "donde", "todo", "toda", "todos", "todas", "cada", "tambien", "porque", "tiene", "tienen",
  "solo", "sola", "unos", "unas", "otro", "otra", "otros", "otras", "mismo", "misma", "etapa", "etapas",
]);

function contentWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/**
 * El modelo tiende a "describir" etapas que el usuario solo nombró ("adulta"
 * → "adulta completamente desarrollada con alas…"). Si el pedido no pide
 * describir/mejorar, un texto de etapa cuyas palabras casi no aparecen en el
 * pedido ni en el canvas se deja vacío. Muta el plan y devuelve cuántos
 * textos se vaciaron.
 */
export function dropInventedStageText(
  plan: AssistPlan,
  instruction: string,
  snapshot: { nodes: AssistSnapshotNode[] },
): number {
  if (DESCRIBE_REQUEST.test(instruction)) return 0;
  const vocab = new Set(contentWords(instruction));
  for (const n of snapshot.nodes) {
    for (const t of [n.text, n.dna, ...(n.stages ?? []).flatMap((st) => [st.name, st.text])]) {
      if (t) contentWords(t).forEach((w) => vocab.add(w));
    }
  }
  const previousText = new Map<string, string>();
  for (const n of snapshot.nodes) for (const st of n.stages ?? []) previousText.set(st.id, st.text);

  let dropped = 0;
  const clean = (stages: unknown) => {
    if (!Array.isArray(stages)) return;
    for (const st of stages as AssistSnapshotStage[]) {
      if (!st.text || previousText.get(st.id) === st.text) continue;
      const words = contentWords(st.text);
      if (words.length === 0) continue;
      const known = words.filter((w) => vocab.has(w)).length;
      if (known / words.length < 0.6) {
        st.text = "";
        dropped += 1;
      }
    }
  };
  for (const n of plan.addNodes) if (n.type === "character") clean(n.data.stages);
  for (const u of plan.updates) clean(u.patch.stages);
  return dropped;
}


// ---------------------------------------------------------------------------
// Resultados que el asistente puede ver
// ---------------------------------------------------------------------------

const RESULT_HINT = /\b(result|gener[oóa]|qued[oó]|sali[oó]|imagen|imágenes|foto|se ve|parec|mejor|ajust|corrig|arregl)/i;

/**
 * Imágenes generadas que se le muestran al modelo, en orden de relevancia:
 * los nodos imagen seleccionados, las imágenes de etapa de los Personajes
 * seleccionados y, sin selección, las de un Personaje cuyo nombre aparece en
 * el pedido (si el pedido habla de resultados).
 */
export function pickResultImages(
  snapshot: { nodes: AssistSnapshotNode[] },
  selectedIds: string[],
  instruction: string,
): { nodeId: string; url: string; caption: string }[] {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const stageOf = new Map<string, { character: AssistSnapshotNode; stage: AssistSnapshotStage; index: number }>();
  for (const n of snapshot.nodes) {
    (n.stages ?? []).forEach((stage, index) => {
      if (stage.imageNodeId) stageOf.set(stage.imageNodeId, { character: n, stage, index });
    });
  }
  const out: { nodeId: string; url: string; caption: string }[] = [];
  const add = (id: string) => {
    const n = byId.get(id);
    if (!n?.outputUrl || out.some((o) => o.nodeId === id)) return;
    const st = stageOf.get(id);
    const caption = st
      ? `nodo ${id} · Personaje "${st.character.label ?? st.character.id}" (${st.character.id}) · etapa ${st.index + 1} "${st.stage.name}" (id=${st.stage.id})`
      : `nodo ${id}${n.label ? ` "${n.label}"` : ""}`;
    out.push({ nodeId: id, url: n.outputUrl, caption });
  };
  const characterImages = (c: AssistSnapshotNode) => (c.stages ?? []).forEach((st) => st.imageNodeId && add(st.imageNodeId));

  for (const id of selectedIds) {
    const n = byId.get(id);
    if (!n) continue;
    if (n.type === "character") characterImages(n);
    else add(id);
  }
  if (out.length === 0 && RESULT_HINT.test(instruction)) {
    const low = instruction.toLowerCase();
    for (const n of snapshot.nodes) {
      if (n.type === "character" && n.label && low.includes(n.label.toLowerCase())) characterImages(n);
    }
  }
  return out;
}
