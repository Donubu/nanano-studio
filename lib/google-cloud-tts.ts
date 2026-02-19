import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { AudioVoiceId, GeneratedAudio } from "@/types/audio";

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
  if (error && typeof error === "object") {
    const errorObj = error as { code?: number; message?: string };
    if (errorObj.code === 8 || errorObj.code === 14 || errorObj.code === 4) return true; // RESOURCE_EXHAUSTED, UNAVAILABLE, DEADLINE_EXCEEDED
    const message = errorObj.message?.toLowerCase() || "";
    if (message.includes("resource_exhausted") || message.includes("rate limit") ||
        message.includes("quota") || message.includes("unavailable")) return true;
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
        `[Chirp TTS] ${operationName} failed (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}). ` +
        `Retrying in ${delay / 1000}s... Error: ${lastError.message}`
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

// ============================================
// CLIENT
// ============================================

let client: TextToSpeechClient | null = null;

function getClient(): TextToSpeechClient {
  if (!client) {
    client = new TextToSpeechClient();
  }
  return client;
}

// ============================================
// CHIRP AUDIO GENERATION
// ============================================

export interface ChirpConfig {
  voiceId: AudioVoiceId;
  locale?: string;
  speakingRate?: number; // 0.25 to 4.0
  outputFormat?: "mp3" | "ogg_opus" | "linear16";
}

export interface ChirpProgress {
  status: "pending" | "processing" | "completed" | "failed";
  message: string;
}

/**
 * Detects whether input is SSML, Chirp markup, or plain text
 * - SSML: starts with <speak>
 * - Markup: contains [pause], [pause short], or [pause long] (Chirp 3 HD exclusive)
 * - Plain text: everything else
 */
function detectInputType(text: string): { text?: string; ssml?: string } {
  const trimmed = text.trim();
  if (trimmed.startsWith("<speak>") && trimmed.endsWith("</speak>")) {
    return { ssml: trimmed };
  }
  // Note: markup field may not be supported by all client library versions
  // For now, convert [pause] tags to SSML <break> equivalents
  if (/\[pause(\s+(short|long))?\]/.test(trimmed)) {
    const ssmlText = trimmed
      .replace(/\[pause long\]/g, '<break time="1500ms"/>')
      .replace(/\[pause short\]/g, '<break time="300ms"/>')
      .replace(/\[pause\]/g, '<break time="750ms"/>');
    return { ssml: `<speak>${ssmlText}</speak>` };
  }
  return { text: trimmed };
}

/**
 * Generates audio using Google Cloud TTS Chirp 3 HD
 * Voice name format: {locale}-Chirp3-HD-{VoiceName}
 * Returns encoded audio directly (no PCM conversion needed)
 */
export async function generateChirpAudio(
  text: string,
  config: ChirpConfig,
  onProgress?: (progress: ChirpProgress) => void,
  onRetryInfo?: (info: RetryInfo) => void
): Promise<GeneratedAudio> {
  const ttsClient = getClient();
  const locale = config.locale || "es-US";
  const speakingRate = config.speakingRate || 1.0;
  const outputFormat = config.outputFormat || "mp3";

  // Build the Chirp 3 HD voice name
  const voiceName = `${locale}-Chirp3-HD-${config.voiceId}`;

  onProgress?.({
    status: "processing",
    message: "Generando audio con Chirp 3 HD...",
  });

  // Determine audio encoding
  let audioEncoding: "MP3" | "OGG_OPUS" | "LINEAR16";
  let mimeType: string;
  let sampleRateHertz: number;

  switch (outputFormat) {
    case "ogg_opus":
      audioEncoding = "OGG_OPUS";
      mimeType = "audio/ogg";
      sampleRateHertz = 24000;
      break;
    case "linear16":
      audioEncoding = "LINEAR16";
      mimeType = "audio/wav";
      sampleRateHertz = 24000;
      break;
    case "mp3":
    default:
      audioEncoding = "MP3";
      mimeType = "audio/mpeg";
      sampleRateHertz = 24000;
      break;
  }

  // Detect input type: SSML, Chirp markup, or plain text
  const input = detectInputType(text);

  try {
    const result = await withRetry(
      () => ttsClient.synthesizeSpeech({
        input,
        voice: {
          languageCode: locale,
          name: voiceName,
        },
        audioConfig: {
          audioEncoding: audioEncoding as unknown as number,
          speakingRate,
          sampleRateHertz,
        },
      }),
      "generateChirpAudio",
      (info) => {
        onRetryInfo?.(info);
        onProgress?.({
          status: "processing",
          message: `Reintentando (${info.attempt}/${info.maxAttempts})... Esperando ${Math.round(info.delayMs / 1000)}s`,
        });
      }
    );
    const response = result[0];

    if (!response.audioContent) {
      throw new Error("No audio content in Chirp TTS response");
    }

    const audioBuffer = Buffer.from(response.audioContent as Uint8Array);
    const duration = estimateChirpDuration(audioBuffer, outputFormat);

    onProgress?.({
      status: "completed",
      message: "Audio Chirp HD generado exitosamente",
    });

    return {
      data: audioBuffer,
      mimeType,
      duration,
      sampleRate: sampleRateHertz,
    };
  } catch (error) {
    console.error("[Chirp TTS] Error generating audio:", error);
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
 * Checks if Google Cloud TTS is configured
 */
export function isChirpConfigured(): boolean {
  return !!process.env.GOOGLE_APPLICATION_CREDENTIALS && !!process.env.GOOGLE_CLOUD_PROJECT;
}

/**
 * Estimates audio duration from buffer size
 * MP3 ~128kbps = 16KB/s
 * OGG_OPUS ~96kbps = 12KB/s
 * LINEAR16 24kHz mono = 48KB/s
 */
function estimateChirpDuration(buffer: Buffer, format: string): number {
  const bytes = buffer.length;
  switch (format) {
    case "ogg_opus":
      return Math.round(bytes / 12000);
    case "linear16":
      return Math.round(bytes / 48000);
    case "mp3":
    default:
      return Math.round(bytes / 16000);
  }
}

/**
 * Validates text length for Chirp TTS (5000 bytes max)
 */
export function validateChirpTextLength(text: string): string | null {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > 5000) {
    return `El texto excede el límite de 5000 bytes para Chirp HD (actual: ${bytes} bytes)`;
  }
  return null;
}

/**
 * Builds the full Chirp voice name from locale and voice ID
 */
export function buildChirpVoiceName(locale: string, voiceId: string): string {
  return `${locale}-Chirp3-HD-${voiceId}`;
}
