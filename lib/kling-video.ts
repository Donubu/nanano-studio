/**
 * Kling Video integration (v3 Omni + v2.6)
 * Supports text-to-video and image-to-video via Kling REST API
 *
 * v3 Omni: POST /v1/videos/omni-video (unified endpoint, image_list, voice_list)
 * v2.6:    POST /v1/videos/text2video  (text-only, no image_list)
 *          POST /v1/videos/image2video  (with image/image_tail fields)
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
  duration: number;
  aspectRatio: KlingVideoAspectRatio;
  mode: KlingVideoMode; // std = 720p, pro = 1080p
  negativePrompt?: string;
  cfgScale?: number; // 0-1 (v3 only, v2.x does not support)
  generateAudio?: boolean;
  voiceBindings?: Record<string, string>; // assetId → URL of voice reference audio (v3 only)
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
// VERSION HELPERS
// ============================================

/** Check if model is a legacy (pre-omni) version that uses text2video/image2video endpoints */
function isLegacyModel(modelId: string): boolean {
  return !modelId.includes("omni") && !modelId.includes("v3");
}

/** Get the correct API endpoints based on model version and whether images are provided */
function getKlingEndpoints(modelId: string, hasImages: boolean): { create: string; poll: string } {
  if (isLegacyModel(modelId)) {
    const path = hasImages ? "image2video" : "text2video";
    return {
      create: `/v1/videos/${path}`,
      poll: `/v1/videos/${path}`,
    };
  }
  return {
    create: "/v1/videos/omni-video",
    poll: "/v1/videos/omni-video",
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
  videoUrl?: string,
): Promise<GeneratedVideo> {

  onProgress?.({
    status: "pending",
    message: "Iniciando generacion de video con Kling...",
  });

  const legacy = isLegacyModel(modelId);
  const hasImages = !!(images && images.length > 0);
  const hasMedia = hasImages || !!videoUrl;
  const endpoints = getKlingEndpoints(modelId, hasMedia);

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

  // cfg_scale: v2.x models do not support this parameter
  if (!legacy && config.cfgScale !== undefined) {
    requestBody.cfg_scale = config.cfgScale;
  }

  // sound: "on" or "off" — supported on v2.6+
  // v2.6: audio only supported in pro mode, force off for std
  if (legacy && config.mode === "std" && config.generateAudio) {
    console.log("[Kling Video v2.6] Forcing audio off - not supported in std mode");
    config.generateAudio = false;
  }
  requestBody.sound = config.generateAudio ? "on" : "off";

  if (legacy) {
    // ===== Legacy endpoints (v2.6, etc.) =====
    if (hasImages) {
      // image2video: uses `image` (first frame) and `image_tail` (end frame) as separate fields
      const firstFrame = images!.find(i => i.type === "first_frame");
      const endFrame = images!.find(i => i.type === "end_frame");
      // If no typed frames, use first image as the main image input
      const mainImage = firstFrame || images![0];
      if (mainImage) {
        requestBody.image = mainImage.url;
      }
      if (endFrame) {
        requestBody.image_tail = endFrame.url;
      }
      console.log(`[Kling Video v2.6] image2video - image: ${!!mainImage}, image_tail: ${!!endFrame}`);
    }
    // Legacy does not support voice_list or image_list array format
  } else {
    // ===== Omni endpoint (v3+) =====

    // Per-asset voice bindings for voice cloning
    if (config.voiceBindings && Object.keys(config.voiceBindings).length > 0) {
      const voiceList = Object.entries(config.voiceBindings).map(([assetId, url]) => {
        const idx = parseInt(assetId.replace("asset", ""), 10) - 1; // 0-based index
        return { image_index: idx, voice_url: url };
      });
      requestBody.voice_list = voiceList;
      console.log(`[Kling Video] ${voiceList.length} voice binding(s) for assets: ${Object.keys(config.voiceBindings).join(", ")}`);
    }

    // Images: first_frame, end_frame, or reference images as image_list array
    if (hasImages) {
      requestBody.image_list = images!.map(img => {
        const entry: Record<string, string> = { image_url: img.url };
        if (img.type) {
          entry.type = img.type;
        }
        return entry;
      });
      console.log(`[Kling Video] ${images!.length} image(s): ${images!.map(i => i.type || "reference").join(", ")}`);
    }

    // Video input: video_url for video-to-video (v3 Omni only)
    if (videoUrl) {
      requestBody.video_url = videoUrl;
      console.log(`[Kling Video] video_url set for video-to-video`);
    }
  }

  const versionLabel = legacy ? "v2.6" : "v3";
  console.log(`[Kling Video ${versionLabel}] Endpoint: ${endpoints.create}`);
  console.log(`[Kling Video ${versionLabel}] Request:`, JSON.stringify({ ...requestBody, image: requestBody.image ? "(set)" : undefined, image_list: hasImages && !legacy ? images!.length : undefined }, null, 2));

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

    const response = await fetch(`${KLING_API_BASE}${endpoints.create}`, {
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

  console.log(`[Kling Video ${versionLabel}] Task created: ${taskId!}`);

  // Step 2: Poll for completion
  onProgress?.({
    status: "processing",
    message: "Video en cola de generacion...",
    progress: 20,
  });

  const video = await pollKlingVideoStatus(taskId!, endpoints.poll, config, onProgress);
  return video;
}

// ============================================
// POLLING
// ============================================

async function pollKlingVideoStatus(
  taskId: string,
  pollPath: string,
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

      const response = await fetch(`${KLING_API_BASE}${pollPath}/${taskId}`, {
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

export function validateKlingVideoConfig(config: KlingVideoConfig, modelId?: string): string | null {
  const legacy = modelId ? isLegacyModel(modelId) : false;

  if (legacy) {
    // v2.6: only 5 or 10 seconds
    if (config.duration !== 5 && config.duration !== 10) {
      return "La duracion debe ser 5 o 10 segundos para Kling v2.6";
    }
  } else {
    if (config.duration < 3 || config.duration > 15) {
      return "La duracion debe ser entre 3 y 15 segundos";
    }
  }

  if (!VALID_ASPECT_RATIOS.includes(config.aspectRatio)) {
    return `Aspect ratio invalido. Debe ser: ${VALID_ASPECT_RATIOS.join(", ")}`;
  }

  if (!VALID_MODES.includes(config.mode)) {
    return `Modo invalido. Debe ser: ${VALID_MODES.join(", ")}`;
  }

  // cfg_scale not supported on v2.x
  if (!legacy && config.cfgScale !== undefined && (config.cfgScale < 0 || config.cfgScale > 1)) {
    return "cfg_scale debe ser entre 0 y 1";
  }

  return null;
}
