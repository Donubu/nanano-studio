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
  console.log("[Google AI Video] Fetching image from URL:", imageUrl.substring(0, 100));

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
      console.log("[Google AI Video] First frame prepared, length:", preparedFirstFrame.length);
    }

    if (input.lastFrameImage) {
      preparedLastFrame = await prepareImage(input.lastFrameImage);
      console.log("[Google AI Video] Last frame prepared, length:", preparedLastFrame.length);
    }

    if (input.referenceImages && input.referenceImages.length > 0) {
      preparedReferenceImages = await Promise.all(
        input.referenceImages.slice(0, 3).map(async (refImg) => ({
          image: await prepareImage(refImg.image),
          type: refImg.type,
        }))
      );
      console.log("[Google AI Video] Reference images prepared:", preparedReferenceImages.length);
    }

    // Construir la configuración de generación
    const generateConfig: Record<string, unknown> = {
      aspectRatio: config.aspectRatio,
      durationSeconds: config.durationSeconds,
      generateAudio: config.generateAudio,
    };

    // Solo VEO 3+ soporta resolución
    if (modelId.includes("veo-3")) {
      generateConfig.resolution = config.resolution;
    }

    // Agregar negative prompt si existe
    if (config.negativePrompt) {
      generateConfig.negativePrompt = config.negativePrompt;
    }

    // Agregar seed si existe
    if (config.seed !== undefined) {
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

    console.log("[Google AI Video] Generating with config:", {
      model: normalizedModelId,
      aspectRatio: config.aspectRatio,
      durationSeconds: config.durationSeconds,
      generateAudio: config.generateAudio,
      hasNegativePrompt: !!config.negativePrompt,
      labels: builtLabels,
    });

    // Iniciar la operación de generación de video
    const operation = await ai.models.generateVideos({
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
        generateAudio: config.generateAudio,
        ...(config.negativePrompt && { negativePrompt: config.negativePrompt }),
        ...(config.personGeneration && { personGeneration: config.personGeneration }),
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
    });

    // Debug: ver qué devuelve la operación
    console.log("[Google AI Video] Operation received:", {
      type: typeof operation,
      keys: operation ? Object.keys(operation) : [],
      hasResponse: !!operation?.response,
      hasDone: 'done' in operation,
      done: 'done' in operation ? operation.done : undefined,
    });

    // Si la operación ya tiene el resultado (el SDK esperó internamente)
    if (operation?.response?.generatedVideos?.[0]?.video) {
      console.log("[Google AI Video] Video already ready in response!");

      onProgress?.({
        status: "completed",
        message: "Video generado, descargando...",
        progress: 90,
      });

      const videoData = await downloadVideo(operation.response.generatedVideos[0].video);

      onProgress?.({
        status: "completed",
        message: "Video generado exitosamente",
        progress: 100,
      });

      return {
        data: videoData,
        mimeType: "video/mp4",
        duration: config.durationSeconds,
        hasAudio: config.generateAudio,
      };
    }

    onProgress?.({
      status: "processing",
      message: "Video en cola de generación...",
      progress: 20,
    });

    // Polling para esperar a que complete (si el SDK no esperó)
    const video = await pollVideoOperation(operation, config, onProgress);

    return video;
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

    console.log(`[Video Poll #${pollCount}] Elapsed: ${elapsedMinutes}min, done: ${operation.done}`);

    onProgress?.({
      status: "processing",
      message: `Generando video... (${elapsedMinutes} min)`,
      progress: progressPercent,
    });

    try {
      // Actualizar el estado de la operación usando el SDK
      operation = await ai.operations.getVideosOperation({ operation });

      console.log(`[Video Poll #${pollCount}] Updated operation:`, {
        done: operation.done,
        hasResponse: !!operation.response,
        hasVideos: !!operation.response?.generatedVideos?.length,
      });

    } catch (pollError) {
      console.warn(`[Video Poll #${pollCount}] Poll error:`, pollError);
      // Continuar polling a menos que sea un error fatal
    }
  }

  // Operación completada
  console.log(`[Video] Operation completed after ${pollCount} polls`);

  if (operation.response?.generatedVideos?.[0]?.video) {
    onProgress?.({
      status: "completed",
      message: "Video generado, descargando...",
      progress: 95,
    });

    const videoData = await downloadVideo(operation.response.generatedVideos[0].video);

    onProgress?.({
      status: "completed",
      message: "Video generado exitosamente",
      progress: 100,
    });

    return {
      data: videoData,
      mimeType: "video/mp4",
      duration: config.durationSeconds,
      hasAudio: config.generateAudio,
    };
  }

  throw new Error("Video generation completed but no video in response");
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
