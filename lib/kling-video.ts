/**
 * Kling v3 Omni Video integration
 * Supports text-to-video and image-to-video via Kling REST API
 * API: POST /v1/videos/omni-video (create) + GET /v1/videos/omni-video/{taskId} (poll)
 */

import { GeneratedVideo, VideoGenerationProgress } from "./google-ai-video";
import { KLING_API_BASE, getKlingAuthToken, isKlingConfigured } from "./kling-auth";

export { isKlingConfigured };

// Polling config (reuses same env vars as other video providers)
const POLLING_CONFIG = {
  initialDelayMs: Number(process.env.VIDEO_POLLING_INITIAL_DELAY_MS) || 5000,
  maxDelayMs: Number(process.env.VIDEO_POLLING_MAX_DELAY_MS) || 30000,
  backoffMultiplier: Number(process.env.VIDEO_POLLING_BACKOFF_MULTIPLIER) || 1.5,
  maxDurationMs: Number(process.env.VIDEO_GENERATION_TIMEOUT_MS) || 900000,
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================
// TYPES
// ============================================

export type KlingVideoAspectRatio = "16:9" | "9:16" | "1:1";
export type KlingVideoMode = "std" | "pro";

export interface KlingVideoConfig {
  duration: number; // 3-15 seconds
  aspectRatio: KlingVideoAspectRatio;
  mode: KlingVideoMode; // std = 720p, pro = 1080p
  negativePrompt?: string;
  cfgScale?: number; // 0-1
  generateAudio?: boolean;
}

export interface KlingImageInput {
  url: string;
  type?: "first_frame" | "end_frame"; // undefined = reference image
}

interface KlingTaskResponse {
  code: number;
  message: string;
  request_id?: string;
  data: {
    task_id: string;
    task_status: "submitted" | "processing" | "succeed" | "failed";
    task_status_msg?: string;
    task_result?: {
      videos?: Array<{
        id: string;
        url: string;
        duration: string;
      }>;
    };
  };
}

// ============================================
// RETRY LOGIC
// ============================================

const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 5000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

function isRetriableStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 500 || status === 502;
}

// ============================================
// MAIN GENERATION FUNCTION
// ============================================

export async function generateKlingVideo(
  modelId: string,
  prompt: string,
  config: KlingVideoConfig,
  onProgress?: (progress: VideoGenerationProgress) => void,
  images?: KlingImageInput[],
): Promise<GeneratedVideo> {

  onProgress?.({
    status: "pending",
    message: "Iniciando generacion de video con Kling...",
  });

  // Build request body
  const requestBody: Record<string, unknown> = {
    model_name: modelId,
    prompt,
    duration: String(config.duration),
    aspect_ratio: config.aspectRatio,
    mode: config.mode,
  };

  if (config.negativePrompt) {
    requestBody.negative_prompt = config.negativePrompt;
  }
  if (config.cfgScale !== undefined) {
    requestBody.cfg_scale = config.cfgScale;
  }
  // sound: "on" or "off" (not generate_audio)
  requestBody.sound = config.generateAudio ? "on" : "off";

  // Images: first_frame, end_frame, or reference images
  // Format: array of { image_url, type? } objects
  if (images && images.length > 0) {
    requestBody.image_list = images.map(img => {
      const entry: Record<string, string> = { image_url: img.url };
      if (img.type) {
        entry.type = img.type;
      }
      return entry;
    });
    console.log(`[Kling Video] ${images.length} image(s): ${images.map(i => i.type || "reference").join(", ")}`);
  }

  console.log("[Kling Video] Request:", JSON.stringify({ ...requestBody, image_list: images?.length || 0 }, null, 2));

  onProgress?.({
    status: "processing",
    message: "Enviando solicitud a Kling...",
    progress: 10,
  });

  // Step 1: Create task with retry
  let taskId: string;
  let retryDelay = RETRY_CONFIG.initialDelayMs;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    const token = await getKlingAuthToken();

    const response = await fetch(`${KLING_API_BASE}/v1/videos/omni-video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      const data: KlingTaskResponse = await response.json();
      if (data.code !== 0) {
        throw new Error(`Kling API error: ${data.message} (code ${data.code})`);
      }
      taskId = data.data.task_id;
      break;
    }

    if (!isRetriableStatus(response.status) || attempt === RETRY_CONFIG.maxRetries) {
      const errorText = await response.text();
      throw new Error(`Kling video generation failed (${response.status}): ${errorText}`);
    }

    console.warn(
      `[Kling Video] Request failed (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}). ` +
      `Retrying in ${retryDelay / 1000}s... Status: ${response.status}`
    );

    onProgress?.({
      status: "processing",
      message: `Reintentando (${attempt + 1}/${RETRY_CONFIG.maxRetries + 1})...`,
      progress: 5,
    });

    await sleep(retryDelay);
    retryDelay = Math.min(retryDelay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs);
  }

  console.log(`[Kling Video] Task created: ${taskId!}`);

  // Step 2: Poll for completion
  onProgress?.({
    status: "processing",
    message: "Video en cola de generacion...",
    progress: 20,
  });

  const video = await pollKlingVideoStatus(taskId!, config, onProgress);
  return video;
}

// ============================================
// POLLING
// ============================================

async function pollKlingVideoStatus(
  taskId: string,
  config: KlingVideoConfig,
  onProgress?: (progress: VideoGenerationProgress) => void,
): Promise<GeneratedVideo> {
  const startTime = Date.now();
  let progressPercent = 20;
  let pollCount = 0;
  let pollDelay = POLLING_CONFIG.initialDelayMs;

  while (true) {
    pollCount++;
    const elapsedMs = Date.now() - startTime;
    const elapsedMinutes = (elapsedMs / 60000).toFixed(1);

    if (elapsedMs > POLLING_CONFIG.maxDurationMs) {
      const timeoutMinutes = Math.round(POLLING_CONFIG.maxDurationMs / 60000);
      throw new Error(`Kling video generation timed out after ${timeoutMinutes} minutes`);
    }

    await sleep(pollDelay);
    pollDelay = Math.min(pollDelay * POLLING_CONFIG.backoffMultiplier, POLLING_CONFIG.maxDelayMs);

    progressPercent = Math.min(progressPercent + 2, 90);

    onProgress?.({
      status: "processing",
      message: `Generando video... (${elapsedMinutes} min)`,
      progress: progressPercent,
    });

    try {
      const token = await getKlingAuthToken();

      const response = await fetch(`${KLING_API_BASE}/v1/videos/omni-video/${taskId}`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error(`[Kling Video] Poll #${pollCount} failed: ${response.status}`);
        continue;
      }

      const data: KlingTaskResponse = await response.json();
      console.log(`[Kling Video] Poll #${pollCount} (${elapsedMinutes} min) - status=${data.data.task_status}`);

      if (data.data.task_status === "failed") {
        throw new Error(`Kling video generation failed: ${data.data.task_status_msg || "Unknown error"}`);
      }

      if (data.data.task_status === "succeed" && data.data.task_result?.videos?.length) {
        const video = data.data.task_result.videos[0];

        onProgress?.({
          status: "completed",
          message: "Video generado, descargando...",
          progress: 95,
        });

        // Download the video from Kling's URL
        const videoResponse = await fetch(video.url);
        if (!videoResponse.ok) {
          throw new Error(`Failed to download Kling video: ${videoResponse.statusText}`);
        }

        const arrayBuffer = await videoResponse.arrayBuffer();
        const videoData = Buffer.from(arrayBuffer);

        onProgress?.({
          status: "completed",
          message: "Video generado exitosamente",
          progress: 100,
        });

        return {
          data: videoData,
          mimeType: "video/mp4",
          duration: Number(video.duration) || config.duration,
          hasAudio: config.generateAudio || false,
          seed: 0, // Kling does not return seeds
        };
      }
    } catch (error) {
      if (error instanceof Error && (
        error.message.includes("timed out") ||
        error.message.includes("Failed to download") ||
        error.message.includes("generation failed")
      )) {
        throw error;
      }
      console.error(`[Kling Video] Poll #${pollCount} error:`, error);
    }
  }
}

// ============================================
// VALIDATION
// ============================================

const VALID_ASPECT_RATIOS: KlingVideoAspectRatio[] = ["16:9", "9:16", "1:1"];
const VALID_MODES: KlingVideoMode[] = ["std", "pro"];

export function validateKlingVideoConfig(config: KlingVideoConfig): string | null {
  if (config.duration < 3 || config.duration > 15) {
    return "La duracion debe ser entre 3 y 15 segundos";
  }

  if (!VALID_ASPECT_RATIOS.includes(config.aspectRatio)) {
    return `Aspect ratio invalido. Debe ser: ${VALID_ASPECT_RATIOS.join(", ")}`;
  }

  if (!VALID_MODES.includes(config.mode)) {
    return `Modo invalido. Debe ser: ${VALID_MODES.join(", ")}`;
  }

  if (config.cfgScale !== undefined && (config.cfgScale < 0 || config.cfgScale > 1)) {
    return "cfg_scale debe ser entre 0 y 1";
  }

  return null;
}
