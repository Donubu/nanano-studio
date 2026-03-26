import type { Node, Edge, BuiltInNode } from "@xyflow/react";

// --- Node Status ---
export type CanvasNodeStatus = "idle" | "generating" | "completed" | "error";

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

// --- Union Types ---
export type CanvasNodeData = TextNodeData | ImageNodeData | VideoNodeData | NoteNodeData | StaticTextNodeData | StaticImageNodeData | StaticImageGroupNodeData | ParamsTextNodeData | ParamsImageNodeData | ParamsVideoNodeData;
export type CanvasNodeType = "text" | "image" | "video" | "note" | "static-text" | "static-image" | "static-image-group" | "params-text" | "params-image" | "params-video";

export type TextNode = Node<TextNodeData, "text">;
export type ImageNode = Node<ImageNodeData, "image">;
export type VideoNode = Node<VideoNodeData, "video">;
export type NoteNode = Node<NoteNodeData, "note">;
export type StaticTextNode = Node<StaticTextNodeData, "static-text">;
export type StaticImageNode = Node<StaticImageNodeData, "static-image">;
export type StaticImageGroupNode = Node<StaticImageGroupNodeData, "static-image-group">;
export type ParamsTextNode = Node<ParamsTextNodeData, "params-text">;
export type ParamsImageNode = Node<ParamsImageNodeData, "params-image">;
export type ParamsVideoNode = Node<ParamsVideoNodeData, "params-video">;
export type CanvasNode = TextNode | ImageNode | VideoNode | NoteNode | StaticTextNode | StaticImageNode | StaticImageGroupNode | ParamsTextNode | ParamsImageNode | ParamsVideoNode;

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
