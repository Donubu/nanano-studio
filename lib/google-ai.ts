import { GoogleGenAI, Content, Part, GenerateContentConfig } from "@google/genai";

// Determinar si usar Vertex AI o Gemini API
const isVertexAI = process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";

// Configuración de retry
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 5000,  // 5 segundos inicial
  maxDelayMs: 60000,     // máximo 60 segundos
  backoffMultiplier: 2,  // duplicar cada vez
};

// Helper para esperar (con soporte para abort)
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  if (signal?.aborted) { resolve(); return; }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  const onAbort = () => { clearTimeout(timer); resolve(); };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
});

// Verificar si el error es retriable (429, 503, etc.)
function isRetriableError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const errorObj = error as { status?: number; code?: number; message?: string };
    // Códigos HTTP retriables
    if (errorObj.status === 429 || errorObj.status === 503 || errorObj.status === 500) {
      return true;
    }
    if (errorObj.code === 429 || errorObj.code === 503 || errorObj.code === 500) {
      return true;
    }
    // Verificar en el mensaje
    const message = errorObj.message?.toLowerCase() || '';
    if (message.includes('resource_exhausted') ||
        message.includes('rate limit') ||
        message.includes('quota') ||
        message.includes('429') ||
        message.includes('503')) {
      return true;
    }
  }
  return false;
}

// Información de retry para callbacks
export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: string;
}

// Ejecutar función con retry y backoff exponencial
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  onRetry?: (info: RetryInfo) => void,
  abortSignal?: AbortSignal
): Promise<T> {
  let lastError: Error | undefined;
  let delay = RETRY_CONFIG.initialDelayMs;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    // Si el cliente se desconectó, no reintentar
    if (abortSignal?.aborted) {
      throw lastError || new Error('Operation cancelled');
    }

    try {
      const result = await operation();

      // Log de recuperación si hubo retries previos
      if (attempt > 0) {
        console.log(`[Google AI] ${operationName} exitoso después de ${attempt} reintento(s)`);
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Si el cliente se desconectó, no reintentar
      if (abortSignal?.aborted) {
        console.warn(`[Google AI] ${operationName} cancelado (cliente desconectado)`);
        throw lastError;
      }

      // Si no es retriable o ya no quedan intentos, lanzar error
      if (!isRetriableError(error) || attempt === RETRY_CONFIG.maxRetries) {
        if (attempt > 0) {
          console.error(`[Google AI] ${operationName} falló después de ${attempt + 1} intento(s). Error final: ${lastError.message}`);
        }
        throw lastError;
      }

      // Log del retry
      console.warn(
        `[Google AI] ${operationName} falló (intento ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}). ` +
        `Reintentando en ${delay / 1000}s... Error: ${lastError.message}`
      );

      // Notificar al callback si existe
      if (onRetry) {
        onRetry({
          attempt: attempt + 1,
          maxAttempts: RETRY_CONFIG.maxRetries + 1,
          delayMs: delay,
          error: lastError.message,
        });
      }

      // Esperar antes de reintentar (se interrumpe si el cliente se desconecta)
      await sleep(delay, abortSignal);

      // Aumentar delay para el siguiente intento (backoff exponencial)
      delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs);
    }
  }

  throw lastError;
}

// Per-model backend resolution
// backend param: 'vertex' | 'gemini' | undefined (use global default)
function useVertexForBackend(backend?: string): boolean {
  if (backend === 'vertex') return true;
  if (backend === 'gemini') return false;
  return isVertexAI;
}

// Lazy dual-client support for per-model backend selection
let vertexClient: GoogleGenAI | null = null;
let geminiClient: GoogleGenAI | null = null;

// Timeout for API calls (10 minutes — image generation in 4K can be very slow)
const API_TIMEOUT_MS = Number(process.env.GOOGLE_AI_TIMEOUT_MS) || 600000;

function getClient(backend?: string): GoogleGenAI {
  if (useVertexForBackend(backend)) {
    if (!vertexClient) {
      vertexClient = new GoogleGenAI({
        vertexai: true,
        project: process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.GOOGLE_CLOUD_LOCATION,
        httpOptions: { timeout: API_TIMEOUT_MS },
      });
    }
    return vertexClient;
  }
  if (!geminiClient) {
    // Use GEMINI_API_KEY (AI Studio key) explicitly to avoid SDK auto-detecting
    // GOOGLE_API_KEY which may be a Vertex AI token, not a standard Gemini API key
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("No Gemini API key configured (GEMINI_API_KEY)");
    geminiClient = new GoogleGenAI({ apiKey, vertexai: false, httpOptions: { timeout: API_TIMEOUT_MS } });
  }
  return geminiClient;
}

export interface AttachedFile {
  dataUrl: string;
  mimeType: string;
  name?: string;
  type: "image" | "document" | "audio";
}

export interface ChatMessage {
  role: "user" | "model";
  content: string;
  // Legacy single file support
  imageUrl?: string | null;
  imageMimeType?: string | null;
  // New multiple files support
  files?: AttachedFile[];
}

export interface ImageGenerationConfig {
  aspectRatio?: "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9";
  imageSize?: "1K" | "2K" | "4K";
}

export type ThinkingLevelSetting = "none" | "low" | "medium" | "high";

export interface GenerationSettings {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  imageConfig?: ImageGenerationConfig;
  googleSearchEnabled?: boolean;
  googleImageSearchEnabled?: boolean;
  thinkingLevel?: ThinkingLevelSetting;
  includeThoughts?: boolean;
}

export interface Labels {
  project_name?: string;
  user_name?: string;
  [key: string]: string | undefined;
}

// Imagen generada por el modelo
export interface GeneratedImage {
  data: string; // Base64
  mimeType: string;
}

// Grounding metadata from Google Search
export interface GroundingData {
  sources: Array<{ title?: string; uri?: string; domain?: string; imageUri?: string }>;
  searchEntryPointHtml?: string;
  webSearchQueries?: string[];
  imageSearchQueries?: string[];
}

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onThought?: (text: string) => void;
  onImage?: (image: GeneratedImage) => void;
  onGrounding?: (data: GroundingData) => void;
  onRetry?: (info: RetryInfo) => void;
  onComplete: (
    fullText: string,
    tokenCount: { input: number; output: number },
    images?: GeneratedImage[]
  ) => void;
  onError: (error: Error) => void;
}

// Convertir mensajes del chat al formato de Google AI
function convertToGoogleFormat(messages: ChatMessage[]): Content[] {
  return messages.map((msg) => {
    const parts: Part[] = [];

    // Agregar archivos múltiples si existen (nuevo formato)
    if (msg.files && msg.files.length > 0) {
      for (const file of msg.files) {
        if (file.dataUrl.startsWith("data:")) {
          const base64Data = file.dataUrl.split(",")[1];
          parts.push({
            inlineData: {
              mimeType: file.mimeType,
              data: base64Data,
            },
          });
        }
      }
    }
    // Legacy: Agregar imagen única si existe (compatibilidad hacia atrás)
    else if (msg.imageUrl && msg.imageMimeType) {
      if (msg.imageUrl.startsWith("data:")) {
        const base64Data = msg.imageUrl.split(",")[1];
        parts.push({
          inlineData: {
            mimeType: msg.imageMimeType,
            data: base64Data,
          },
        });
      }
    }

    // Agregar texto
    if (msg.content) {
      parts.push({ text: msg.content });
    }

    return {
      role: msg.role,
      parts,
    };
  });
}

// Sanitizar valores de labels para Vertex AI
// Labels deben ser: letras minúsculas, números, guiones bajos, guiones
// Máximo 63 caracteres
function sanitizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .substring(0, 63);
}

// Normalizar model ID para compatibilidad entre Gemini API y Vertex AI
// Gemini API usa "models/gemini-..." pero Vertex AI usa solo "gemini-..."
function normalizeModelId(modelId: string, backend?: string): string {
  if (useVertexForBackend(backend) && modelId.startsWith("models/")) {
    return modelId.replace("models/", "");
  }
  return modelId;
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

  // Agregar labels adicionales
  for (const [key, value] of Object.entries(labels)) {
    if (value && key !== "project_name" && key !== "user_name") {
      result[sanitizeLabel(key)] = sanitizeLabel(value);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// Extraer imágenes de las partes de respuesta
function extractImagesFromParts(parts?: Part[]): GeneratedImage[] {
  if (!parts) return [];

  const images: GeneratedImage[] = [];
  for (const part of parts) {
    if (part.inlineData?.data && part.inlineData?.mimeType) {
      images.push({
        data: part.inlineData.data,
        mimeType: part.inlineData.mimeType,
      });
    }
  }
  return images;
}

// Extraer texto de las partes de respuesta (excluyendo thoughts)
function extractTextFromParts(parts?: Part[]): string {
  if (!parts) return "";
  return parts
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join("");
}

// Extraer texto de thoughts
function extractThoughtsFromParts(parts?: Part[]): string {
  if (!parts) return "";
  return parts
    .filter((part) => part.text && part.thought)
    .map((part) => part.text)
    .join("");
}

// Enviar mensaje sin streaming
export async function sendMessage(
  modelId: string,
  messages: ChatMessage[],
  systemInstruction: string | null,
  settings: GenerationSettings = {},
  labels?: Labels,
  backend?: string
): Promise<{
  text: string;
  images: GeneratedImage[];
  tokenCount: { input: number; output: number };
  groundingData?: GroundingData;
}> {
  const contents = convertToGoogleFormat(messages);
  const client = getClient(backend);

  const config: GenerateContentConfig = {
    temperature: settings.temperature ?? 1.0,
    topP: settings.topP ?? 0.95,
    topK: settings.topK ?? 40,
    maxOutputTokens: settings.maxOutputTokens ?? 8192,

    ...(systemInstruction && { systemInstruction }),
    labels: buildLabels(labels, backend),
    // Configuración para generación de imágenes
    ...(settings.imageConfig && {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: settings.imageConfig.aspectRatio,
        imageSize: settings.imageConfig.imageSize,
      },
    }),
    // Google Search grounding
    ...((settings.googleSearchEnabled || settings.googleImageSearchEnabled) && (() => {
      if (settings.googleImageSearchEnabled) {
        const searchTypes: Record<string, object> = { imageSearch: {} };
        if (settings.googleSearchEnabled) searchTypes.webSearch = {};
        return { tools: [{ googleSearch: { searchTypes } }] };
      }
      return { tools: [{ googleSearch: {} }] };
    })()),
    // Thinking/reasoning configuration
    ...(settings.thinkingLevel && settings.thinkingLevel !== "none" && {
      thinkingConfig: {
        thinkingBudget: settings.thinkingLevel === "low" ? 1024 : settings.thinkingLevel === "medium" ? 8192 : 24576,
      },
    }),
    ...(settings.thinkingLevel === "none" && {
      thinkingConfig: {
        thinkingBudget: 0,
      },
    }),
  };

  const response = await withRetry(
    () => client.models.generateContent({
      model: normalizeModelId(modelId, backend),
      contents,
      config,
    }),
    "generateContent"
  );

  // Extraer partes — si hay múltiples candidatos, extraer imágenes de todos
  const candidates = response.candidates || [];
  const parts = candidates[0]?.content?.parts;
  const text = extractTextFromParts(parts);
  let images: GeneratedImage[] = [];
  if (candidates.length > 1) {
    for (const candidate of candidates) {
      images.push(...extractImagesFromParts(candidate.content?.parts));
    }
  } else {
    images = extractImagesFromParts(parts);
  }

  // Extract grounding metadata
  let groundingData: GroundingData | undefined;
  for (const candidate of candidates) {
    const gm = (candidate as Record<string, unknown>).groundingMetadata as Record<string, unknown> | undefined;
    if (settings.googleSearchEnabled || settings.googleImageSearchEnabled) {
      console.log("[Google AI] Grounding metadata:", JSON.stringify(gm || "none", null, 2));
      console.log("[Google AI] Candidate keys:", Object.keys(candidate as Record<string, unknown>));
    }
    if (gm) {
      const sources: GroundingData["sources"] = [];
      const groundingChunks = gm.groundingChunks as Array<{ web?: { uri?: string; title?: string }; image_uri?: string }> | undefined;
      if (groundingChunks) {
        for (const gc of groundingChunks) {
          if (gc.web || gc.image_uri) {
            let domain: string | undefined;
            try { domain = gc.web?.uri ? new URL(gc.web.uri).hostname : undefined; } catch {}
            sources.push({ title: gc.web?.title, uri: gc.web?.uri, domain, imageUri: gc.image_uri });
          }
        }
      }
      const sep = gm.searchEntryPoint as { renderedContent?: string } | undefined;
      const webSearchQueries = gm.webSearchQueries as string[] | undefined;
      const imageSearchQueries = gm.imageSearchQueries as string[] | undefined;
      groundingData = {
        sources,
        searchEntryPointHtml: sep?.renderedContent,
        webSearchQueries,
        imageSearchQueries,
      };
    }
  }

  return {
    text,
    images,
    tokenCount: {
      input: response.usageMetadata?.promptTokenCount || 0,
      output: response.usageMetadata?.candidatesTokenCount || 0,
    },
    groundingData,
  };
}

// Enviar mensaje con streaming
// El retry envuelve el ciclo completo (conexión + consumo del stream)
// para que errores mid-stream (429 durante iteración) también se reintenten
export async function sendMessageStream(
  modelId: string,
  messages: ChatMessage[],
  systemInstruction: string | null,
  settings: GenerationSettings = {},
  callbacks: StreamCallbacks,
  labels?: Labels,
  abortSignal?: AbortSignal,
  backend?: string
): Promise<void> {
  try {
    const contents = convertToGoogleFormat(messages);
    const client = getClient(backend);

    const config: GenerateContentConfig = {
      temperature: settings.temperature ?? 1.0,
      topP: settings.topP ?? 0.95,
      topK: settings.topK ?? 40,
      maxOutputTokens: settings.maxOutputTokens ?? 8192,

      ...(systemInstruction && { systemInstruction }),
      labels: buildLabels(labels, backend),
      // Configuración para generación de imágenes
      ...(settings.imageConfig && {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: settings.imageConfig.aspectRatio,
          imageSize: settings.imageConfig.imageSize,
        },
      }),
      // Google Search grounding
      ...((settings.googleSearchEnabled || settings.googleImageSearchEnabled) && (() => {
        if (settings.googleImageSearchEnabled) {
          const searchTypes: Record<string, object> = { imageSearch: {} };
          if (settings.googleSearchEnabled) searchTypes.webSearch = {};
          return { tools: [{ googleSearch: { searchTypes } }] };
        }
        return { tools: [{ googleSearch: {} }] };
      })()),
      // Thinking/reasoning configuration
      ...(settings.thinkingLevel && settings.thinkingLevel !== "none" && {
        thinkingConfig: {
          thinkingBudget: settings.thinkingLevel === "low" ? 1024 : settings.thinkingLevel === "medium" ? 8192 : 24576,
          ...(settings.includeThoughts && { includeThoughts: true }),
        },
      }),
      ...(settings.thinkingLevel === "none" && {
        thinkingConfig: {
          thinkingBudget: 0,
        },
      }),
    };

    // Debug: log final SDK config when thinking is enabled
    if (settings.thinkingLevel && settings.thinkingLevel !== "none") {
      console.log(`[Google AI] Thinking config:`, JSON.stringify(config.thinkingConfig));
    }

    // withRetry envuelve conexión + consumo completo del stream
    // Si falla mid-stream (429 durante iteración), se reintenta desde cero
    const result = await withRetry(
      async () => {
        const responseStream = await client.models.generateContentStream({
          model: normalizeModelId(modelId, backend),
          contents,
          config,
        });

        let fullText = "";
        const allImages: GeneratedImage[] = [];
        let usageMetadata: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
        let groundingData: GroundingData | undefined;

        for await (const chunk of responseStream) {
          // Extraer texto del primer candidato
          const parts = chunk.candidates?.[0]?.content?.parts;

          // Debug: log parts with thought field
          if (parts && settings.includeThoughts) {
            for (const p of parts) {
              if (p.thought !== undefined) {
                console.log(`[Google AI] Part thought=${p.thought}, text=${p.text?.substring(0, 80)}...`);
              }
            }
          }

          const chunkText = extractTextFromParts(parts);

          if (chunkText) {
            fullText += chunkText;
            callbacks.onChunk(chunkText);
          }

          // Extract thought content if includeThoughts is enabled
          if (callbacks.onThought) {
            const thoughtText = extractThoughtsFromParts(parts);
            if (thoughtText) {
              callbacks.onThought(thoughtText);
            }
          }

          // Extraer imágenes de todos los candidatos (para candidateCount > 1)
          const candidates = chunk.candidates || [];
          for (const candidate of candidates) {
            const chunkImages = extractImagesFromParts(candidate.content?.parts);
            if (chunkImages.length > 0) {
              if (callbacks.onImage) {
                // Stream mode: dispatch each image immediately, don't accumulate in memory
                for (const img of chunkImages) {
                  callbacks.onImage(img);
                }
              } else {
                // Non-stream fallback: accumulate for onComplete
                allImages.push(...chunkImages);
              }
            }

            // Extract grounding metadata from the candidate
            const gm = (candidate as Record<string, unknown>).groundingMetadata as Record<string, unknown> | undefined;
            if (gm) {
              const sources: GroundingData["sources"] = [];
              const groundingChunks = gm.groundingChunks as Array<{ web?: { uri?: string; title?: string }; image_uri?: string }> | undefined;
              if (groundingChunks) {
                for (const gc of groundingChunks) {
                  if (gc.web || gc.image_uri) {
                    let domain: string | undefined;
                    try { domain = gc.web?.uri ? new URL(gc.web.uri).hostname : undefined; } catch {}
                    sources.push({ title: gc.web?.title, uri: gc.web?.uri, domain, imageUri: gc.image_uri });
                  }
                }
              }
              const sep = gm.searchEntryPoint as { renderedContent?: string } | undefined;
              const webSearchQueries = gm.webSearchQueries as string[] | undefined;
              const imageSearchQueries = gm.imageSearchQueries as string[] | undefined;
              groundingData = {
                sources,
                searchEntryPointHtml: sep?.renderedContent,
                webSearchQueries,
                imageSearchQueries,
              };
            }
          }

          if (chunk.usageMetadata) {
            usageMetadata = chunk.usageMetadata;
            // Debug: log thinking token usage
            const meta = chunk.usageMetadata as Record<string, unknown>;
            if (meta.thoughtsTokenCount) {
              console.log(`[Google AI] Thoughts tokens: ${meta.thoughtsTokenCount}, total: ${meta.totalTokenCount}`);
            }
          }
        }

        // Dispatch grounding callback after stream completes
        if (groundingData && callbacks.onGrounding) {
          callbacks.onGrounding(groundingData);
        }

        return { fullText, allImages, usageMetadata };
      },
      "generateContentStream",
      callbacks.onRetry,
      abortSignal
    );

    callbacks.onComplete(
      result.fullText,
      {
        input: result.usageMetadata?.promptTokenCount || 0,
        output: result.usageMetadata?.candidatesTokenCount || 0,
      },
      result.allImages.length > 0 ? result.allImages : undefined
    );
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

// Generar título para una conversación basado en el primer mensaje
// Usa Gemini 2.0 Flash Lite para generar títulos cortos y coherentes
export async function generateConversationTitle(
  userMessage: string,
  labels?: Labels
): Promise<string> {
  const TITLE_MODEL = "gemini-3.1-flash-lite";
  const SYSTEM_INSTRUCTION = `Eres un asistente que genera títulos descriptivos para conversaciones.
Tu tarea es crear un título que resuma el tema principal del mensaje del usuario.

Reglas:
- El título debe ser conciso pero completo (máximo 80 caracteres)
- Debe ser coherente y relevante al contenido
- Debe estar en el mismo idioma que el mensaje
- Solo responde con el título, sin comillas ni explicaciones
- No generes imágenes, videos ni nada adicional`;

  try {
    const config: GenerateContentConfig = {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 100,
      systemInstruction: SYSTEM_INSTRUCTION,
      labels: buildLabels(labels, 'gemini'),
    };

    const response = await withRetry(
      () => getClient('gemini').models.generateContent({
        model: normalizeModelId(TITLE_MODEL, 'gemini'),
        contents: [
          {
            role: "user",
            parts: [{ text: `Genera un título corto para esta conversación:\n\n${userMessage}` }],
          },
        ],
        config,
      }),
      "generateTitle"
    );

    const parts = response.candidates?.[0]?.content?.parts;
    let title = extractTextFromParts(parts).trim();

    // Limpiar el título de comillas si las tiene
    title = title.replace(/^["']|["']$/g, "").trim();

    // Asegurar que no exceda 80 caracteres
    if (title.length > 80) {
      title = title.substring(0, 77) + "...";
    }

    return title || "Nueva conversación";
  } catch (error) {
    console.error("[Google AI] Error generating title:", error);
    return "Nueva conversación";
  }
}

// Validar que la API está configurada (checks both backends since models may use either)
export function isConfigured(): boolean {
  const vertexConfigured = !!process.env.GOOGLE_CLOUD_PROJECT && !!process.env.GOOGLE_CLOUD_LOCATION;
  const geminiConfigured = !!process.env.GEMINI_API_KEY;
  // At least one backend must be configured
  return vertexConfigured || geminiConfigured;
}

// Exportar si estamos usando Vertex AI (útil para debugging)
export function usingVertexAI(): boolean {
  return isVertexAI;
}
