import { GoogleGenAI, VideoGenerationReferenceType } from "@google/genai";

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

// Construir labels para Vertex AI
function buildLabels(labels?: Labels): Record<string, string> | undefined {
  if (!labels || !isVertexAI) return undefined;

  const result: Record<string, string> = {};

  if (labels.project_name) {
    result["project_name"] = sanitizeLabel(labels.project_name);
  }
  if (labels.user_name) {
    result["user_name"] = sanitizeLabel(labels.user_name);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// Configuración de polling para operaciones de video (configurable via env)
const POLLING_CONFIG = {
  initialDelayMs: Number(process.env.VIDEO_POLLING_INITIAL_DELAY_MS) || 5000,    // 5 segundos inicial
  maxDelayMs: Number(process.env.VIDEO_POLLING_MAX_DELAY_MS) || 30000,           // máximo 30 segundos entre polls
  backoffMultiplier: Number(process.env.VIDEO_POLLING_BACKOFF_MULTIPLIER) || 1.5, // multiplicador de backoff
  maxDurationMs: Number(process.env.VIDEO_GENERATION_TIMEOUT_MS) || 900000,      // 15 minutos máximo por defecto
};

// Helper para esperar
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================
// RETRY WITH EXPONENTIAL BACKOFF
// ============================================

const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 5000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

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
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isRetriableError(error) || attempt === RETRY_CONFIG.maxRetries) throw lastError;

      console.warn(
        `[Video] ${operationName} falló (intento ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}). ` +
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

// Inicializar cliente según configuración
function createClient(): GoogleGenAI {
  if (isVertexAI) {
    return new GoogleGenAI({
      vertexai: true,
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION,
    });
  }
  return new GoogleGenAI({
    apiKey: process.env.GOOGLE_API_KEY,
  });
}

const ai = createClient();

// ============================================
// INTERFACES
// ============================================

export interface VideoGenerationConfig {
  durationSeconds: 4 | 6 | 8;
  resolution: "720p" | "1080p";
  aspectRatio: "16:9" | "9:16";
  generateAudio: boolean;
  negativePrompt?: string;
  seed?: number;
  personGeneration?: "allow_adult" | "allow_all" | "dont_allow";
}

// Type for reference images with ASSET or STYLE
export type ReferenceImageType = "ASSET" | "STYLE";

export interface ReferenceImageInput {
  image: string;  // Base64 encoded image
  type: ReferenceImageType;
}

export interface VideoInput {
  prompt: string;
  firstFrameImage?: string;   // Base64 encoded image
  lastFrameImage?: string;    // Base64 encoded image
  referenceImages?: ReferenceImageInput[]; // Up to 3 reference images with type
}

export interface GeneratedVideo {
  data: Buffer;
  mimeType: string;
  duration: number;
  hasAudio: boolean;
  seed: number;
}

export interface VideoGenerationProgress {
  status: "pending" | "processing" | "completed" | "failed";
  message: string;
  progress?: number;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Normaliza el model ID para compatibilidad entre Gemini API y Vertex AI
 */
function normalizeModelId(modelId: string): string {
  if (isVertexAI && modelId.startsWith("models/")) {
    return modelId.replace("models/", "");
  }
  return modelId;
}

/**
 * Convierte una imagen base64 al formato requerido por la API
 */
function prepareImageInput(base64Data: string, mimeType: string = "image/jpeg") {
  // Si viene con el prefijo data:, extraer solo el base64
  const cleanBase64 = base64Data.includes(",")
    ? base64Data.split(",")[1]
    : base64Data;

  return {
    bytesBase64Encoded: cleanBase64,
    mimeType,
  };
}

/**
 * Descarga una imagen desde URL y la convierte a base64
 */
async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = response.headers.get("content-type") || "image/jpeg";

  return `data:${mimeType};base64,${base64}`;
}

/**
 * Prepara una imagen para la API - convierte URL a base64 si es necesario
 */
async function prepareImage(imageData: string): Promise<string> {
  // Si es una URL (http/https), descargar y convertir a base64
  if (imageData.startsWith("http://") || imageData.startsWith("https://")) {
    return await fetchImageAsBase64(imageData);
  }
  // Si ya es base64 (con o sin prefijo data:), devolverlo tal cual
  return imageData;
}

/**
 * Detecta el mime type de una imagen base64
 */
function detectMimeType(base64Data: string): string {
  if (base64Data.startsWith("data:")) {
    const match = base64Data.match(/data:([^;]+);/);
    if (match) return match[1];
  }
  // Default a JPEG si no se puede detectar
  return "image/jpeg";
}

// ============================================
// MAIN VIDEO GENERATION FUNCTION
// ============================================

/**
 * Genera un video usando los modelos VEO de Google
 * Usa el patrón de operación de larga duración (predictLongRunning)
 */
export async function generateVideo(
  modelId: string,
  input: VideoInput,
  config: VideoGenerationConfig,
  onProgress?: (progress: VideoGenerationProgress) => void,
  labels?: Labels
): Promise<GeneratedVideo> {
  const normalizedModelId = normalizeModelId(modelId);

  // Notificar inicio
  onProgress?.({
    status: "pending",
    message: "Iniciando generación de video...",
  });

  try {
    // Preparar imágenes (convertir URLs a base64 si es necesario)
    onProgress?.({
      status: "processing",
      message: "Preparando imágenes...",
      progress: 5,
    });

    let preparedFirstFrame: string | undefined;
    let preparedLastFrame: string | undefined;
    let preparedReferenceImages: typeof input.referenceImages | undefined;

    if (input.firstFrameImage) {
      preparedFirstFrame = await prepareImage(input.firstFrameImage);
    }

    if (input.lastFrameImage) {
      preparedLastFrame = await prepareImage(input.lastFrameImage);
    }

    if (input.referenceImages && input.referenceImages.length > 0) {
      preparedReferenceImages = await Promise.all(
        input.referenceImages.slice(0, 3).map(async (refImg) => ({
          image: await prepareImage(refImg.image),
          type: refImg.type,
        }))
      );
    }

    // Construir la configuración de generación
    const generateConfig: Record<string, unknown> = {
      aspectRatio: config.aspectRatio,
      durationSeconds: config.durationSeconds,
    };

    // generateAudio solo soportado en Vertex AI (Gemini API genera audio por defecto en VEO 3+)
    if (isVertexAI) {
      generateConfig.generateAudio = config.generateAudio;
    }

    // Solo VEO 3+ soporta resolución
    if (modelId.includes("veo-3")) {
      generateConfig.resolution = config.resolution;
    }

    // Agregar negative prompt si existe (solo Vertex AI)
    if (config.negativePrompt && isVertexAI) {
      generateConfig.negativePrompt = config.negativePrompt;
    }

    // Agregar seed si existe (solo Vertex AI, Gemini API no lo soporta)
    if (config.seed !== undefined && isVertexAI) {
      generateConfig.seed = config.seed;
    }

    // Agregar personGeneration si existe
    if (config.personGeneration) {
      generateConfig.personGeneration = config.personGeneration;
    }

    // Construir el input de la instancia
    const instance: Record<string, unknown> = {
      prompt: input.prompt,
    };

    // Agregar first frame si existe
    if (preparedFirstFrame) {
      const mimeType = detectMimeType(preparedFirstFrame);
      instance.image = prepareImageInput(preparedFirstFrame, mimeType);
    }

    // Agregar last frame si existe
    if (preparedLastFrame) {
      const mimeType = detectMimeType(preparedLastFrame);
      generateConfig.lastFrame = prepareImageInput(preparedLastFrame, mimeType);
    }

    // Agregar reference images si existen (hasta 3) - now with type support
    if (preparedReferenceImages && preparedReferenceImages.length > 0) {
      const refImages = preparedReferenceImages.map(refImg => ({
        image: prepareImageInput(refImg.image, detectMimeType(refImg.image)),
        referenceType: refImg.type.toLowerCase() as "asset" | "style",
      }));
      generateConfig.referenceImages = refImages;
    }

    onProgress?.({
      status: "processing",
      message: "Enviando solicitud a VEO...",
      progress: 10,
    });

    // Build labels for Vertex AI tracking
    const builtLabels = buildLabels(labels);

    // Iniciar la operación de generación de video (con retry)
    const operation = await withRetry(
      () => ai.models.generateVideos({
        model: normalizedModelId,
        prompt: input.prompt,
        ...(preparedFirstFrame && {
          image: {
            imageBytes: prepareImageInput(preparedFirstFrame, detectMimeType(preparedFirstFrame)).bytesBase64Encoded,
            mimeType: detectMimeType(preparedFirstFrame),
          },
        }),
        config: {
          aspectRatio: config.aspectRatio,
          durationSeconds: config.durationSeconds,
          numberOfVideos: 1,
          // generateAudio solo soportado en Vertex AI
          ...(isVertexAI && { generateAudio: config.generateAudio }),
          // negativePrompt solo soportado en Vertex AI
          ...(config.negativePrompt && isVertexAI && { negativePrompt: config.negativePrompt }),
          ...(config.personGeneration && { personGeneration: config.personGeneration }),
          ...(config.seed !== undefined && isVertexAI && { seed: config.seed }),
          ...(preparedLastFrame && {
            lastFrame: {
              imageBytes: prepareImageInput(preparedLastFrame, detectMimeType(preparedLastFrame)).bytesBase64Encoded,
              mimeType: detectMimeType(preparedLastFrame),
            },
          }),
          ...(preparedReferenceImages && preparedReferenceImages.length > 0 && {
            referenceImages: preparedReferenceImages.map(refImg => ({
              image: {
                imageBytes: prepareImageInput(refImg.image, detectMimeType(refImg.image)).bytesBase64Encoded,
                mimeType: detectMimeType(refImg.image),
              },
              referenceType: refImg.type === "STYLE"
                ? VideoGenerationReferenceType.STYLE
                : VideoGenerationReferenceType.ASSET,
            })),
          }),
          // Labels for Vertex AI tracking
          ...(builtLabels && { labels: builtLabels }),
        },
      }),
      "generateVideos",
      (info) => {
        onProgress?.({
          status: "processing",
          message: `Reintentando (${info.attempt}/${info.maxAttempts})... Esperando ${Math.round(info.delayMs / 1000)}s`,
          progress: 5,
        });
      }
    );

    // Si la operación ya tiene el resultado (el SDK esperó internamente)
    const immediateVideo = extractVideoFromResponse(operation?.response);
    if (immediateVideo) {

      onProgress?.({
        status: "completed",
        message: "Video generado, descargando...",
        progress: 90,
      });

      const videoData = await downloadVideo(immediateVideo);

      onProgress?.({
        status: "completed",
        message: "Video generado exitosamente",
        progress: 100,
      });

      return {
        data: videoData,
        mimeType: immediateVideo.mimeType || "video/mp4",
        duration: config.durationSeconds,
        hasAudio: config.generateAudio,
        seed: config.seed!,
      };
    }

    onProgress?.({
      status: "processing",
      message: "Video en cola de generación...",
      progress: 20,
    });

    // Polling para esperar a que complete (si el SDK no esperó)
    const video = await pollVideoOperation(operation, config, onProgress);

    return {
      ...video,
      seed: config.seed!,
    };
  } catch (error) {
    console.error("[Google AI Video] Error generating video:", error);
    throw error;
  }
}

/**
 * Polling de la operación de video usando ai.operations.getVideosOperation()
 */
async function pollVideoOperation(
  initialOperation: Awaited<ReturnType<typeof ai.models.generateVideos>>,
  config: VideoGenerationConfig,
  onProgress?: (progress: VideoGenerationProgress) => void
): Promise<GeneratedVideo> {
  const startTime = Date.now();
  let progressPercent = 20;
  let pollCount = 0;
  let operation = initialOperation;

  while (!operation.done) {
    pollCount++;
    const elapsedMs = Date.now() - startTime;
    const elapsedMinutes = (elapsedMs / 60000).toFixed(1);

    // Verificar timeout total
    if (elapsedMs > POLLING_CONFIG.maxDurationMs) {
      const timeoutMinutes = Math.round(POLLING_CONFIG.maxDurationMs / 60000);
      throw new Error(`Video generation timed out after ${timeoutMinutes} minutes`);
    }

    // Esperar antes del siguiente poll
    await sleep(POLLING_CONFIG.initialDelayMs);

    // Incrementar progreso gradualmente (simulado)
    progressPercent = Math.min(progressPercent + 2, 90);

    onProgress?.({
      status: "processing",
      message: `Generando video... (${elapsedMinutes} min)`,
      progress: progressPercent,
    });

    try {
      // Actualizar el estado de la operación usando el SDK
      operation = await ai.operations.getVideosOperation({ operation });
    } catch (pollError) {
      // Log poll errors but continue polling
      console.error(`[Video] Poll error:`, pollError);
    }
  }

  // Check for error in operation
  if ((operation as { error?: { message?: string } }).error) {
    const error = (operation as { error?: { message?: string; code?: number } }).error;
    throw new Error(`Video generation failed: ${error?.message || "Unknown error"} (code: ${error?.code})`);
  }

  // Try to extract video from response - handle both Gemini API and Vertex AI response formats
  const videoInfo = extractVideoFromResponse(operation.response);

  if (videoInfo) {
    onProgress?.({
      status: "completed",
      message: "Video generado, descargando...",
      progress: 95,
    });

    const videoData = await downloadVideo(videoInfo);

    onProgress?.({
      status: "completed",
      message: "Video generado exitosamente",
      progress: 100,
    });

    return {
      data: videoData,
      mimeType: videoInfo.mimeType || "video/mp4",
      duration: config.durationSeconds,
      hasAudio: config.generateAudio,
      seed: config.seed!,
    };
  }

  // No video found in any known format
  const responseKeys = operation.response ? Object.keys(operation.response) : [];
  console.error("[Video] No video found in response. Response keys:", responseKeys);
  throw new Error(`Video generation completed but no video in response. Response keys: ${responseKeys.join(", ") || "none"}`);
}

/**
 * Extrae información del video de diferentes formatos de respuesta (Gemini API, Vertex AI, etc.)
 */
function extractVideoFromResponse(response: unknown): { uri?: string; videoBytes?: string; mimeType?: string } | null {
  const resp = response as {
    generatedVideos?: Array<{ video?: { uri?: string; videoBytes?: string } }>;
    videos?: Array<{ gcsUri?: string; mimeType?: string }>;
    generated_videos?: Array<{ video?: { uri?: string } }>;
  } | undefined;

  // Format 1: Gemini API - generatedVideos[].video
  if (resp?.generatedVideos?.[0]?.video) {
    return resp.generatedVideos[0].video;
  }

  // Format 2: Vertex AI REST - videos[].gcsUri
  if (resp?.videos?.[0]?.gcsUri) {
    return { uri: resp.videos[0].gcsUri, mimeType: resp.videos[0].mimeType };
  }

  // Format 3: Python SDK style - generated_videos[].video.uri
  if (resp?.generated_videos?.[0]?.video?.uri) {
    return { uri: resp.generated_videos[0].video.uri };
  }

  return null;
}

/**
 * Descarga el video desde la respuesta de la API
 */
async function downloadVideo(video: { uri?: string; videoBytes?: string }): Promise<Buffer> {
  // Si tenemos los bytes directamente
  if (video.videoBytes) {
    return Buffer.from(video.videoBytes, "base64");
  }

  // Si tenemos una URI, descargar el video
  if (video.uri) {
    const response = await fetch(video.uri);
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  throw new Error("No video data available in response");
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Verifica si el modelo soporta características avanzadas (last frame, reference images)
 * Nota: Según el plan, ambos VEO 3 y VEO 3.1 soportan estas características
 */
export function supportsAdvancedFeatures(modelId: string): boolean {
  return modelId.includes("veo-3");
}

/**
 * Verifica si la API de video está configurada
 */
export function isVideoConfigured(): boolean {
  if (isVertexAI) {
    return !!process.env.GOOGLE_CLOUD_PROJECT && !!process.env.GOOGLE_CLOUD_LOCATION;
  }
  return !!process.env.GOOGLE_API_KEY;
}

/**
 * Obtiene la duración máxima permitida según la resolución
 */
export function getMaxDuration(resolution: "720p" | "1080p"): 4 | 6 | 8 {
  // 1080p solo está disponible para videos de 8 segundos
  return resolution === "1080p" ? 8 : 8;
}

/**
 * Valida la configuración de video
 */
export function validateVideoConfig(config: VideoGenerationConfig): string | null {
  // Validar duración
  if (![4, 6, 8].includes(config.durationSeconds)) {
    return "La duración debe ser 4, 6, u 8 segundos";
  }

  // Validar resolución
  if (!["720p", "1080p"].includes(config.resolution)) {
    return "La resolución debe ser 720p o 1080p";
  }

  // Validar aspect ratio
  if (!["16:9", "9:16"].includes(config.aspectRatio)) {
    return "El aspect ratio debe ser 16:9 o 9:16";
  }

  // 1080p solo disponible para 8 segundos
  if (config.resolution === "1080p" && config.durationSeconds !== 8) {
    return "La resolución 1080p solo está disponible para videos de 8 segundos";
  }

  return null;
}
