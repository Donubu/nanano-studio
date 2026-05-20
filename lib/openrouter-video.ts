/**
 * OpenRouter video generation integration.
 *
 * Endpoint: POST https://openrouter.ai/api/v1/videos (async submit + polling)
 * Submit response:  { id, polling_url }
 * Poll response:    { status, unsigned_urls?, error? }
 *
 * Currently used for ByteDance Seedance 2.0 and 2.0-fast. Other OpenRouter
 * video models with the same submit/poll shape should plug in here too.
 *
 * Pricing for Seedance follows tokens = (w * h * d * 24) / 1024, multiplied
 * by the per-token rate. We compute it locally and return it via
 * GeneratedVideo.actualCost so the route can persist the precise number.
 */

import { GeneratedVideo, VideoGenerationProgress, ReferenceImageInput } from "./google-ai-video";

const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";

const POLLING_CONFIG = {
  initialDelayMs: Number(process.env.VIDEO_POLLING_INITIAL_DELAY_MS) || 5000,
  maxDelayMs: Number(process.env.VIDEO_POLLING_MAX_DELAY_MS) || 30000,
  backoffMultiplier: Number(process.env.VIDEO_POLLING_BACKOFF_MULTIPLIER) || 1.5,
  maxDurationMs: Number(process.env.VIDEO_GENERATION_TIMEOUT_MS) || 900000,
};

const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 5000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================
// TYPES
// ============================================

export type OpenRouterAspectRatio = "1:1" | "3:4" | "9:16" | "4:3" | "16:9" | "21:9" | "9:21";
export type OpenRouterResolution = "480p" | "720p" | "1080p";

export interface OpenRouterVideoConfig {
  duration: number; // integer 4..15
  aspectRatio: OpenRouterAspectRatio;
  resolution: OpenRouterResolution;
  generateAudio?: boolean;
  seed?: number;
  negativePrompt?: string;
}

export interface OpenRouterImageInputs {
  firstFrame?: string;       // public URL (route uploads base64 to S3 first)
  lastFrame?: string;        // public URL
  referenceImages?: ReferenceImageInput[];
}

interface OpenRouterUsage {
  cost?: number | null;
  is_byok?: boolean;
}

interface OpenRouterSubmitResponse {
  id: string;
  polling_url: string;
  status?: string;
  generation_id?: string;
}

interface OpenRouterPollResponse {
  id?: string;
  status: string;            // pending | in_progress | completed | failed | cancelled | expired
  generation_id?: string;
  unsigned_urls?: string[];
  usage?: OpenRouterUsage;
  error?: string;
}

// ============================================
// CONFIGURATION
// ============================================

export function isOpenRouterConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");
  return key;
}

function isRetriableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503;
}

// ============================================
// PRICING
// ============================================

// Per-token USD rates from OpenRouter model metadata (pricing_skus.video_tokens).
const SEEDANCE_PRICING_PER_TOKEN: Record<string, number> = {
  "bytedance/seedance-2.0": 0.000007,
  "bytedance/seedance-2.0-fast": 0.0000056,
};

// (aspectRatio, resolution) -> (width, height). Picks the canonical size from
// Seedance's supported_sizes list. Used to compute token count; the actual
// pixel dimensions the model produces match these.
const SEEDANCE_DIMENSIONS: Record<OpenRouterResolution, Partial<Record<OpenRouterAspectRatio, [number, number]>>> = {
  "480p": {
    "1:1": [480, 480],
    "3:4": [480, 640],
    "9:16": [480, 854],
    "4:3": [640, 480],
    "16:9": [854, 480],
    "21:9": [1120, 480],
    "9:21": [480, 1120],
  },
  "720p": {
    "1:1": [720, 720],
    "3:4": [720, 960],
    "9:16": [720, 1280],
    "4:3": [960, 720],
    "16:9": [1280, 720],
    "21:9": [1680, 720],
    "9:21": [720, 1680],
  },
  "1080p": {
    "1:1": [1080, 1080],
    "3:4": [1080, 1440],
    "9:16": [1080, 1920],
    "4:3": [1440, 1080],
    "16:9": [1920, 1080],
    "21:9": [2520, 1080],
    "9:21": [1080, 2520],
  },
};

function resolveDimensions(resolution: OpenRouterResolution, aspectRatio: OpenRouterAspectRatio): [number, number] {
  const dims = SEEDANCE_DIMENSIONS[resolution]?.[aspectRatio];
  if (dims) return dims;
  // Fallback: assume worst-case 16:9 at the requested resolution. Keeps cost
  // estimate conservative if a future aspect ratio slips through validation.
  return SEEDANCE_DIMENSIONS[resolution]["16:9"] ?? [1280, 720];
}

export function computeSeedanceCost(
  modelId: string,
  width: number,
  height: number,
  durationSeconds: number,
): number {
  const rate = SEEDANCE_PRICING_PER_TOKEN[modelId];
  if (!rate) return 0;
  const tokens = (width * height * durationSeconds * 24) / 1024;
  return Number((tokens * rate).toFixed(6));
}

// ============================================
// VALIDATION
// ============================================

const VALID_ASPECT_RATIOS: OpenRouterAspectRatio[] = ["1:1", "3:4", "9:16", "4:3", "16:9", "21:9", "9:21"];

export function validateOpenRouterVideoConfig(config: OpenRouterVideoConfig, modelId: string): string | null {
  if (!Number.isInteger(config.duration) || config.duration < 4 || config.duration > 15) {
    return "La duración debe ser un entero entre 4 y 15 segundos";
  }
  if (!VALID_ASPECT_RATIOS.includes(config.aspectRatio)) {
    return `Aspect ratio inválido. Debe ser uno de: ${VALID_ASPECT_RATIOS.join(", ")}`;
  }
  const isFast = modelId === "bytedance/seedance-2.0-fast";
  const allowedResolutions: OpenRouterResolution[] = isFast ? ["480p", "720p"] : ["480p", "720p", "1080p"];
  if (!allowedResolutions.includes(config.resolution)) {
    return `Resolución inválida para ${modelId}. Permitidas: ${allowedResolutions.join(", ")}`;
  }
  return null;
}

// ============================================
// MAIN GENERATION FUNCTION
// ============================================

export async function generateOpenRouterVideo(
  modelId: string,
  prompt: string,
  config: OpenRouterVideoConfig,
  onProgress?: (progress: VideoGenerationProgress) => void,
  imageInputs?: OpenRouterImageInputs,
): Promise<GeneratedVideo> {
  const apiKey = getApiKey();

  onProgress?.({
    status: "pending",
    message: "Iniciando generación de video con OpenRouter...",
  });

  const requestBody: Record<string, unknown> = {
    model: modelId,
    prompt,
    duration: config.duration,
    aspect_ratio: config.aspectRatio,
    resolution: config.resolution,
  };
  if (typeof config.seed === "number") requestBody.seed = config.seed;
  if (typeof config.generateAudio === "boolean") requestBody.generate_audio = config.generateAudio;
  // Note: negative_prompt is not a documented top-level field for OpenRouter's
  // /videos endpoint. If a provider supports it, it would go under
  // provider.options.{provider-slug}. Currently dropped silently.

  const frameImages: Array<Record<string, unknown>> = [];
  if (imageInputs?.firstFrame) {
    frameImages.push({
      type: "image_url",
      image_url: { url: imageInputs.firstFrame },
      frame_type: "first_frame",
    });
  }
  if (imageInputs?.lastFrame) {
    frameImages.push({
      type: "image_url",
      image_url: { url: imageInputs.lastFrame },
      frame_type: "last_frame",
    });
  }
  if (frameImages.length > 0) requestBody.frame_images = frameImages;

  if (imageInputs?.referenceImages && imageInputs.referenceImages.length > 0) {
    requestBody.input_references = imageInputs.referenceImages.map(r => ({
      type: "image_url",
      image_url: { url: r.image },
    }));
  }

  console.log("[OpenRouter Video] Submit body keys:", Object.keys(requestBody).join(", "));

  onProgress?.({
    status: "processing",
    message: "Enviando solicitud a OpenRouter...",
    progress: 10,
  });

  let submitData: OpenRouterSubmitResponse | undefined;
  let retryDelay = RETRY_CONFIG.initialDelayMs;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    const response = await fetch(`${OPENROUTER_API_BASE}/videos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      submitData = await response.json();
      break;
    }

    if (!isRetriableStatus(response.status) || attempt === RETRY_CONFIG.maxRetries) {
      const errorText = await response.text();
      throw new Error(`OpenRouter video submit failed (${response.status}): ${errorText}`);
    }

    console.warn(
      `[OpenRouter Video] Submit failed (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}). ` +
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

  if (!submitData?.id || !submitData?.polling_url) {
    throw new Error("OpenRouter submit returned no id/polling_url");
  }

  console.log(`[OpenRouter Video] Submitted. id=${submitData.id} polling=${submitData.polling_url}`);

  onProgress?.({
    status: "processing",
    message: "Video en cola de generación...",
    progress: 20,
  });

  return pollAndDownloadOpenRouterVideo(submitData.id, submitData.polling_url, apiKey, modelId, config, onProgress);
}

// ============================================
// POLLING + DOWNLOAD
// ============================================

const TERMINAL_FAILURE_STATUSES = new Set(["failed", "cancelled", "expired"]);

async function pollAndDownloadOpenRouterVideo(
  jobId: string,
  pollingUrl: string,
  apiKey: string,
  modelId: string,
  config: OpenRouterVideoConfig,
  onProgress?: (progress: VideoGenerationProgress) => void,
): Promise<GeneratedVideo> {
  const startTime = Date.now();
  let pollDelay = POLLING_CONFIG.initialDelayMs;
  let progressPercent = 20;
  let pollCount = 0;
  let reportedUsageCost: number | undefined;

  while (true) {
    pollCount++;
    const elapsedMs = Date.now() - startTime;
    const elapsedMinutes = (elapsedMs / 60000).toFixed(1);

    if (elapsedMs > POLLING_CONFIG.maxDurationMs) {
      const timeoutMinutes = Math.round(POLLING_CONFIG.maxDurationMs / 60000);
      throw new Error(`OpenRouter video generation timed out after ${timeoutMinutes} minutes`);
    }

    await sleep(pollDelay);
    pollDelay = Math.min(pollDelay * POLLING_CONFIG.backoffMultiplier, POLLING_CONFIG.maxDelayMs);

    progressPercent = Math.min(progressPercent + 2, 90);
    onProgress?.({
      status: "processing",
      message: `Generando video... (${elapsedMinutes} min)`,
      progress: progressPercent,
    });

    let pollData: OpenRouterPollResponse | undefined;
    try {
      const response = await fetch(pollingUrl, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        console.error(`[OpenRouter Video] Poll #${pollCount} HTTP ${response.status}`);
        continue;
      }
      pollData = await response.json();
    } catch (error) {
      console.error(`[OpenRouter Video] Poll #${pollCount} network error:`, error);
      continue;
    }

    const status = pollData?.status ?? "unknown";
    console.log(`[OpenRouter Video] Poll #${pollCount} (${elapsedMinutes} min) - status=${status}`);

    if (TERMINAL_FAILURE_STATUSES.has(status)) {
      throw new Error(`OpenRouter video generation ${status}: ${pollData?.error ?? "no error message"}`);
    }

    if (status === "completed") {
      // Prefer OpenRouter's reported cost over our formula when present.
      if (pollData?.usage && typeof pollData.usage.cost === "number") {
        reportedUsageCost = pollData.usage.cost;
      }
      break;
    }

    // pending | in_progress | unknown → keep polling.
  }

  onProgress?.({
    status: "completed",
    message: "Video generado, descargando...",
    progress: 95,
  });

  // Download via the dedicated content endpoint — returns binary mp4.
  // unsigned_urls from the poll response are NOT the canonical download path;
  // /content with Bearer auth is.
  const contentUrl = `${OPENROUTER_API_BASE}/videos/${encodeURIComponent(jobId)}/content?index=0`;
  const videoResponse = await fetch(contentUrl, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  if (!videoResponse.ok) {
    const detail = await videoResponse.text().catch(() => videoResponse.statusText);
    throw new Error(`Failed to download OpenRouter video (${videoResponse.status}): ${detail}`);
  }
  const arrayBuffer = await videoResponse.arrayBuffer();
  const videoData = Buffer.from(arrayBuffer);

  const [width, height] = resolveDimensions(config.resolution, config.aspectRatio);
  const computedCost = computeSeedanceCost(modelId, width, height, config.duration);
  const actualCost = typeof reportedUsageCost === "number" ? reportedUsageCost : computedCost;

  onProgress?.({
    status: "completed",
    message: "Video generado exitosamente",
    progress: 100,
  });

  return {
    data: videoData,
    mimeType: "video/mp4",
    duration: config.duration,
    hasAudio: config.generateAudio ?? false,
    seed: config.seed ?? 0,
    actualCost,
  };
}
