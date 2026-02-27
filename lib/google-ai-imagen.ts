import { GoogleGenAI } from "@google/genai";

// Determinar si usar Vertex AI o Gemini API
const isVertexAI = process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";

// ============================================
// LABELS SUPPORT (for Vertex AI tracking)
// ============================================

export interface Labels {
  project_name?: string;
  user_name?: string;
  [key: string]: string | undefined;
}

// Sanitizar valores de labels para Vertex AI
function sanitizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .substring(0, 63);
}

// Per-model backend resolution
function useVertexForBackend(backend?: string): boolean {
  if (backend === 'vertex') return true;
  if (backend === 'gemini') return false;
  return isVertexAI;
}

// Construir labels para Vertex AI
function buildLabels(labels?: Labels, backend?: string): Record<string, string> | undefined {
  if (!labels || !useVertexForBackend(backend)) return undefined;

  const result: Record<string, string> = {};

  if (labels.project_name) {
    result["project_name"] = sanitizeLabel(labels.project_name);
  }
  if (labels.user_name) {
    result["user_name"] = sanitizeLabel(labels.user_name);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// ============================================
// RETRY WITH EXPONENTIAL BACKOFF
// ============================================

const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 5000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isRetriableError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const errorObj = error as { status?: number; code?: number; message?: string };
    if (errorObj.status === 429 || errorObj.status === 503 || errorObj.status === 500) return true;
    if (errorObj.code === 429 || errorObj.code === 503 || errorObj.code === 500) return true;
    const message = errorObj.message?.toLowerCase() || '';
    if (message.includes('resource_exhausted') || message.includes('rate limit') ||
        message.includes('quota') || message.includes('429') || message.includes('503')) return true;
  }
  return false;
}

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: string;
}

async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  onRetry?: (info: RetryInfo) => void
): Promise<T> {
  let lastError: Error | undefined;
  let delay = RETRY_CONFIG.initialDelayMs;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const result = await operation();

      // Log de recuperación si hubo retries previos
      if (attempt > 0) {
        console.log(`[Imagen] ${operationName} exitoso después de ${attempt} reintento(s)`);
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isRetriableError(error) || attempt === RETRY_CONFIG.maxRetries) {
        if (attempt > 0) {
          console.error(`[Imagen] ${operationName} falló después de ${attempt + 1} intento(s). Error final: ${lastError.message}`);
        }
        throw lastError;
      }

      console.warn(
        `[Imagen] ${operationName} falló (intento ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}). ` +
        `Reintentando en ${delay / 1000}s... Error: ${lastError.message}`
      );

      if (onRetry) {
        onRetry({ attempt: attempt + 1, maxAttempts: RETRY_CONFIG.maxRetries + 1, delayMs: delay, error: lastError.message });
      }

      await sleep(delay);
      delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs);
    }
  }
  throw lastError;
}

// Lazy dual-client support for per-model backend selection
let vertexClient: GoogleGenAI | null = null;
let geminiClient: GoogleGenAI | null = null;

function getClient(backend?: string): GoogleGenAI {
  if (useVertexForBackend(backend)) {
    if (!vertexClient) {
      vertexClient = new GoogleGenAI({
        vertexai: true,
        project: process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.GOOGLE_CLOUD_LOCATION,
      });
    }
    return vertexClient;
  }
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      vertexai: false,
    });
  }
  return geminiClient;
}

// ============================================
// INTERFACES
// ============================================

export type ImagenAspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
export type ImagenResolution = "1K" | "2K" | "4K";

export interface ImagenGenerationConfig {
  aspectRatio: ImagenAspectRatio;
  resolution: ImagenResolution;
  seed?: number;
  negativePrompt?: string;
  numberOfImages?: number;
}

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
  seed: number;
}

export interface ImagenGenerationProgress {
  status: "pending" | "processing" | "completed" | "failed";
  message: string;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Normaliza el model ID para compatibilidad entre Gemini API y Vertex AI
 */
function normalizeModelId(modelId: string, backend?: string): string {
  if (useVertexForBackend(backend) && modelId.startsWith("models/")) {
    return modelId.replace("models/", "");
  }
  return modelId;
}

/**
 * Genera un seed aleatorio para reproducibilidad
 * Rango válido para Imagen: 1 - 2147483647
 */
export function generateSeed(): number {
  return Math.floor(Math.random() * 2147483646) + 1;
}

// ============================================
// MAIN IMAGE GENERATION FUNCTION
// ============================================

/**
 * Genera imágenes usando Imagen 4 de Google
 * Utiliza el API de generateImages con soporte de seed para reproducibilidad
 *
 * IMPORTANTE: Para usar seed, addWatermark debe ser false y enhancePrompt debe ser false
 */
export async function generateImagen(
  modelId: string,
  prompt: string,
  config: ImagenGenerationConfig,
  onProgress?: (progress: ImagenGenerationProgress) => void,
  labels?: Labels,
  backend?: string
): Promise<GeneratedImage[]> {
  const normalizedModelId = normalizeModelId(modelId, backend);
  const isVertex = useVertexForBackend(backend);
  const client = getClient(backend);

  // Generar seed si no se proporciona
  const effectiveSeed = config.seed ?? generateSeed();

  onProgress?.({
    status: "pending",
    message: "Iniciando generación de imagen...",
  });

  try {
    console.log(`\n========== [IMAGEN 4 GENERATION REQUEST] (${isVertex ? "Vertex AI" : "Gemini API"}) ==========`);
    console.log("Model:", normalizedModelId);
    if (isVertex) {
      console.log("Seed:", effectiveSeed);
    }
    console.log("Aspect Ratio:", config.aspectRatio);
    console.log("Resolution:", config.resolution);
    console.log("Prompt:", prompt.substring(0, 100) + (prompt.length > 100 ? "..." : ""));
    if (config.negativePrompt && isVertex) {
      console.log("Negative Prompt:", config.negativePrompt.substring(0, 50));
    }
    console.log("====================================================\n");

    onProgress?.({
      status: "processing",
      message: "Generando imagen con Imagen 4...",
    });

    // Build labels for Vertex AI tracking
    const builtLabels = buildLabels(labels, backend);

    // Llamar a la API de generateImages con retry
    // Vertex AI soporta: seed, addWatermark, negativePrompt, sampleImageSize, labels
    // Gemini API soporta: numberOfImages, aspectRatio, personGeneration
    // Gemini API NO soporta: seed, addWatermark, negativePrompt, sampleImageSize
    const imageConfig: Record<string, unknown> = {
      numberOfImages: config.numberOfImages || 1,
      aspectRatio: config.aspectRatio,
      // Person generation (allow adults by default) - supported by both APIs
      personGeneration: "allow_all",
    };

    if (isVertex) {
      // Vertex AI-only parameters
      imageConfig.addWatermark = false; // Required for seed to work
      imageConfig.seed = effectiveSeed;
      if (config.resolution) {
        imageConfig.sampleImageSize = config.resolution;
      }
      if (config.negativePrompt) {
        imageConfig.negativePrompt = config.negativePrompt;
      }
      if (builtLabels) {
        imageConfig.labels = builtLabels;
      }
    }

    const response = await withRetry(
      () => client.models.generateImages({
        model: normalizedModelId,
        prompt: prompt,
        config: imageConfig,
      }),
      "generateImages",
      (info) => {
        onProgress?.({
          status: "processing",
          message: `Reintentando (${info.attempt}/${info.maxAttempts})... Esperando ${Math.round(info.delayMs / 1000)}s`,
        });
      }
    );

    // Extraer imágenes de la respuesta
    const generatedImages = response.generatedImages;

    if (!generatedImages || generatedImages.length === 0) {
      throw new Error("No se generaron imágenes");
    }

    onProgress?.({
      status: "completed",
      message: "Imagen generada exitosamente",
    });

    // Convertir a nuestro formato
    const results: GeneratedImage[] = [];

    for (const img of generatedImages) {
      if (img.image?.imageBytes) {
        results.push({
          data: Buffer.from(img.image.imageBytes, "base64"),
          mimeType: img.image.mimeType || "image/png",
          seed: effectiveSeed,
        });
      }
    }

    if (results.length === 0) {
      throw new Error("No se pudo extraer los datos de las imágenes generadas");
    }

    console.log(`[Imagen 4] Generated ${results.length} image(s) with seed ${effectiveSeed}`);

    return results;

  } catch (error) {
    console.error("[Imagen 4] Error generating image:", error);

    onProgress?.({
      status: "failed",
      message: error instanceof Error ? error.message : "Error desconocido",
    });

    throw error;
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Verifica si un modelo es Imagen 4
 */
export function isImagen4Model(modelId: string): boolean {
  return modelId.includes("imagen-4");
}

/**
 * Verifica si la API de Imagen está configurada
 */
export function isImagenConfigured(): boolean {
  const vertexConfigured = !!process.env.GOOGLE_CLOUD_PROJECT && !!process.env.GOOGLE_CLOUD_LOCATION;
  const geminiConfigured = !!process.env.GEMINI_API_KEY;
  return vertexConfigured || geminiConfigured;
}

/**
 * Obtiene los aspect ratios soportados por Imagen 4
 */
export function getSupportedAspectRatios(): { value: ImagenAspectRatio; label: string }[] {
  return [
    { value: "1:1", label: "Cuadrado (1:1)" },
    { value: "3:4", label: "Vertical 3:4" },
    { value: "4:3", label: "Horizontal 4:3" },
    { value: "9:16", label: "Vertical 9:16" },
    { value: "16:9", label: "Horizontal 16:9" },
  ];
}

/**
 * Obtiene las resoluciones soportadas por Imagen 4
 */
export function getSupportedResolutions(): { value: ImagenResolution; label: string }[] {
  return [
    { value: "1K", label: "1K (1024px)" },
    { value: "2K", label: "2K (2048px)" },
    { value: "4K", label: "4K (4096px)" },
  ];
}
