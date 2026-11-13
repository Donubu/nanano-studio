import type { Node, Edge, BuiltInNode } from "@xyflow/react";

// --- Node Status ---
export type CanvasNodeStatus = "idle" | "generating" | "completed" | "error";

// --- Output History ---
export interface OutputHistoryEntry {
  url?: string;        // outputUrl for images/videos
  text?: string;       // outputText for text nodes
  messageId?: number;
  modelName?: string;
  createdAt: string;   // ISO timestamp
}

// --- Base Node Data ---
export interface BaseNodeData {
  label: string;
  status: CanvasNodeStatus;
  errorMessage?: string;
  outputMessageId?: number;
  modelName?: string; // Display name of selected model
  locked?: boolean; // Prevents modifications to the node
  [key: string]: unknown; // Required by React Flow's Node type
}

// --- Text Node ---
export interface TextNodeData extends BaseNodeData {
  type: "text";
  prompt: string;
  modelId?: number;
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  thinkingLevel?: string;
  outputAsPrompt: boolean; // Forces output to be a clean prompt for downstream nodes
  outputText?: string;
  outputHistory?: OutputHistoryEntry[];
}

// --- Text Practicante Node (delegates to Practicante orchestrator/agents) ---
export interface PracticanteFile {
  name: string;
  url: string;
  mimeType?: string;
}

export interface TextPracticanteNodeData extends BaseNodeData {
  type: "text-practicante";
  prompt: string;
  agentId?: string; // Empty = orchestrator picks the agent
  agentName?: string; // Cached display name of the selected agent
  dryRun: boolean;
  outputAsPrompt: boolean; // If true, injects a promptSuffix to force clean output for downstream nodes
  outputText?: string;
  outputHistory?: OutputHistoryEntry[];
  files?: PracticanteFile[]; // URLs returned by agent tools
  conversationId?: string; // Reused across re-executions of the same node
  delegatedTo?: string; // Agent that actually handled the request
  toolsUsed?: string[];
  tokensUsed?: { inputTokens: number; outputTokens: number };
  estimatedCost?: number;
  dryRunResponse?: string; // Dry-run analysis shown in the third column
}

// --- Image Node ---
export interface ImageNodeData extends BaseNodeData {
  type: "image";
  prompt: string;
  modelId?: number;
  aspectRatio: string;
  resolution: string;
  negativePrompt?: string;
  seed?: number;
  numberOfImages?: number;
  outputUrl?: string;
  outputHistory?: OutputHistoryEntry[];
}

// --- Video Node ---
export interface VideoNodeData extends BaseNodeData {
  type: "video";
  prompt: string;
  modelId?: number;
  duration: number;
  aspectRatio: string;
  resolution: string;
  audioEnabled: boolean;
  negativePrompt?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  outputUrl?: string;
  outputHistory?: OutputHistoryEntry[];
}

// --- Static Nodes (no AI generation) ---

export interface NoteNodeData extends BaseNodeData {
  type: "note";
  content: string;
}

export interface StaticTextNodeData extends BaseNodeData {
  type: "static-text";
  content: string;
  // Orden de las piezas conectadas a su entrada TEXTOS (ids de conexión). La
  // salida es: piezas en este orden + su propio texto al final (ver
  // lib/node-outputs.ts). Las conexiones que no estén aquí van al final por
  // orden de conexión.
  partOrder?: string[];
}

export interface StaticImageNodeData extends BaseNodeData {
  type: "static-image";
  imageUrl?: string;
  caption?: string;
}

export interface StaticImageGroupNodeData extends BaseNodeData {
  type: "static-image-group";
  images: { url: string; caption?: string }[];
}

// --- Params Nodes (presets) ---

export interface ParamsTextNodeData extends BaseNodeData {
  type: "params-text";
  modelId?: number;
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  thinkingLevel?: string;
  outputAsPrompt?: boolean;
}

export interface ParamsImageNodeData extends BaseNodeData {
  type: "params-image";
  modelId?: number;
  aspectRatio: string;
  resolution: string;
  negativePrompt?: string;
  numberOfImages?: number;
}

export interface ParamsVideoNodeData extends BaseNodeData {
  type: "params-video";
  modelId?: number;
  duration: number;
  aspectRatio: string;
  resolution: string;
  audioEnabled: boolean;
  negativePrompt?: string;
}

// Params Escena: definición de estilo, técnica, visual; se conecta sólo a Escenas.
// Su content se concatena al prompt del nodo destino (image/video/practicante)
// que está aguas abajo de la Escena.
export interface ParamsSceneNodeData extends BaseNodeData {
  type: "params-scene";
  content: string;
}

// --- Script & Scene Nodes ---

export type SceneTargetNodeType = "image" | "video" | "text-practicante" | "none";

export interface ScriptCharacter {
  name: string;
  description: string;
}

export interface ScriptSetting {
  name: string;
  description: string;
}

export interface ScriptGeneralInfo {
  synopsis: string;
  tone: string;
  genre: string;
  visualStyle: string;
  characters: ScriptCharacter[];
  settings: ScriptSetting[];
}

export interface ScriptSceneAnalysis {
  index: number;            // 1-based
  text: string;             // literal del guion, sin modificar
  targetNodeType: SceneTargetNodeType;
  // Versión B (casos puntuales): un segundo texto de la misma escena, con su
  // propio nodo Escena y su destino. La cadena de contexto sigue por la A.
  variantB?: { text: string; targetNodeType?: SceneTargetNodeType };
}

export interface ScriptAnalysis {
  generalInfo: ScriptGeneralInfo;
  scenes: ScriptSceneAnalysis[];
  analyzedAt: string;       // ISO timestamp
  modelUsed: string;
}

// ScriptAnalysisAlt extends ScriptAnalysis with display metadata about how the
// scenes were segmented in this alternative ("Detallada" / "Equilibrada" /
// "Compacta"). Returned by the analyzer when 3 alternatives are produced.
export interface ScriptAnalysisAlt extends ScriptAnalysis {
  label?: string;           // e.g. "Detallada", "Equilibrada", "Compacta"
  approach?: string;        // 1-line description of the segmentation criterion
}

export interface ScriptNodeData extends BaseNodeData {
  type: "script";
  prompt: string;           // el guion completo, ingresado por el usuario
  modelId?: number;
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  thinkingLevel?: string;
  // Active analysis (mirrors scriptAnalysisAlternatives[activeAnalysisIndex]).
  // "Generar escenas" (lib/script-materialize.ts) reads this field — keeping
  // it in sync makes that path agnostic to the multi-alternative feature.
  scriptAnalysis?: ScriptAnalysis;
  // Up to 3 segmentation alternatives produced by "Leer guion".
  scriptAnalysisAlternatives?: ScriptAnalysisAlt[];
  // Index into scriptAnalysisAlternatives for the alternative currently shown
  // and used when materializing scenes. Defaults to 0.
  activeAnalysisIndex?: number;
  // Si true, al materializar se conecta el output de cada nodo destino con el
  // del siguiente para mantener continuidad visual (image→image como REFERENCE,
  // image→video como FIRST_FRAME, etc.).
  linkPreviousOutput?: boolean;
  // Destino de cada escena creado por "Generar escenas" (índice → id de nodo).
  // Sin entrada se asume el id fijo `dst-<guion>-<N>` (canvas anteriores).
  sceneTargetIds?: Record<string, string>;
}

export interface SceneNodeData extends BaseNodeData {
  type: "scene";
  sceneIndex: number;       // 1-based
  totalScenes: number;
  text: string;             // texto íntegro de la escena, no editable
  scriptNodeId: string;     // referencia al nodo Guión origen
  generalInfo?: ScriptGeneralInfo; // copia self-contained para inyección de contexto
  targetNodeType?: SceneTargetNodeType;
  // Solo en escenas con versión B: "A" o "B" (sin versiones, no se define).
  variant?: "A" | "B";
}

export const MAX_SCENES_PER_SCRIPT = 30;

// --- Character Node (desarrollo de personaje por etapas) ---
// El ADN (rasgos permanentes) se escribe en el nodo; el estilo global llega
// por una entrada de texto (el mismo texto puede alimentar a varios
// Personajes) y las galerías/imágenes de referencia por otra. Cada etapa
// (edad, época…) tiene su texto y las fotos elegidas de esas galerías.
// "Generar etapas" crea un nodo imagen por etapa: al ejecutar, cada uno recibe
// de este nodo ADN + estilo + el texto de SU etapa y sus fotos (prioridad 1),
// todo leído en ese momento (vínculo vivo), más la imagen de la etapa ANTERIOR
// de la lista como referencia de continuidad: la etapa 1 se genera primero y
// es la referencia de la 2, la 2 de la 3, y así. El orden lo define el usuario.
export interface CharacterReferenceImage {
  // Nodo conectado a la entrada de galerías del que viene la foto.
  nodeId: string;
  url: string;
}

export interface CharacterStage {
  id: string;
  name: string;
  text: string;
  referenceImages?: CharacterReferenceImage[];
  // Nodo imagen creado por "Generar etapas" para esta etapa.
  imageNodeId?: string;
}

export interface CharacterNodeData extends BaseNodeData {
  type: "character";
  dna: string;
  stages: CharacterStage[];
  // Imágenes creadas alguna vez por "Generar etapas" y conexiones que puso
  // (para reconciliar al volver a generar sin tocar lo que hizo el usuario).
  generatedImageIds?: string[];
  managedEdgeIds?: string[];
  // Nombre que "Generar etapas" le puso a cada imagen (id → label). Si la
  // imagen todavía lo tiene, al regenerar se renombra con el título actual de
  // su etapa; si el usuario la renombró a mano, se respeta.
  imageLabels?: Record<string, string>;
  // true si se reordenaron etapas que ya tenían imagen: la cadena de
  // continuidad no coincide con el orden hasta volver a "Generar etapas".
  chainStale?: boolean;
  // Salida "imagen de una etapa": id de conexión → id de la etapa elegida en
  // esa conexión. Vive en el Personaje porque canvas_edges solo guarda la
  // prioridad. Sin entrada = todavía no se eligió (la conexión no entrega nada).
  imageOutputs?: Record<string, string>;
}

export const MAX_CHARACTER_STAGES = 20;

// --- Linked Node (nodo vinculado a otro canvas) ---
// Muestra, sin poder editarlo, un nodo que vive en otro canvas del mismo
// proyecto. El servidor arma una vista resuelta (todo lo que el nodo necesita
// de su canvas: estilo conectado, fotos, imágenes de etapas) y queda guardada
// en `linkSnapshot`; se actualiza al abrir el canvas y antes de ejecutar.
export type LinkedSourceType = "character" | "scene" | "image" | "video";

export interface LinkedCharacterStage {
  id: string;
  name: string;
  text: string;
  // Fotos elegidas para la etapa (de galerías todavía conectadas).
  photoUrls: string[];
  // Imagen generada de la etapa en el canvas de origen (null si no hay).
  imageUrl: string | null;
}

export interface LinkedCharacterSnapshot {
  kind: "character";
  label: string;
  dna: string;
  style: string;
  stages: LinkedCharacterStage[];
}

// Ingredientes del contexto de guion de una Escena (ver lib/scene-context.ts).
export interface SceneContextInputs {
  sceneIndex: number;
  totalScenes: number;
  // Versión de la escena ("A" / "B") cuando tiene versión B.
  variant?: "A" | "B";
  generalInfo?: ScriptGeneralInfo;
  // Escenas anteriores de la cadena, de la más antigua a la más reciente.
  previousScenes: { sceneIndex: number; text: string }[];
  // Contenido del Params Escena conectado a la escena (estilo / técnica).
  sceneParamsContent: string | null;
  // Reglas conectadas al Guión (entrada de reglas).
  rulesText: string | null;
  // Imágenes conectadas a la entrada "Galería" del Guión: van como
  // referencia a lo que genera cada escena.
  scriptImageUrls?: string[];
}

export interface LinkedSceneSnapshot {
  kind: "scene";
  label: string;
  // Nombre del Guión de origen (para mostrar).
  scriptLabel: string;
  text: string;
  context: SceneContextInputs;
}

// Imagen generada (o estática) de otro canvas: por ejemplo, el cierre del
// Acto 1 como primer fotograma del Acto 2.
export interface LinkedImageSnapshot {
  kind: "image";
  label: string;
  // null si el original todavía no tiene resultado.
  imageUrl: string | null;
  // Prompt con que se generó (solo para mostrar).
  prompt: string;
}

// Video de otro canvas (por ejemplo, para armar un montaje con los videos
// finales de cada Acto). Si es el video final de una escena, lleva cuál.
export interface LinkedVideoSnapshot {
  kind: "video";
  label: string;
  // null si el original todavía no tiene video.
  videoUrl: string | null;
  prompt: string;
  duration?: number;
  aspectRatio?: string;
  scene?: { sceneIndex: number; totalScenes: number; variant?: "A" | "B" } | null;
}

export type LinkedSnapshot = LinkedCharacterSnapshot | LinkedSceneSnapshot | LinkedImageSnapshot | LinkedVideoSnapshot;

export interface LinkUsageCanvas {
  conversationId: number;
  title: string;
  /** Nodos vinculados a este original en ese canvas. */
  linkedNodeIds: string[];
  /** Conexiones que salen de esos vinculados. */
  connections: number;
  /** Conexiones por etapa elegida (id de etapa → cantidad). */
  stageUses: Record<string, number>;
}

/** Dónde se usa cada Personaje / Escena de un canvas: id de nodo de origen → canvas que lo vinculan. */
export type LinkUsage = Record<string, LinkUsageCanvas[]>;

// ok = vista al día; deleted = el original se borró (queda la última vista);
// forbidden = sin acceso al canvas de origen (otro proyecto o sin permiso).
export type LinkState = "ok" | "deleted" | "forbidden";

export interface LinkedNodeData extends BaseNodeData {
  type: "linked";
  sourceType: LinkedSourceType;
  sourceConversationId: number;
  sourceNodeId: string;
  sourceCanvasTitle?: string;
  linkSnapshot?: LinkedSnapshot | null;
  linkHash?: string;
  linkState?: LinkState;
  linkSyncedAt?: string;
  // Etapa elegida en cada conexión (id de conexión → id de etapa), para las
  // salidas IMAGEN y PROMPT. Sin entrada: IMAGEN no entrega nada y PROMPT
  // entrega solo ADN + estilo.
  imageOutputs?: Record<string, string>;
}

// --- Union Types ---
export type CanvasNodeData = TextNodeData | TextPracticanteNodeData | ImageNodeData | VideoNodeData | NoteNodeData | StaticTextNodeData | StaticImageNodeData | StaticImageGroupNodeData | ParamsTextNodeData | ParamsImageNodeData | ParamsVideoNodeData | ParamsSceneNodeData | ScriptNodeData | SceneNodeData | CharacterNodeData | LinkedNodeData;
export type CanvasNodeType = "text" | "text-practicante" | "image" | "video" | "note" | "static-text" | "static-image" | "static-image-group" | "params-text" | "params-image" | "params-video" | "params-scene" | "script" | "scene" | "character" | "linked";

export type TextNode = Node<TextNodeData, "text">;
export type TextPracticanteNode = Node<TextPracticanteNodeData, "text-practicante">;
export type ImageNode = Node<ImageNodeData, "image">;
export type VideoNode = Node<VideoNodeData, "video">;
export type NoteNode = Node<NoteNodeData, "note">;
export type StaticTextNode = Node<StaticTextNodeData, "static-text">;
export type StaticImageNode = Node<StaticImageNodeData, "static-image">;
export type StaticImageGroupNode = Node<StaticImageGroupNodeData, "static-image-group">;
export type ParamsTextNode = Node<ParamsTextNodeData, "params-text">;
export type ParamsImageNode = Node<ParamsImageNodeData, "params-image">;
export type ParamsVideoNode = Node<ParamsVideoNodeData, "params-video">;
export type ParamsSceneNode = Node<ParamsSceneNodeData, "params-scene">;
export type ScriptNode = Node<ScriptNodeData, "script">;
export type SceneNode = Node<SceneNodeData, "scene">;
export type CharacterNode = Node<CharacterNodeData, "character">;
export type LinkedNode = Node<LinkedNodeData, "linked">;
export type CanvasNode = TextNode | TextPracticanteNode | ImageNode | VideoNode | NoteNode | StaticTextNode | StaticImageNode | StaticImageGroupNode | ParamsTextNode | ParamsImageNode | ParamsVideoNode | ParamsSceneNode | ScriptNode | SceneNode | CharacterNode | LinkedNode;

export type CanvasEdge = Edge;

// --- Handle IDs ---
export const HANDLE_IDS = {
  OUTPUT_TEXT: "output-text",
  OUTPUT_IMAGE: "output-image",
  OUTPUT_VIDEO: "output-video",
  INPUT_PROMPT: "input-prompt",
  INPUT_REFERENCE: "input-reference",
  INPUT_FIRST_FRAME: "input-first-frame",
  INPUT_LAST_FRAME: "input-last-frame",
  INPUT_MEDIA: "input-media",
  INPUT_PARAMS: "input-params",
  OUTPUT_PARAMS: "output-params",
  INPUT_SCRIPT_CHAIN: "input-script-chain",
  OUTPUT_SCRIPT_CHAIN: "output-script-chain",
  INPUT_SCENE_PARAMS: "input-scene-params",
  INPUT_VISUAL_REFERENCE: "input-visual-reference",
  INPUT_PARAMS_SCENE_REF: "input-params-scene-ref",
  INPUT_RULES: "input-rules",
  INPUT_CHARACTER_STYLE: "input-character-style",
  INPUT_CHARACTER_GALLERY: "input-character-gallery",
  OUTPUT_CHARACTER: "output-character",
  // Imagen de UNA etapa del Personaje (la conexión elige cuál, ver
  // CharacterNodeData.imageOutputs).
  OUTPUT_CHARACTER_IMAGE: "output-character-image",
  // Personaje vinculado: ADN y estilo por separado (texto).
  OUTPUT_CHARACTER_DNA: "output-character-dna",
  OUTPUT_CHARACTER_STYLE: "output-character-style",
  // Texto estático: textos que se concatenan antes del suyo.
  INPUT_TEXT_PARTS: "input-text-parts",
  // Galería y Guión: imágenes conectadas (imagen, galería, IMAGEN de etapa…).
  INPUT_GALLERY_IMAGES: "input-gallery-images",
} as const;

// Input handles are rendered twice: once on the left edge and once on the top
// edge of a node, so an edge can come in from either side. The top twin carries
// the same logical id plus this suffix so xyflow keeps a distinct DOM handle for
// it (duplicate ids would make every edge snap to whichever renders first).
// All connection/execution logic keys off the BASE id, so call `baseHandleId`
// before comparing a handle id against a HANDLE_IDS constant.
export const TOP_HANDLE_SUFFIX = "__top";

/** Build the id for the top-edge twin of an input handle. */
export function topHandleId(baseId: string): string {
  return `${baseId}${TOP_HANDLE_SUFFIX}`;
}

/** Normalize a (possibly top-positioned) handle id to its logical base id. */
export function baseHandleId(handleId: string | null | undefined): string | null {
  if (!handleId) return null;
  return handleId.endsWith(TOP_HANDLE_SUFFIX)
    ? handleId.slice(0, -TOP_HANDLE_SUFFIX.length)
    : handleId;
}

// --- IDs de nodos nuevos ---
/**
 * Id único para un nodo creado en el cliente. Antes era `node-N` con un
 * contador calculado desde los nodos vigentes: reutilizaba ids de nodos
 * borrados (soft delete), y el upsert por (id, conversation_id) reescribía esa
 * fila; y como no veía los nodos que llegan por colaboración, un nuevo editor
 * podía generar un id ya usado. Los nodos existentes conservan su id.
 */
export function newCanvasNodeId(): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `node-${Date.now().toString(36)}${rand}`;
}

// --- Default configs for new nodes ---
export function getDefaultNodeData(type: CanvasNodeType): CanvasNodeData {
  const base: BaseNodeData = {
    label: "",
    status: "idle",
  };

  switch (type) {
    case "text":
      return {
        ...base,
        type: "text",
        label: "Texto",
        prompt: "",
        temperature: 1.0,
        maxOutputTokens: 8192,
        outputAsPrompt: true,
      };
    case "text-practicante":
      return {
        ...base,
        type: "text-practicante",
        label: "Practicante",
        prompt: "",
        dryRun: false,
        outputAsPrompt: true,
      };
    case "image":
      return {
        ...base,
        type: "image",
        label: "Imagen",
        prompt: "",
        aspectRatio: "16:9",
        resolution: "1K",
        numberOfImages: 1,
      };
    case "video":
      return {
        ...base,
        type: "video",
        label: "Video",
        prompt: "",
        duration: 8,
        aspectRatio: "16:9",
        resolution: "720p",
        audioEnabled: true,
      };
    case "note":
      return {
        ...base,
        type: "note",
        label: "Nota",
        status: "completed",
        content: "",
      };
    case "static-text":
      return {
        ...base,
        type: "static-text",
        label: "Texto",
        status: "completed",
        content: "",
      };
    case "static-image":
      return {
        ...base,
        type: "static-image",
        label: "Imagen",
        status: "completed",
      };
    case "static-image-group":
      return {
        ...base,
        type: "static-image-group",
        label: "Galería",
        status: "completed",
        images: [],
      };
    case "params-text":
      return {
        ...base,
        type: "params-text",
        label: "Params Texto",
        status: "completed",
        temperature: 1.0,
        maxOutputTokens: 8192,
        outputAsPrompt: true,
      };
    case "params-image":
      return {
        ...base,
        type: "params-image",
        label: "Params Imagen",
        status: "completed",
        aspectRatio: "16:9",
        resolution: "1K",
        numberOfImages: 1,
      };
    case "params-video":
      return {
        ...base,
        type: "params-video",
        label: "Params Video",
        status: "completed",
        duration: 8,
        aspectRatio: "16:9",
        resolution: "720p",
        audioEnabled: true,
      };
    case "script":
      return {
        ...base,
        type: "script",
        label: "Guión",
        prompt: "",
        temperature: 0.4,
        maxOutputTokens: 16384,
      };
    case "scene":
      return {
        ...base,
        type: "scene",
        label: "Escena",
        status: "completed",
        sceneIndex: 1,
        totalScenes: 1,
        text: "",
        scriptNodeId: "",
        targetNodeType: "image",
      };
    case "params-scene":
      return {
        ...base,
        type: "params-scene",
        label: "Params Escena",
        status: "completed",
        content: "",
      };
    case "character":
      return {
        ...base,
        type: "character",
        label: "Personaje",
        status: "completed",
        dna: "",
        stages: [],
      };
    case "linked":
      // Se crea desde "Vincular de otro canvas", que completa el origen y la
      // vista; esto es solo el esqueleto.
      return {
        ...base,
        type: "linked",
        label: "Vinculado",
        status: "completed",
        sourceType: "character",
        sourceConversationId: 0,
        sourceNodeId: "",
      };
  }
}

// --- Canvas viewport ---
export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

// --- API response types ---
export interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

// --- Execution types ---
export type ExecutionMode = "single" | "all";

export interface ExecutionProgress {
  nodeId: string;
  status: CanvasNodeStatus;
  progress?: number;
  message?: string;
}
