import { Queue } from "bullmq";
import { getRedisConnection } from "./redis";

export const STREAM_QUEUE_NAME = "generation-stream";

// Job data passed from web server to worker
export interface StreamJobData {
  conversationId: string;
  userMessageId: number;
  userId: number;
  skipUserMessage: boolean;
  content: string;

  // Model
  modelId: string;
  modelDbId?: number | null;
  backend?: string;
  generationType: string;
  qualityTier: "normal" | "hq";

  // Generation config
  systemInstruction?: string;
  settings: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    imageConfig?: {
      aspectRatio?: string;
      imageSize?: string;
    };
    googleSearchEnabled?: boolean;
    googleImageSearchEnabled?: boolean;
    thinkingLevel?: "none" | "low" | "medium" | "high";
    includeThoughts?: boolean;
  };

  // Messages to send to Google AI
  messages: Array<{
    role: string;
    content: string;
    imageUrl?: string;
    imageMimeType?: string;
    files?: Array<{
      dataUrl: string;
      mimeType: string;
      name?: string;
      type: string;
    }>;
  }>;

  // Metadata
  labels: {
    project_name: string; // May include client prefix: "ClientName > ProjectName"
    user_name: string;
  };
  needsTitle: boolean;

  // Cost calculation
  effectiveCosts: {
    cost_input_per_million: number;
    cost_output_per_million: number;
    cost_image_1k: number;
    cost_image_2k: number;
    cost_image_4k: number;
    cost_video_per_second: number;
  };
  effectiveImageAspectRatio?: string;
  effectiveImageSize?: string;

  // Set by worker when processing
  workerName?: string;
}

// Events published by worker via Redis pub/sub
export type StreamJobEvent =
  | { type: "chunk"; text: string }
  | { type: "thought"; text: string }
  | { type: "image"; imageUrl: string; mimeType: string; imageIndex: number }
  | { type: "grounding"; sources: unknown[]; searchEntryPointHtml?: string; webSearchQueries?: string[]; imageSearchQueries?: string[] }
  | { type: "retry"; attempt: number; maxAttempts: number; delaySeconds: number; error: string }
  | { type: "title"; title: string }
  | { type: "complete"; id: number; tokens: { input: number; output: number }; totalTokens: { input: number; output: number }; estimatedCost: number; totalCost: number; imageUrl: string | null; imageMessages?: Array<{ id: number; imageUrl: string }> }
  | { type: "error"; message: string; id?: number };

// ============================================
// IMAGEN QUEUE (Imagen 4 image generation)
// ============================================

export const IMAGEN_QUEUE_NAME = "generation-imagen";

export interface ImagenJobData {
  conversationId: string;
  userMessageId: number;
  userId: number;
  content: string;

  // Model
  modelId: string;
  modelDbId: number;
  backend?: string;
  qualityTier: "normal" | "hq";

  // Image generation config
  aspectRatio: string;
  resolution: string;
  negativePrompt?: string;
  numberOfImages: number;
  seed?: number;
  referenceImageUrls?: string[];

  // Metadata
  labels: {
    project_name: string; // May include client prefix: "ClientName > ProjectName"
    user_name: string;
  };
  needsTitle: boolean;

  // Cost
  costImage1k: number;
  costImage2k: number;
  costImage4k: number;

  // Placeholder message IDs (created by API before queuing)
  placeholderIds: number[];

  // Set by worker when processing
  workerName?: string;
}

export type ImagenJobEvent =
  | { type: "image"; imageUrl: string; mimeType: string; seed?: number; estimatedCost: number; imageIndex: number }
  | { type: "retry"; attempt: number; maxAttempts: number; delaySeconds: number }
  | { type: "title"; title: string }
  | { type: "complete"; id: number; imageUrl: string; seed?: number; estimatedCost: number; imageMessages: Array<{ id: number; imageUrl: string }> }
  | { type: "error"; message: string; id?: number };

let imagenQueue: Queue | null = null;

export function getImagenQueue(): Queue<ImagenJobData> {
  if (!imagenQueue) {
    imagenQueue = new Queue(IMAGEN_QUEUE_NAME, {
      connection: getRedisConnection() as never,
      defaultJobOptions: {
        removeOnComplete: 20,
        removeOnFail: 20,
        attempts: 1,
      },
    });
  }
  return imagenQueue;
}

// ============================================

let streamQueue: Queue | null = null;

export function getStreamQueue(): Queue<StreamJobData> {
  if (!streamQueue) {
    streamQueue = new Queue(STREAM_QUEUE_NAME, {
      connection: getRedisConnection() as never,
      defaultJobOptions: {
        removeOnComplete: 20,
        removeOnFail: 20,
        attempts: 1, // No auto-retry at queue level (we have retry logic in google-ai.ts)
      },
    });
  }
  return streamQueue;
}

// Pub/sub channel for a specific job
export function jobChannel(jobId: string): string {
  return `gen:${jobId}`;
}

// Check if any workers are connected to a queue
export async function hasActiveWorkers(queueName: string = STREAM_QUEUE_NAME): Promise<boolean> {
  try {
    const redis = getRedisConnection();
    const queueNameB64 = Buffer.from(queueName).toString("base64");
    const clientList = await redis.client("LIST") as string;
    return clientList
      .split("\n")
      .some((line) => line.includes(`name=bull:${queueNameB64}`) && line.includes("cmd=bzpopmin"));
  } catch {
    return false;
  }
}
