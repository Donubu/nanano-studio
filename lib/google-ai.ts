import { GoogleGenAI, Content, Part, GenerateContentConfig } from "@google/genai";

// Determinar si usar Vertex AI o Gemini API
const isVertexAI = process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";

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

export interface ChatMessage {
  role: "user" | "model";
  content: string;
  imageUrl?: string | null;
  imageMimeType?: string | null;
}

export interface ImageGenerationConfig {
  aspectRatio?: "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9";
  imageSize?: "1K" | "2K" | "4K";
}

export interface GenerationSettings {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  imageConfig?: ImageGenerationConfig;
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

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onImage?: (image: GeneratedImage) => void;
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

    // Agregar imagen si existe
    if (msg.imageUrl && msg.imageMimeType) {
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
function normalizeModelId(modelId: string): string {
  if (isVertexAI && modelId.startsWith("models/")) {
    return modelId.replace("models/", "");
  }
  return modelId;
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

// Extraer texto de las partes de respuesta
function extractTextFromParts(parts?: Part[]): string {
  if (!parts) return "";
  return parts
    .filter((part) => part.text)
    .map((part) => part.text)
    .join("");
}

// Enviar mensaje sin streaming
export async function sendMessage(
  modelId: string,
  messages: ChatMessage[],
  systemInstruction: string | null,
  settings: GenerationSettings = {},
  labels?: Labels
): Promise<{
  text: string;
  images: GeneratedImage[];
  tokenCount: { input: number; output: number };
}> {
  const contents = convertToGoogleFormat(messages);

  const config: GenerateContentConfig = {
    temperature: settings.temperature ?? 1.0,
    topP: settings.topP ?? 0.95,
    topK: settings.topK ?? 40,
    maxOutputTokens: settings.maxOutputTokens ?? 8192,
    ...(systemInstruction && { systemInstruction }),
    labels: buildLabels(labels),
    // Configuración para generación de imágenes
    ...(settings.imageConfig && {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: settings.imageConfig.aspectRatio,
        imageSize: settings.imageConfig.imageSize,
      },
    }),
  };

  const response = await ai.models.generateContent({
    model: normalizeModelId(modelId),
    contents,
    config,
  });

  // Extraer partes del primer candidato
  const parts = response.candidates?.[0]?.content?.parts;
  const text = extractTextFromParts(parts);
  const images = extractImagesFromParts(parts);

  return {
    text,
    images,
    tokenCount: {
      input: response.usageMetadata?.promptTokenCount || 0,
      output: response.usageMetadata?.candidatesTokenCount || 0,
    },
  };
}

// Enviar mensaje con streaming
export async function sendMessageStream(
  modelId: string,
  messages: ChatMessage[],
  systemInstruction: string | null,
  settings: GenerationSettings = {},
  callbacks: StreamCallbacks,
  labels?: Labels
): Promise<void> {
  try {
    const contents = convertToGoogleFormat(messages);

    const config: GenerateContentConfig = {
      temperature: settings.temperature ?? 1.0,
      topP: settings.topP ?? 0.95,
      topK: settings.topK ?? 40,
      maxOutputTokens: settings.maxOutputTokens ?? 8192,
      ...(systemInstruction && { systemInstruction }),
      labels: buildLabels(labels),
      // Configuración para generación de imágenes
      ...(settings.imageConfig && {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: settings.imageConfig.aspectRatio,
          imageSize: settings.imageConfig.imageSize,
        },
      }),
    };

    // Debug: log config being sent
    console.log("[Google AI] Config being sent:", JSON.stringify({
      model: normalizeModelId(modelId),
      settingsImageConfig: settings.imageConfig,
      configImageConfig: config.imageConfig,
      responseModalities: config.responseModalities,
    }, null, 2));

    // Nota: Gemini 2.5 Flash Image tiene un bug conocido donde ignora aspectRatio
    // Ver: https://discuss.ai.google.dev/t/gemini-2-5-flash-nano-banana-auto-aspect-ratio-issue/108225

    const responseStream = await ai.models.generateContentStream({
      model: normalizeModelId(modelId),
      contents,
      config,
    });

    let fullText = "";
    const allImages: GeneratedImage[] = [];
    let usageMetadata: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;

    for await (const chunk of responseStream) {
      // Extraer texto del chunk
      const parts = chunk.candidates?.[0]?.content?.parts;
      const chunkText = extractTextFromParts(parts);

      if (chunkText) {
        fullText += chunkText;
        callbacks.onChunk(chunkText);
      }

      // Extraer imágenes del chunk
      const chunkImages = extractImagesFromParts(parts);
      if (chunkImages.length > 0) {
        allImages.push(...chunkImages);
        if (callbacks.onImage) {
          for (const img of chunkImages) {
            callbacks.onImage(img);
          }
        }
      }

      if (chunk.usageMetadata) {
        usageMetadata = chunk.usageMetadata;
      }
    }

    callbacks.onComplete(
      fullText,
      {
        input: usageMetadata?.promptTokenCount || 0,
        output: usageMetadata?.candidatesTokenCount || 0,
      },
      allImages.length > 0 ? allImages : undefined
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
  const TITLE_MODEL = "gemini-2.0-flash-lite";
  const SYSTEM_INSTRUCTION = `Eres un asistente que genera títulos cortos y descriptivos para conversaciones.
Tu tarea es crear un título que resuma el tema principal del mensaje del usuario.

Reglas:
- El título debe tener máximo 40 caracteres
- Debe ser coherente y relevante al contenido
- Debe estar en el mismo idioma que el mensaje
- Solo responde con el título, sin comillas ni explicaciones
- No generes imágenes, videos ni nada adicional`;

  try {
    const config: GenerateContentConfig = {
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 60,
      systemInstruction: SYSTEM_INSTRUCTION,
      labels: buildLabels(labels),
    };

    const response = await ai.models.generateContent({
      model: normalizeModelId(TITLE_MODEL),
      contents: [
        {
          role: "user",
          parts: [{ text: `Genera un título corto para esta conversación:\n\n${userMessage}` }],
        },
      ],
      config,
    });

    const parts = response.candidates?.[0]?.content?.parts;
    let title = extractTextFromParts(parts).trim();

    // Limpiar el título de comillas si las tiene
    title = title.replace(/^["']|["']$/g, "").trim();

    // Asegurar que no exceda 40 caracteres
    if (title.length > 40) {
      title = title.substring(0, 37) + "...";
    }

    return title || "Nueva conversación";
  } catch (error) {
    console.error("[Google AI] Error generating title:", error);
    return "Nueva conversación";
  }
}

// Validar que la API está configurada
export function isConfigured(): boolean {
  if (isVertexAI) {
    return !!process.env.GOOGLE_CLOUD_PROJECT && !!process.env.GOOGLE_CLOUD_LOCATION;
  }
  return !!process.env.GOOGLE_API_KEY;
}

// Exportar si estamos usando Vertex AI (útil para debugging)
export function usingVertexAI(): boolean {
  return isVertexAI;
}
