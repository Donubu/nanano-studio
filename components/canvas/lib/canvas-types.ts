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
  // The materialize endpoint reads this field — keeping it in sync makes that
  // path agnostic to the multi-alternative feature.
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
}

export interface SceneNodeData extends BaseNodeData {
  type: "scene";
  sceneIndex: number;       // 1-based
  totalScenes: number;
  text: string;             // texto íntegro de la escena, no editable
  scriptNodeId: string;     // referencia al nodo Guión origen
  generalInfo?: ScriptGeneralInfo; // copia self-contained para inyección de contexto
  targetNodeType?: SceneTargetNodeType;
}

export const MAX_SCENES_PER_SCRIPT = 30;

// --- Union Types ---
export type CanvasNodeData = TextNodeData | TextPracticanteNodeData | ImageNodeData | VideoNodeData | NoteNodeData | StaticTextNodeData | StaticImageNodeData | StaticImageGroupNodeData | ParamsTextNodeData | ParamsImageNodeData | ParamsVideoNodeData | ParamsSceneNodeData | ScriptNodeData | SceneNodeData;
export type CanvasNodeType = "text" | "text-practicante" | "image" | "video" | "note" | "static-text" | "static-image" | "static-image-group" | "params-text" | "params-image" | "params-video" | "params-scene" | "script" | "scene";

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
export type CanvasNode = TextNode | TextPracticanteNode | ImageNode | VideoNode | NoteNode | StaticTextNode | StaticImageNode | StaticImageGroupNode | ParamsTextNode | ParamsImageNode | ParamsVideoNode | ParamsSceneNode | ScriptNode | SceneNode;

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
} as const;

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
