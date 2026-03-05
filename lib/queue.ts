import { Queue } from "bullmq";
import { getRedisConnection } from "./redis";

export const STREAM_QUEUE_NAME = "generation-stream";

// Job data passed from web server to worker
export interface StreamJobData {
  conversationId: string;
  userMessageId: number;
  skipUserMessage: boolean;
  content: string;

  // Model
  modelId: string;
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
    project_name: string;
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
}

// Events published by worker via Redis pub/sub
export type StreamJobEvent =
  | { type: "chunk"; text: string }
  | { type: "image"; imageUrl: string; mimeType: string; imageIndex: number }
  | { type: "grounding"; sources: unknown[]; searchEntryPointHtml?: string; webSearchQueries?: string[]; imageSearchQueries?: string[] }
  | { type: "retry"; attempt: number; maxAttempts: number; delaySeconds: number; error: string }
  | { type: "complete"; id: number; tokens: { input: number; output: number }; totalTokens: { input: number; output: number }; estimatedCost: number; totalCost: number; imageUrl: string | null; imageMessages?: Array<{ id: number; imageUrl: string }> }
  | { type: "error"; message: string; id?: number };

let streamQueue: Queue | null = null;

export function getStreamQueue(): Queue<StreamJobData> {
  if (!streamQueue) {
    streamQueue = new Queue(STREAM_QUEUE_NAME, {
      connection: getRedisConnection() as never,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
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

// Check if any workers are connected to the queue
export async function hasActiveWorkers(): Promise<boolean> {
  try {
    const redis = getRedisConnection();
    const queueNameB64 = Buffer.from(STREAM_QUEUE_NAME).toString("base64");
    const clientList = await redis.client("LIST") as string;
    return clientList
      .split("\n")
      .some((line) => line.includes(`name=bull:${queueNameB64}`) && line.includes("cmd=bzpopmin"));
  } catch {
    return false;
  }
}
