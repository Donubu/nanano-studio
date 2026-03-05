import { GoogleGenAI, type LiveMusicServerMessage, type LiveMusicGenerationConfig, MusicGenerationMode, Scale } from "@google/genai";
import { spawn } from "child_process";
import type { MusicGenerationSettings, GeneratedMusic, MusicGenerationStatus, WeightedPrompt } from "@/types/music";

// ============================================
// CLIENT SETUP (Gemini API only, v1alpha for Lyria)
// ============================================

let musicClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!musicClient) {
    musicClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      vertexai: false,
      httpOptions: { apiVersion: "v1alpha", timeout: 300000 },
    });
  }
  return musicClient;
}

const LYRIA_MODEL = "models/lyria-realtime-exp";
const LYRIA_SAMPLE_RATE = 44100;
const LYRIA_CHANNELS = 2; // stereo
const LYRIA_BITS_PER_SAMPLE = 16;
const LYRIA_BYTES_PER_SECOND = LYRIA_SAMPLE_RATE * LYRIA_CHANNELS * (LYRIA_BITS_PER_SAMPLE / 8); // 176400 bytes/sec

// ============================================
// RETRY CONFIG
// ============================================

const RETRY_CONFIG = {
  maxRetries: 2,
  initialDelayMs: 5000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isRetriableError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const errorObj = error as { status?: number; code?: number; message?: string };
    if (errorObj.status === 429 || errorObj.status === 503 || errorObj.status === 500) return true;
    if (errorObj.code === 429 || errorObj.code === 503 || errorObj.code === 500) return true;
    const message = errorObj.message?.toLowerCase() || "";
    if (message.includes("resource_exhausted") || message.includes("rate limit") ||
        message.includes("quota") || message.includes("429") || message.includes("503")) return true;
  }
  return false;
}

// ============================================
// PROGRESS CALLBACK
// ============================================

export interface MusicGenerationProgress {
  status: MusicGenerationStatus;
  message: string;
  percent?: number;
}

// ============================================
// MUSIC GENERATION VIA LIVE MUSIC API
// ============================================

/**
 * Genera musica instrumental usando Google Lyria via Live Music API (WebSocket).
 * Acumula chunks PCM hasta alcanzar la duracion deseada, luego cierra la conexion.
 */
export async function generateMusic(
  settings: MusicGenerationSettings,
  onProgress?: (progress: MusicGenerationProgress) => void,
): Promise<GeneratedMusic> {
  const client = getClient();
  const targetDurationSec = settings.duration;
  const targetBytes = targetDurationSec * LYRIA_BYTES_PER_SECOND;

  let lastError: Error | undefined;
  let delay = RETRY_CONFIG.initialDelayMs;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await doGenerate(client, settings, targetDurationSec, targetBytes, onProgress);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!isRetriableError(error) || attempt === RETRY_CONFIG.maxRetries) throw lastError;

      console.warn(
        `[Music] Generacion fallida (intento ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}). ` +
        `Reintentando en ${delay / 1000}s... Error: ${lastError.message}`
      );

      onProgress?.({
        status: "generating",
        message: `Reintentando (${attempt + 1}/${RETRY_CONFIG.maxRetries + 1})... Esperando ${Math.round(delay / 1000)}s`,
      });

      await sleep(delay);
      delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs);
    }
  }
  throw lastError;
}

async function doGenerate(
  client: GoogleGenAI,
  settings: MusicGenerationSettings,
  targetDurationSec: number,
  targetBytes: number,
  onProgress?: (progress: MusicGenerationProgress) => void,
): Promise<GeneratedMusic> {
  onProgress?.({
    status: "connecting",
    message: "Conectando con Lyria...",
  });

  // Build weighted prompts for the API
  const weightedPrompts = settings.prompts
    .filter(p => p.text.trim().length > 0)
    .map(p => ({ text: p.text.trim(), weight: p.weight }));

  if (weightedPrompts.length === 0) {
    throw new Error("Se requiere al menos un prompt con texto");
  }

  // Build music generation config
  const musicGenConfig: LiveMusicGenerationConfig = {
    bpm: settings.bpm,
    density: settings.density,
    brightness: settings.brightness,
    guidance: settings.guidance,
    musicGenerationMode: settings.generationMode as MusicGenerationMode,
    muteBass: settings.muteBass,
    muteDrums: settings.muteDrums,
    onlyBassAndDrums: settings.onlyBassAndDrums,
  };

  if (settings.scale !== "UNSPECIFIED") {
    musicGenConfig.scale = settings.scale as Scale;
  }

  // Accumulate PCM chunks via callback
  const pcmChunks: Buffer[] = [];
  let totalBytes = 0;
  let sessionError: Error | null = null;
  let resolveGeneration: (() => void) | null = null;
  let rejectGeneration: ((err: Error) => void) | null = null;

  const generationPromise = new Promise<void>((resolve, reject) => {
    resolveGeneration = resolve;
    rejectGeneration = reject;
  });

  // Connect via Live Music API (callback-based WebSocket)
  console.log("[Music] Connecting to Lyria...");
  const session = await client.live.music.connect({
    model: LYRIA_MODEL,
    callbacks: {
      onmessage: (message: LiveMusicServerMessage) => {
        // setupComplete indicates we can start sending commands
        if (message.setupComplete) {
          console.log("[Music] Setup complete, ready to generate");
          return;
        }

        // Handle filtered prompts
        if (message.filteredPrompt) {
          console.warn("[Music] Prompt filtered:", message.filteredPrompt.text, "-", message.filteredPrompt.filteredReason);
          return;
        }

        // Handle audio chunks
        const audioChunk = message.audioChunk;
        if (audioChunk?.data) {
          const chunk = Buffer.from(audioChunk.data, "base64");
          pcmChunks.push(chunk);
          totalBytes += chunk.length;

          const percent = Math.min(Math.round((totalBytes / targetBytes) * 100), 99);
          onProgress?.({
            status: "generating",
            message: `Generando musica... ${Math.round(totalBytes / LYRIA_BYTES_PER_SECOND)}s / ${targetDurationSec}s`,
            percent,
          });

          // We have enough audio data
          if (totalBytes >= targetBytes) {
            console.log(`[Music] Target reached: ${totalBytes} bytes (${Math.round(totalBytes / LYRIA_BYTES_PER_SECOND)}s)`);
            resolveGeneration?.();
          }
        }
      },
      onerror: (e: ErrorEvent) => {
        console.error("[Music] WebSocket error:", e.message);
        sessionError = new Error(`Lyria WebSocket error: ${e.message}`);
        rejectGeneration?.(sessionError);
      },
      onclose: () => {
        console.log("[Music] WebSocket closed, totalBytes:", totalBytes);
        // If we haven't reached target but connection closed, resolve anyway (we'll check totalBytes later)
        resolveGeneration?.();
      },
    },
  });

  console.log("[Music] Connected, setting config and prompts...");

  onProgress?.({
    status: "generating",
    message: "Generando musica...",
    percent: 0,
  });

  try {
    // Set generation config
    await session.setMusicGenerationConfig({ musicGenerationConfig: musicGenConfig });

    // Set weighted prompts
    await session.setWeightedPrompts({ weightedPrompts });

    // Start playback
    await session.play();
    console.log("[Music] Playback started, waiting for audio chunks...");

    // Wait for enough data or connection close, with timeout
    const timeoutMs = (targetDurationSec + 60) * 1000; // target duration + 60s buffer
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: no se recibio suficiente audio en ${timeoutMs / 1000}s`)), timeoutMs)
    );

    await Promise.race([generationPromise, timeoutPromise]);

    // Close session
    try { session.close(); } catch { /* ignore */ }
  } catch (error) {
    try { session.close(); } catch { /* ignore */ }
    if (sessionError) throw sessionError;
    throw error;
  }

  if (totalBytes === 0) {
    throw new Error("No se recibieron datos de audio de Lyria");
  }

  // Trim to exact target if we received more
  let pcmBuffer = Buffer.concat(pcmChunks);
  if (pcmBuffer.length > targetBytes) {
    pcmBuffer = pcmBuffer.subarray(0, targetBytes);
  }
  const actualDuration = Math.round(pcmBuffer.length / LYRIA_BYTES_PER_SECOND);

  onProgress?.({
    status: "generating",
    message: `Musica generada: ${actualDuration}s`,
    percent: 100,
  });

  console.log(`[Music] Generation complete: ${actualDuration}s, ${pcmBuffer.length} bytes`);

  return {
    data: pcmBuffer,
    mimeType: `audio/L16;rate=${LYRIA_SAMPLE_RATE};channels=${LYRIA_CHANNELS}`,
    duration: actualDuration,
    sampleRate: LYRIA_SAMPLE_RATE,
  };
}

// ============================================
// PCM TO MP3 CONVERSION
// ============================================

/**
 * Convierte PCM 16-bit stereo 44.1kHz a MP3 192kbps usando ffmpeg
 */
export async function convertMusicPcmToMp3(pcmBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-f", "s16le",           // Input format: signed 16-bit little-endian
      "-ar", "44100",          // Sample rate: 44.1kHz
      "-ac", "2",              // Channels: stereo
      "-i", "pipe:0",          // Input from stdin
      "-codec:a", "libmp3lame",
      "-b:a", "192k",          // Bitrate: 192kbps for music quality
      "-f", "mp3",             // Output format
      "pipe:1"                 // Output to stdout
    ]);

    const chunks: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on("data", (data) => {
      const output = data.toString();
      if (output.includes("Error") || output.includes("error")) {
        console.error("[ffmpeg-music]", output);
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

    ffmpeg.stdin.write(pcmBuffer);
    ffmpeg.stdin.end();
  });
}

// ============================================
// VALIDATION
// ============================================

/**
 * Verifica si la API de musica esta configurada
 */
export function isMusicConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * Valida la configuracion de generacion de musica
 */
export function validateMusicConfig(settings: MusicGenerationSettings): string | null {
  const validPrompts = settings.prompts.filter(p => p.text.trim().length > 0);
  if (validPrompts.length === 0) {
    return "Se requiere al menos un prompt con texto";
  }

  for (const p of settings.prompts) {
    if (p.weight < 0 || p.weight > 1) {
      return "El peso del prompt debe estar entre 0 y 1";
    }
  }

  if (settings.bpm < 60 || settings.bpm > 200) {
    return "BPM debe estar entre 60 y 200";
  }

  if (settings.density < 0 || settings.density > 1) {
    return "Densidad debe estar entre 0 y 1";
  }

  if (settings.brightness < 0 || settings.brightness > 1) {
    return "Brillo debe estar entre 0 y 1";
  }

  if (settings.guidance < 1 || settings.guidance > 6) {
    return "Guia debe estar entre 1 y 6";
  }

  if (settings.duration < 10 || settings.duration > 120) {
    return "Duracion debe estar entre 10 y 120 segundos";
  }

  return null;
}

/**
 * Estima la duracion del audio PCM de Lyria
 * PCM16 stereo a 44.1kHz = 176400 bytes/sec
 */
export function estimateMusicDuration(pcmBuffer: Buffer): number {
  return Math.round(pcmBuffer.length / LYRIA_BYTES_PER_SECOND);
}

/**
 * Construye un resumen legible de la configuracion de musica para el titulo
 */
export function buildMusicPromptSummary(prompts: WeightedPrompt[]): string {
  return prompts
    .filter(p => p.text.trim().length > 0)
    .map(p => p.text.trim())
    .join(" + ");
}
