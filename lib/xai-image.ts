/**
 * xAI Grok Imagine Image integration
 * Supports text-to-image via xAI REST API
 * API docs: https://docs.x.ai/developers/model-capabilities/images/generation
 */

const XAI_API_BASE = "https://api.x.ai/v1";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================
// TYPES
// ============================================

export type XaiImageAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "2:1" | "1:2" | "auto";
export type XaiImageResolution = "1k" | "2k";

export interface XaiImageConfig {
  aspectRatio?: XaiImageAspectRatio;
  resolution?: XaiImageResolution;
  numberOfImages?: number;
  imageUrls?: string[]; // Reference image URLs or data URIs for image editing
}

export interface XaiGeneratedImage {
  data: Buffer;
  mimeType: string;
}

export interface XaiImageProgress {
  status: "pending" | "processing" | "completed" | "failed";
  message: string;
}

// ============================================
// CONFIGURATION
// ============================================

export function isXaiImageConfigured(): boolean {
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

export async function generateXaiImage(
  modelId: string,
  prompt: string,
  config: XaiImageConfig,
  onProgress?: (progress: XaiImageProgress) => void,
): Promise<XaiGeneratedImage[]> {
  const apiKey = getApiKey();
  const numberOfImages = Math.min(10, Math.max(1, config.numberOfImages || 1));
  const hasReferenceImages = config.imageUrls && config.imageUrls.length > 0;

  onProgress?.({
    status: "pending",
    message: "Iniciando generacion de imagen con xAI...",
  });

  console.log(`\n========== [xAI IMAGE ${hasReferenceImages ? "EDIT" : "GENERATION"} REQUEST] ==========`);
  console.log("Model:", modelId);
  console.log("Aspect Ratio:", config.aspectRatio || "auto");
  console.log("Resolution:", config.resolution || "1k");
  console.log("Number of images:", numberOfImages);
  console.log("Reference images:", hasReferenceImages ? config.imageUrls!.length : 0);
  console.log("Prompt:", prompt.substring(0, 100) + (prompt.length > 100 ? "..." : ""));
  console.log("====================================================\n");

  const requestBody: Record<string, unknown> = {
    model: modelId,
    prompt,
    n: numberOfImages,
    response_format: "b64_json",
  };

  if (config.aspectRatio) {
    requestBody.aspect_ratio = config.aspectRatio;
  }
  if (config.resolution) {
    requestBody.resolution = config.resolution;
  }

  // Add reference images for image editing
  if (hasReferenceImages) {
    const imageUrls = config.imageUrls!;
    if (imageUrls.length === 1) {
      // Single image: use "image" parameter
      requestBody.image = { url: imageUrls[0], type: "image_url" };
    } else {
      // Multiple images (up to 3): use "images" array
      requestBody.images = imageUrls.slice(0, 3).map(url => ({ url, type: "image_url" }));
    }
  }

  // Use /images/edits when reference images are provided, /images/generations otherwise
  const endpoint = hasReferenceImages
    ? `${XAI_API_BASE}/images/edits`
    : `${XAI_API_BASE}/images/generations`;

  onProgress?.({
    status: "processing",
    message: hasReferenceImages ? "Enviando solicitud de edicion a xAI..." : "Enviando solicitud a xAI...",
  });

  let retryDelay = RETRY_CONFIG.initialDelayMs;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      const data = await response.json() as {
        data: Array<{ b64_json: string }>;
      };

      if (!data.data || data.data.length === 0) {
        throw new Error("No se generaron imagenes");
      }

      onProgress?.({
        status: "completed",
        message: "Imagen generada exitosamente",
      });

      const results: XaiGeneratedImage[] = data.data.map((img) => ({
        data: Buffer.from(img.b64_json, "base64"),
        mimeType: "image/png",
      }));

      console.log(`[xAI Image] Generated ${results.length} image(s)`);
      return results;
    }

    if (!isRetriableStatus(response.status) || attempt === RETRY_CONFIG.maxRetries) {
      const errorText = await response.text();
      throw new Error(`xAI image generation failed (${response.status}): ${errorText}`);
    }

    console.warn(
      `[xAI Image] Request failed (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}). ` +
      `Retrying in ${retryDelay / 1000}s... Status: ${response.status}`
    );

    onProgress?.({
      status: "processing",
      message: `Reintentando (${attempt + 1}/${RETRY_CONFIG.maxRetries + 1})... Esperando ${Math.round(retryDelay / 1000)}s`,
    });

    await sleep(retryDelay);
    retryDelay = Math.min(retryDelay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs);
  }

  throw new Error("xAI image generation failed after all retries");
}
