/**
 * Kling Omni Image integration
 * Text-to-image with reference image support via Kling REST API
 * API: POST /v1/images/omni-image (create) + GET /v1/images/omni-image/{taskId} (poll)
 */

import { KLING_API_BASE, getKlingAuthToken, isKlingConfigured } from "./kling-auth";

export { isKlingConfigured };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Shorter polling for images (faster than video)
const POLLING_CONFIG = {
  initialDelayMs: 2000,
  maxDelayMs: 10000,
  backoffMultiplier: 1.5,
  maxDurationMs: 300000, // 5 minutes max
};

// ============================================
// TYPES
// ============================================

export type KlingImageAspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "3:2" | "2:3" | "21:9";
export type KlingImageResolution = "1k" | "2k";

export interface KlingImageConfig {
  aspectRatio?: KlingImageAspectRatio;
  resolution?: KlingImageResolution;
  numberOfImages?: number; // 1-9
  imageUrls?: string[]; // Reference image URLs (public)
}

export interface KlingImageProgress {
  status: string;
  message: string;
}

export interface KlingGeneratedImage {
  data: Buffer;
  mimeType: string;
}

interface KlingImageTaskResponse {
  code: number;
  message: string;
  request_id?: string;
  data: {
    task_id: string;
    task_status: "submitted" | "processing" | "succeed" | "failed";
    task_status_msg?: string;
    task_result?: {
      images?: Array<{
        index: number;
        url: string;
      }>;
    };
  };
}

// ============================================
// RETRY LOGIC
// ============================================

const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 3000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

function isRetriableStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 500 || status === 502;
}

// ============================================
// MAIN GENERATION FUNCTION
// ============================================

export async function generateKlingImage(
  modelId: string,
  prompt: string,
  config: KlingImageConfig,
  onProgress?: (progress: KlingImageProgress) => void,
): Promise<KlingGeneratedImage[]> {

  onProgress?.({
    status: "pending",
    message: "Iniciando generacion de imagen con Kling...",
  });

  // Build request body
  // DB model_id may differ from API model_name (e.g. kling-omni-image → kling-v3-omni)
  const apiModelName = modelId.includes("kling-omni-image") ? "kling-v3-omni" : modelId;
  const requestBody: Record<string, unknown> = {
    model_name: apiModelName,
    prompt,
  };

  if (config.aspectRatio) {
    requestBody.aspect_ratio = config.aspectRatio;
  }
  if (config.resolution) {
    requestBody.resolution = config.resolution;
  }
  if (config.numberOfImages && config.numberOfImages > 1) {
    requestBody.n = config.numberOfImages;
  }

  // Reference images: array of { image_url } objects
  if (config.imageUrls && config.imageUrls.length > 0) {
    requestBody.image_list = config.imageUrls.map(url => ({ image_url: url }));
    console.log(`[Kling Image] ${config.imageUrls.length} reference image(s) attached`);
  }

  console.log("[Kling Image] Request:", JSON.stringify({ ...requestBody, image_list: config.imageUrls?.length || 0 }, null, 2));

  onProgress?.({
    status: "processing",
    message: "Enviando solicitud a Kling...",
  });

  // Step 1: Create task with retry
  let taskId: string;
  let retryDelay = RETRY_CONFIG.initialDelayMs;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    const token = await getKlingAuthToken();

    const response = await fetch(`${KLING_API_BASE}/v1/images/omni-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      const data: KlingImageTaskResponse = await response.json();
      if (data.code !== 0) {
        throw new Error(`Kling API error: ${data.message} (code ${data.code})`);
      }
      taskId = data.data.task_id;
      break;
    }

    if (!isRetriableStatus(response.status) || attempt === RETRY_CONFIG.maxRetries) {
      const errorText = await response.text();
      throw new Error(`Kling image generation failed (${response.status}): ${errorText}`);
    }

    console.warn(
      `[Kling Image] Request failed (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}). ` +
      `Retrying in ${retryDelay / 1000}s... Status: ${response.status}`
    );

    onProgress?.({
      status: "processing",
      message: `Reintentando (${attempt + 1}/${RETRY_CONFIG.maxRetries + 1})...`,
    });

    await sleep(retryDelay);
    retryDelay = Math.min(retryDelay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs);
  }

  console.log(`[Kling Image] Task created: ${taskId!}`);

  // Step 2: Poll for completion
  onProgress?.({
    status: "processing",
    message: "Generando imagen...",
  });

  const images = await pollKlingImageStatus(taskId!, onProgress);
  return images;
}

// ============================================
// POLLING
// ============================================

async function pollKlingImageStatus(
  taskId: string,
  onProgress?: (progress: KlingImageProgress) => void,
): Promise<KlingGeneratedImage[]> {
  const startTime = Date.now();
  let pollCount = 0;
  let pollDelay = POLLING_CONFIG.initialDelayMs;

  while (true) {
    pollCount++;
    const elapsedMs = Date.now() - startTime;
    const elapsedSeconds = Math.round(elapsedMs / 1000);

    if (elapsedMs > POLLING_CONFIG.maxDurationMs) {
      throw new Error("Kling image generation timed out after 5 minutes");
    }

    await sleep(pollDelay);
    pollDelay = Math.min(pollDelay * POLLING_CONFIG.backoffMultiplier, POLLING_CONFIG.maxDelayMs);

    onProgress?.({
      status: "processing",
      message: `Generando imagen... (${elapsedSeconds}s)`,
    });

    try {
      const token = await getKlingAuthToken();

      const response = await fetch(`${KLING_API_BASE}/v1/images/omni-image/${taskId}`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error(`[Kling Image] Poll #${pollCount} failed: ${response.status}`);
        continue;
      }

      const data: KlingImageTaskResponse = await response.json();
      console.log(`[Kling Image] Poll #${pollCount} (${elapsedSeconds}s) - status=${data.data.task_status}`);

      if (data.data.task_status === "failed") {
        throw new Error(`Kling image generation failed: ${data.data.task_status_msg || "Unknown error"}`);
      }

      if (data.data.task_status === "succeed" && data.data.task_result?.images?.length) {
        onProgress?.({
          status: "completed",
          message: "Imagen generada, descargando...",
        });

        // Download all generated images
        const results: KlingGeneratedImage[] = [];

        for (const img of data.data.task_result.images) {
          const imgResponse = await fetch(img.url);
          if (!imgResponse.ok) {
            throw new Error(`Failed to download Kling image: ${imgResponse.statusText}`);
          }

          const contentType = imgResponse.headers.get("content-type") || "image/png";
          const arrayBuffer = await imgResponse.arrayBuffer();

          results.push({
            data: Buffer.from(arrayBuffer),
            mimeType: contentType,
          });
        }

        onProgress?.({
          status: "completed",
          message: "Imagen generada exitosamente",
        });

        return results;
      }
    } catch (error) {
      if (error instanceof Error && (
        error.message.includes("timed out") ||
        error.message.includes("Failed to download") ||
        error.message.includes("generation failed")
      )) {
        throw error;
      }
      console.error(`[Kling Image] Poll #${pollCount} error:`, error);
    }
  }
}
