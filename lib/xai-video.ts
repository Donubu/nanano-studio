/**
 * xAI Grok Imagine Video integration
 * Supports text-to-video and image-to-video via xAI REST API
 * API docs: https://docs.x.ai/developers/model-capabilities/video/generation
 */

import { GeneratedVideo, VideoGenerationProgress } from "./google-ai-video";

const XAI_API_BASE = "https://api.x.ai/v1";

// Polling config (reuses same env vars as Google AI video)
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

export type XaiAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3";
export type XaiResolution = "480p" | "720p";

export interface XaiVideoConfig {
  duration: number; // 1-15 seconds
  aspectRatio: XaiAspectRatio;
  resolution: XaiResolution;
}

interface XaiGenerationRequest {
  model: string;
  prompt: string;
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
  video_url?: string; // For image-to-video or video editing
}

interface XaiGenerationStartResponse {
  request_id: string;
}

interface XaiVideoStatusResponse {
  status: "pending" | "done" | "expired";
  video?: {
    url: string;
    duration: number;
    respect_moderation: boolean;
  };
  model?: string;
}

// ============================================
// CONFIGURATION
// ============================================

export function isXaiVideoConfigured(): boolean {
  return !!process.env.XAI_API_KEY;
}

function getApiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not configured");
  return key;
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

export async function generateXaiVideo(
  modelId: string,
  prompt: string,
  config: XaiVideoConfig,
  onProgress?: (progress: VideoGenerationProgress) => void,
  imageUrl?: string,
): Promise<GeneratedVideo> {
  const apiKey = getApiKey();

  onProgress?.({
    status: "pending",
    message: "Iniciando generacion de video con xAI...",
  });

  // Step 1: Start video generation
  const requestBody: XaiGenerationRequest = {
    model: modelId,
    prompt,
    duration: config.duration,
    aspect_ratio: config.aspectRatio,
    resolution: config.resolution,
  };

  // Image-to-video: pass image URL
  if (imageUrl) {
    requestBody.video_url = imageUrl;
  }

  onProgress?.({
    status: "processing",
    message: "Enviando solicitud a xAI...",
    progress: 10,
  });

  let requestId: string;
  let retryDelay = RETRY_CONFIG.initialDelayMs;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    const response = await fetch(`${XAI_API_BASE}/videos/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      const data: XaiGenerationStartResponse = await response.json();
      requestId = data.request_id;
      break;
    }

    if (!isRetriableStatus(response.status) || attempt === RETRY_CONFIG.maxRetries) {
      const errorText = await response.text();
      throw new Error(`xAI video generation failed (${response.status}): ${errorText}`);
    }

    console.warn(
      `[xAI Video] Generation request failed (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}). ` +
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

  console.log(`[xAI Video] Generation started. request_id: ${requestId!}`);

  // Step 2: Poll for completion
  onProgress?.({
    status: "processing",
    message: "Video en cola de generacion...",
    progress: 20,
  });

  const video = await pollXaiVideoStatus(requestId!, apiKey, config, onProgress);
  return video;
}

// ============================================
// POLLING
// ============================================

async function pollXaiVideoStatus(
  requestId: string,
  apiKey: string,
  config: XaiVideoConfig,
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
      throw new Error(`xAI video generation timed out after ${timeoutMinutes} minutes`);
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
      const response = await fetch(`${XAI_API_BASE}/videos/${requestId}`, {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        console.error(`[xAI Video] Poll #${pollCount} failed: ${response.status}`);
        continue;
      }

      const data: XaiVideoStatusResponse = await response.json();
      console.log(`[xAI Video] Poll #${pollCount} (${elapsedMinutes} min) - status=${data.status}`);

      if (data.status === "expired") {
        throw new Error("xAI video generation request expired");
      }

      if (data.status === "done" && data.video) {
        onProgress?.({
          status: "completed",
          message: "Video generado, descargando...",
          progress: 95,
        });

        // Download the video from the temporary URL
        const videoResponse = await fetch(data.video.url);
        if (!videoResponse.ok) {
          throw new Error(`Failed to download xAI video: ${videoResponse.statusText}`);
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
          duration: data.video.duration || config.duration,
          hasAudio: false, // xAI does not generate audio
          seed: 0, // xAI does not return seed
        };
      }
    } catch (error) {
      if (error instanceof Error && (
        error.message.includes("expired") ||
        error.message.includes("timed out") ||
        error.message.includes("Failed to download")
      )) {
        throw error;
      }
      console.error(`[xAI Video] Poll #${pollCount} error:`, error);
    }
  }
}

// ============================================
// VALIDATION
// ============================================

const VALID_ASPECT_RATIOS: XaiAspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
const VALID_RESOLUTIONS: XaiResolution[] = ["480p", "720p"];

export function validateXaiVideoConfig(config: XaiVideoConfig): string | null {
  if (config.duration < 1 || config.duration > 15) {
    return "La duracion debe ser entre 1 y 15 segundos";
  }

  if (!VALID_ASPECT_RATIOS.includes(config.aspectRatio)) {
    return `Aspect ratio invalido. Debe ser: ${VALID_ASPECT_RATIOS.join(", ")}`;
  }

  if (!VALID_RESOLUTIONS.includes(config.resolution)) {
    return `Resolucion invalida. Debe ser: ${VALID_RESOLUTIONS.join(", ")}`;
  }

  return null;
}
