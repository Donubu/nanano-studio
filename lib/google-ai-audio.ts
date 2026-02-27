import { GoogleGenAI } from "@google/genai";
import { spawn } from "child_process";
import { AudioVoiceId, AudioSpeaker, GeneratedAudio } from "@/types/audio";

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
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isRetriableError(error) || attempt === RETRY_CONFIG.maxRetries) throw lastError;

      console.warn(
        `[Audio] ${operationName} falló (intento ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}). ` +
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

export interface SingleSpeakerConfig {
  voiceId: AudioVoiceId;
  stylePrompt?: string;
}

export interface MultiSpeakerConfig {
  speakers: AudioSpeaker[];
  stylePrompt?: string;
}

export interface AudioGenerationProgress {
  status: "pending" | "processing" | "completed" | "failed";
  message: string;
}

// ============================================
// SINGLE SPEAKER GENERATION
// ============================================

/**
 * Genera audio con una sola voz usando Gemini TTS
 */
export async function generateSingleSpeakerAudio(
  modelId: string,
  text: string,
  config: SingleSpeakerConfig,
  onProgress?: (progress: AudioGenerationProgress) => void,
  labels?: Labels,
  backend?: string
): Promise<GeneratedAudio> {
  const normalizedModelId = normalizeModelId(modelId, backend);
  const client = getClient(backend);

  onProgress?.({
    status: "processing",
    message: "Generando audio...",
  });

  try {
    // Build the prompt with optional style instructions
    const prompt = config.stylePrompt
      ? `${config.stylePrompt}\n\n${text}`
      : text;

    const response = await withRetry(
      () => client.models.generateContent({
        model: normalizedModelId,
        contents: [{
          role: "user",
          parts: [{ text: prompt }]
        }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: config.voiceId,
              },
            },
          },
        },
      }),
      "generateSingleSpeakerAudio",
      (info) => {
        onProgress?.({
          status: "processing",
          message: `Reintentando (${info.attempt}/${info.maxAttempts})... Esperando ${Math.round(info.delayMs / 1000)}s`,
        });
      }
    );

    const audioData = extractAudioFromResponse(response);

    if (!audioData) {
      throw new Error("No audio data in response");
    }

    onProgress?.({
      status: "completed",
      message: "Audio generado exitosamente",
    });

    return {
      data: Buffer.from(audioData.data, "base64"),
      mimeType: audioData.mimeType || "audio/L16;rate=24000",
      duration: estimateAudioDuration(audioData.data),
      sampleRate: 24000,
    };
  } catch (error) {
    console.error("[Google AI Audio] Error generating audio:", error);
    onProgress?.({
      status: "failed",
      message: error instanceof Error ? error.message : "Error desconocido",
    });
    throw error;
  }
}

// ============================================
// MULTI-SPEAKER GENERATION
// ============================================

/**
 * Genera audio con múltiples voces (diálogo) usando Gemini TTS
 * El texto debe contener nombres de speakers en formato:
 * Speaker1: Texto del speaker 1
 * Speaker2: Texto del speaker 2
 */
export async function generateMultiSpeakerAudio(
  modelId: string,
  text: string,
  config: MultiSpeakerConfig,
  onProgress?: (progress: AudioGenerationProgress) => void,
  labels?: Labels,
  backend?: string
): Promise<GeneratedAudio> {
  const normalizedModelId = normalizeModelId(modelId, backend);
  const client = getClient(backend);

  onProgress?.({
    status: "processing",
    message: "Generando diálogo multi-speaker...",
  });

  try {
    // Build speaker voice configurations
    const speakerVoiceConfigs = config.speakers.map((speaker) => ({
      speaker: speaker.name,
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: speaker.voiceId,
        },
      },
    }));

    // Build the prompt with optional style instructions
    const prompt = config.stylePrompt
      ? `${config.stylePrompt}\n\n${text}`
      : text;

    const response = await withRetry(
      () => client.models.generateContent({
        model: normalizedModelId,
        contents: [{
          role: "user",
          parts: [{ text: prompt }]
        }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs,
            },
          },
        },
      }),
      "generateMultiSpeakerAudio",
      (info) => {
        onProgress?.({
          status: "processing",
          message: `Reintentando (${info.attempt}/${info.maxAttempts})... Esperando ${Math.round(info.delayMs / 1000)}s`,
        });
      }
    );

    const audioData = extractAudioFromResponse(response);

    if (!audioData) {
      throw new Error("No audio data in response");
    }

    onProgress?.({
      status: "completed",
      message: "Diálogo generado exitosamente",
    });

    return {
      data: Buffer.from(audioData.data, "base64"),
      mimeType: audioData.mimeType || "audio/L16;rate=24000",
      duration: estimateAudioDuration(audioData.data),
      sampleRate: 24000,
    };
  } catch (error) {
    console.error("[Google AI Audio] Error generating multi-speaker audio:", error);
    onProgress?.({
      status: "failed",
      message: error instanceof Error ? error.message : "Error desconocido",
    });
    throw error;
  }
}

// ============================================
// AUDIO CONVERSION (PCM to MP3/WAV)
// ============================================

/**
 * Convierte audio PCM16 24kHz a MP3 usando ffmpeg
 * Requiere ffmpeg instalado en el sistema
 */
export async function convertPcmToMp3(pcmBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-f", "s16le",           // Input format: signed 16-bit little-endian
      "-ar", "24000",          // Sample rate: 24kHz
      "-ac", "1",              // Channels: mono
      "-i", "pipe:0",          // Input from stdin
      "-codec:a", "libmp3lame",
      "-b:a", "128k",          // Bitrate
      "-f", "mp3",             // Output format
      "pipe:1"                 // Output to stdout
    ]);

    const chunks: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on("data", (data) => {
      // ffmpeg outputs progress to stderr, ignore unless error
      const output = data.toString();
      if (output.includes("Error") || output.includes("error")) {
        console.error("[ffmpeg]", output);
      }
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });

    // Write PCM data to ffmpeg stdin
    ffmpeg.stdin.write(pcmBuffer);
    ffmpeg.stdin.end();
  });
}

/**
 * Convierte audio PCM16 24kHz a WAV
 * Agrega el header WAV al buffer PCM
 */
export function convertPcmToWav(pcmBuffer: Buffer): Buffer {
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const fileSize = 36 + dataSize;

  const wavHeader = Buffer.alloc(44);

  // RIFF header
  wavHeader.write("RIFF", 0);
  wavHeader.writeUInt32LE(fileSize, 4);
  wavHeader.write("WAVE", 8);

  // fmt subchunk
  wavHeader.write("fmt ", 12);
  wavHeader.writeUInt32LE(16, 16);           // Subchunk1Size (16 for PCM)
  wavHeader.writeUInt16LE(1, 20);            // AudioFormat (1 = PCM)
  wavHeader.writeUInt16LE(numChannels, 22);  // NumChannels
  wavHeader.writeUInt32LE(sampleRate, 24);   // SampleRate
  wavHeader.writeUInt32LE(byteRate, 28);     // ByteRate
  wavHeader.writeUInt16LE(blockAlign, 32);   // BlockAlign
  wavHeader.writeUInt16LE(bitsPerSample, 34);// BitsPerSample

  // data subchunk
  wavHeader.write("data", 36);
  wavHeader.writeUInt32LE(dataSize, 40);

  return Buffer.concat([wavHeader, pcmBuffer]);
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
 * Extrae datos de audio de la respuesta de la API
 */
function extractAudioFromResponse(response: unknown): { data: string; mimeType?: string } | null {
  const resp = response as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: {
            data?: string;
            mimeType?: string;
          };
        }>;
      };
    }>;
  };

  const inlineData = resp?.candidates?.[0]?.content?.parts?.[0]?.inlineData;

  if (inlineData?.data) {
    return {
      data: inlineData.data,
      mimeType: inlineData.mimeType,
    };
  }

  return null;
}

/**
 * Estima la duración del audio basándose en el tamaño del buffer
 * PCM16 a 24kHz = 48000 bytes por segundo (24000 samples * 2 bytes)
 */
function estimateAudioDuration(base64Data: string): number {
  const bytes = Buffer.from(base64Data, "base64").length;
  const bytesPerSecond = 24000 * 2; // 24kHz * 16-bit (2 bytes)
  return Math.round(bytes / bytesPerSecond);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Verifica si la API de audio está configurada
 */
export function isAudioConfigured(): boolean {
  const vertexConfigured = !!process.env.GOOGLE_CLOUD_PROJECT && !!process.env.GOOGLE_CLOUD_LOCATION;
  const geminiConfigured = !!process.env.GEMINI_API_KEY;
  return vertexConfigured || geminiConfigured;
}

/**
 * Valida que el texto no exceda los límites de la API
 * Límite: 4000 bytes para texto
 */
export function validateTextLength(text: string): string | null {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > 4000) {
    return `El texto excede el límite de 4000 bytes (actual: ${bytes} bytes)`;
  }
  return null;
}

/**
 * Valida la configuración de speakers para multi-speaker
 */
export function validateMultiSpeakerConfig(
  text: string,
  speakers: AudioSpeaker[]
): string | null {
  if (speakers.length === 0) {
    return "Se requiere al menos un speaker para modo multi-speaker";
  }

  if (speakers.length > 10) {
    return "Máximo 10 speakers permitidos";
  }

  // Verificar que el texto contenga referencias a los speakers
  for (const speaker of speakers) {
    if (!text.includes(`${speaker.name}:`)) {
      return `El texto debe contener diálogos del speaker "${speaker.name}" en formato "${speaker.name}: texto"`;
    }
  }

  return null;
}
