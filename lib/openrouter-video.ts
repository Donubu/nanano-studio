/**
 * OpenRouter video generation integration.
 *
 * Endpoint: POST https://openrouter.ai/api/v1/videos (async submit + polling)
 * Submit response:  { id, polling_url }
 * Poll response:    { status, unsigned_urls?, error? }
 *
 * Currently used for ByteDance Seedance 2.5 and 2.0-fast (2.0 retired; kept
 * in the caps table for historical cost recalculation). Other OpenRouter video
 * models with the same submit/poll shape plug in by adding an entry to
 * OPENROUTER_MODEL_CAPS.
 *
 * Pricing for Seedance follows tokens = (w * h * d * 24) / 1024, multiplied
 * by the per-token rate. We compute it locally and return it via
 * GeneratedVideo.actualCost so the route can persist the precise number.
 */

import { GeneratedVideo, VideoGenerationProgress, ReferenceImageInput } from "./google-ai-video";
import { getOpenRouterModelCaps, resolveOpenRouterDimensions, computeSeedanceCost } from "./openrouter-video-caps";

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

export type { OpenRouterAspectRatio, OpenRouterResolution } from "./openrouter-video-caps";
import type { OpenRouterAspectRatio, OpenRouterResolution } from "./openrouter-video-caps";

export interface OpenRouterVideoConfig {
  duration: number; // integer, range depends on the model (see getOpenRouterModelCaps)
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

// Per-model capabilities, dimensions and pricing live in a dependency-free
// module so client bundles (canvas / full mode) can import the same table.
export {
  OPENROUTER_MODEL_CAPS,
  DEFAULT_OPENROUTER_MODEL_ID,
  getOpenRouterModelCaps,
  resolveOpenRouterDimensions,
  computeSeedanceCost,
  estimateOpenRouterVideoCost,
} from "./openrouter-video-caps";
export type { OpenRouterModelCaps } from "./openrouter-video-caps";

// ============================================
// VALIDATION
// ============================================

export function validateOpenRouterVideoConfig(config: OpenRouterVideoConfig, modelId: string): string | null {
  const caps = getOpenRouterModelCaps(modelId);
  if (!Number.isInteger(config.duration) || config.duration < caps.minDuration || config.duration > caps.maxDuration) {
    return `La duración debe ser un entero entre ${caps.minDuration} y ${caps.maxDuration} segundos`;
  }
  if (!caps.aspectRatios.includes(config.aspectRatio)) {
    return `Aspect ratio inválido para ${modelId}. Debe ser uno de: ${caps.aspectRatios.join(", ")}`;
  }
  if (!caps.resolutions.includes(config.resolution)) {
    return `Resolución inválida para ${modelId}. Permitidas: ${caps.resolutions.join(", ")}`;
  }
  return null;
}

// ============================================
// ERRORES
// ============================================

/**
 * Traduce los errores de submit de OpenRouter/ByteDance a mensajes accionables
 * en español. El detalle crudo se conserva al final para debugging (queda en
 * el content del mensaje de error y en los logs).
 */
export function describeOpenRouterSubmitError(status: number, rawText: string, referenceCount: number): string {
  const raw = rawText.slice(0, 600);
  let friendly: string | null = null;

  if (status === 402) {
    friendly = "La cuenta de OpenRouter no tiene créditos. Avísale al administrador para recargar saldo (openrouter.ai/settings/credits).";
  } else if (status === 401 || status === 403) {
    friendly = "La API key de OpenRouter es inválida o está bloqueada. Avísale al administrador.";
  } else if (/PrivacyInformation|may contain real person/i.test(rawText)) {
    // content[0] es el prompt; content[N] la N-ésima imagen (frames primero,
    // luego referencias). Sin frames, content[N] == @refN.
    const idx = [...rawText.matchAll(/content\[(\d+)\]/g)].map((m) => Number(m[1])).filter((n) => n >= 1);
    const names = idx.length > 0 && idx.every((n) => n <= referenceCount)
      ? idx.map((n) => `@ref${n}`).join(", ")
      : idx.length > 0 ? `imagen ${idx.join(", ")}` : "alguna imagen de entrada";
    friendly = `Seedance rechazó ${names}: parece contener una persona real y el modelo no acepta rostros reales en las imágenes de entrada. Usa un retrato generado por IA como referencia, o cambia a Omni / Kling para personas reales.`;
  } else if (/TaskTypeConstraint|ratio specified/i.test(rawText)) {
    friendly = "Con first/last frame la proporción la define la imagen; el sistema no debería mandar aspect_ratio. Reintenta; si persiste, avísale al administrador.";
  } else if (/seed specified/i.test(rawText)) {
    friendly = "El seed está fuera del rango que acepta Seedance (máx. 2147483647). Reintenta sin seed o con uno menor.";
  } else if (/SensitiveContent|content policy|moderation/i.test(rawText)) {
    friendly = "El proveedor rechazó la solicitud por moderación de contenido (prompt o imágenes). Ajusta el prompt o las imágenes.";
  } else if (status === 429) {
    friendly = "OpenRouter está limitando las solicitudes (429). Espera unos segundos y reintenta.";
  }

  return friendly
    ? `${friendly} [OpenRouter ${status}: ${raw}]`
    : `OpenRouter video submit failed (${status}): ${raw}`;
}

// ============================================
// SEED
// ============================================

// Seedance (Dreamina) rejects seeds above int32: "The parameter seed specified
// in the request must be less than or equal to 2147483647".
export const OPENROUTER_MAX_SEED = 2147483647;

export function normalizeOpenRouterSeed(seed: number): number {
  const s = Math.floor(Math.abs(seed));
  return s > OPENROUTER_MAX_SEED ? s % (OPENROUTER_MAX_SEED + 1) : s;
}

// ============================================
// PROMPT: @refN → @ImageN
// ============================================

/**
 * Seedance addresses reference assets natively as `@Image1`, `@Image2`… in
 * the order of `input_references`. Our UIs (canvas node, full mode) expose the
 * same slots as `@ref1`, `@ref2`… (1-based, already sorted by priority), so we
 * translate the mentions here. Mentions pointing past the last attached
 * reference are left untouched (the model will just read them as text).
 */
export function translateRefMentionsForSeedance(prompt: string, referenceCount: number): string {
  if (referenceCount <= 0) return prompt;
  return prompt.replace(/@ref\s?(\d+)\b/gi, (match, num: string) => {
    const n = Number(num);
    if (n < 1 || n > referenceCount) return match;
    return `@Image${n}`;
  });
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

  const caps = getOpenRouterModelCaps(modelId);

  // Cap references to what the model accepts and translate @refN mentions to
  // Seedance's native @ImageN addressing (same order as input_references).
  const references = (imageInputs?.referenceImages ?? []).slice(0, caps.maxReferenceImages);
  if ((imageInputs?.referenceImages?.length ?? 0) > references.length) {
    console.warn(`[OpenRouter Video] ${imageInputs!.referenceImages!.length} references received, capped to ${references.length} for ${modelId}`);
  }
  const effectivePrompt = translateRefMentionsForSeedance(prompt, references.length);

  const [width, height] = resolveOpenRouterDimensions(modelId, config.resolution, config.aspectRatio);

  // Con first/last frame, Seedance deriva la proporción de la imagen y
  // rechaza aspect_ratio/size ("InvalidParameter.TaskTypeConstraint: the
  // output ratio follows the first-frame image"). Solo se manda resolution.
  const hasFrameImages = !!(imageInputs?.firstFrame || imageInputs?.lastFrame);

  const requestBody: Record<string, unknown> = {
    model: modelId,
    prompt: effectivePrompt,
    duration: config.duration,
    resolution: config.resolution,
  };
  if (!hasFrameImages) {
    requestBody.aspect_ratio = config.aspectRatio;
    // Explicit canonical size so the billed pixels match our cost estimate.
    requestBody.size = `${width}x${height}`;
  }
  if (typeof config.seed === "number" && Number.isFinite(config.seed)) {
    requestBody.seed = normalizeOpenRouterSeed(config.seed);
    if (requestBody.seed !== config.seed) {
      console.warn(`[OpenRouter Video] seed ${config.seed} fuera de rango int32, usando ${requestBody.seed}`);
    }
  }
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

  if (references.length > 0) {
    requestBody.input_references = references.map(r => ({
      type: "image_url",
      image_url: { url: r.image },
    }));
  }

  console.log("[OpenRouter Video] Submit body keys:", Object.keys(requestBody).join(", "),
    `| size=${width}x${height} duration=${config.duration}s refs=${references.length}`);

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
      throw new Error(describeOpenRouterSubmitError(response.status, errorText, references.length));
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

  const [width, height] = resolveOpenRouterDimensions(modelId, config.resolution, config.aspectRatio);
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
    seed: typeof config.seed === "number" ? normalizeOpenRouterSeed(config.seed) : 0,
    actualCost,
  };
}
