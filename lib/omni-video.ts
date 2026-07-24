/**
 * Gemini Omni video generation (interactions API).
 *
 * Endpoint: POST https://generativelanguage.googleapis.com/v1beta/interactions
 * Poll:     GET  https://generativelanguage.googleapis.com/v1beta/interactions/{id}
 *
 * Distinto a VEO (LRO generateVideos): la interactions API no acepta duración,
 * resolución, negative prompt ni seed. Salida fija 720p/24fps con audio siempre
 * integrado; aspect ratio 16:9 o 9:16; la duración se pide en el prompt.
 *
 * Se usa fetch crudo y no @google/genai porque la versión instalada (1.43.0)
 * expone `interactions` pero sus tipos no cubren el modo video (sin video_config
 * ni response_format de video). Migrar al SDK cuando lo tipee.
 *
 * Pricing (docs): input $1.50/1M tok; output de video $17.50/1M tok a
 * 5.792 tok/seg de 720p (≈ $0.10/seg). Si la respuesta trae usage, calculamos
 * el costo exacto y lo devolvemos en GeneratedVideo.actualCost.
 *
 * store=true SIEMPRE: el interaction id (v1_...) queda editable después vía
 * previous_interaction_id (fase 2). Se devuelve en GeneratedVideo.providerRef.
 */

import { GeneratedVideo, VideoGenerationProgress } from "./google-ai-video";

const OMNI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const OMNI_INPUT_COST_PER_TOKEN = 1.5 / 1_000_000;
const OMNI_VIDEO_OUTPUT_COST_PER_TOKEN = 17.5 / 1_000_000;
const OMNI_TEXT_OUTPUT_COST_PER_TOKEN = 9 / 1_000_000;
const OMNI_VIDEO_TOKENS_PER_SECOND = 5792;

const POLLING_CONFIG = {
  initialDelayMs: Number(process.env.VIDEO_POLLING_INITIAL_DELAY_MS) || 5000,
  maxDelayMs: Number(process.env.VIDEO_POLLING_MAX_DELAY_MS) || 30000,
  backoffMultiplier: Number(process.env.VIDEO_POLLING_BACKOFF_MULTIPLIER) || 1.5,
  maxDurationMs: Number(process.env.VIDEO_GENERATION_TIMEOUT_MS) || 900000,
};

const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 5000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

// Files API: espera corta a que el archivo generado pase a ACTIVE.
const FILE_ACTIVE_TIMEOUT_MS = 120000;
const FILE_ACTIVE_POLL_MS = 2000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================
// TYPES
// ============================================

export type OmniAspectRatio = "16:9" | "9:16";

export interface OmniVideoConfig {
  aspectRatio: OmniAspectRatio;
  // Fase 2: id de una interaction previa (messages.provider_generation_ref) para
  // edición conversacional. Hoy el route no lo envía.
  previousInteractionId?: string;
}

export interface OmniImageInputs {
  // Data URL / base64 crudo, o URL http (canvas manda URLs de CloudFront; se
  // descarga y convierte a inline).
  firstFrame?: string;
  // Reservado para v1.5 (<IMAGE_REF_N>): aún sin cablear en route/UI.
  referenceImages?: string[];
}

interface OmniContentPart {
  type?: string;
  text?: string;
  data?: string;
  mime_type?: string;
  mimeType?: string;
  uri?: string;
}

interface OmniStep {
  type?: string;
  content?: OmniContentPart[];
}

// Shape verificado contra una interaction real (2026-07-24). Ojo: los tokens
// de video facturados pueden exceder la duración real del mp4 (ej: video de 6s
// facturado como 57.920 tokens = 10s×5792), por eso la duración se saca del
// mp4 y el costo de los tokens.
interface OmniTokensByModality {
  modality?: string;
  tokens?: number;
}

interface OmniUsage {
  total_tokens?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  input_tokens_by_modality?: OmniTokensByModality[];
  output_tokens_by_modality?: OmniTokensByModality[];
  total_thought_tokens?: number;
  [key: string]: unknown;
}

interface OmniInteraction {
  id?: string;
  status?: string;
  steps?: OmniStep[];
  outputs?: OmniContentPart[];
  output_video?: { uri?: string; data?: string };
  usage?: OmniUsage;
  error?: { message?: string } | string;
}

// ============================================
// CONFIGURATION
// ============================================

export function isOmniConfigured(): boolean {
  return !!(process.env.GEMINI_API_KEY_OMNI || process.env.GEMINI_API_KEY);
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY_OMNI || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured");
  return key;
}

function isRetriableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503;
}

// ============================================
// VALIDATION
// ============================================

const VALID_ASPECT_RATIOS: OmniAspectRatio[] = ["16:9", "9:16"];

export function validateOmniVideoConfig(config: OmniVideoConfig): string | null {
  if (!VALID_ASPECT_RATIOS.includes(config.aspectRatio)) {
    return `Proporción inválida para Gemini Omni. Debe ser una de: ${VALID_ASPECT_RATIOS.join(", ")}`;
  }
  return null;
}

// ============================================
// IMAGE INPUT HANDLING
// ============================================

interface InlineImage {
  data: string;     // base64 sin prefijo
  mimeType: string; // image/jpeg | image/png
}

async function resolveImageInput(source: string): Promise<InlineImage> {
  const dataUrlMatch = source.match(/^data:(image\/(?:jpeg|jpg|png));base64,(.+)$/);
  if (dataUrlMatch) {
    const mime = dataUrlMatch[1] === "image/jpg" ? "image/jpeg" : dataUrlMatch[1];
    return { data: dataUrlMatch[2], mimeType: mime };
  }

  if (source.startsWith("http://") || source.startsWith("https://")) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`No se pudo descargar la imagen de referencia (${response.status})`);
    }
    const contentType = response.headers.get("content-type") || "";
    const mimeType = contentType.includes("png") ? "image/png" : "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    return { data: buffer.toString("base64"), mimeType };
  }

  // Base64 crudo sin prefijo: asumimos jpeg (mismo criterio que otros módulos).
  return { data: source, mimeType: "image/jpeg" };
}

// ============================================
// MP4 DURATION PROBE (fallback cuando no hay usage)
// ============================================

/**
 * Lee la duración del mp4 desde el box moov/mvhd. Parser mínimo sin
 * dependencias; retorna null si no encuentra un mvhd válido.
 */
export function probeMp4DurationSeconds(buffer: Buffer): number | null {
  const marker = Buffer.from("mvhd");
  let offset = buffer.indexOf(marker);
  while (offset !== -1) {
    // offset apunta al tipo del box; el contenido parte 4 bytes después.
    const body = offset + 4;
    if (body + 20 <= buffer.length) {
      const version = buffer.readUInt8(body);
      try {
        if (version === 0 && body + 20 <= buffer.length) {
          const timescale = buffer.readUInt32BE(body + 12);
          const duration = buffer.readUInt32BE(body + 16);
          if (timescale > 0 && duration > 0) return duration / timescale;
        } else if (version === 1 && body + 32 <= buffer.length) {
          const timescale = buffer.readUInt32BE(body + 20);
          const duration = Number(buffer.readBigUInt64BE(body + 24));
          if (timescale > 0 && duration > 0) return duration / timescale;
        }
      } catch {
        // buffer truncado: seguir buscando otro mvhd
      }
    }
    offset = buffer.indexOf(marker, offset + 4);
  }
  return null;
}

// ============================================
// MAIN GENERATION FUNCTION
// ============================================

export async function generateOmniVideo(
  modelId: string,
  prompt: string,
  config: OmniVideoConfig,
  onProgress?: (progress: VideoGenerationProgress) => void,
  imageInputs?: OmniImageInputs,
): Promise<GeneratedVideo> {
  const apiKey = getApiKey();

  onProgress?.({
    status: "pending",
    message: "Iniciando generación con Gemini Omni...",
  });

  // task derivada de los inputs, no elegida por el usuario.
  const hasFirstFrame = !!imageInputs?.firstFrame;
  const task = hasFirstFrame ? "image_to_video" : "text_to_video";

  let input: string | Array<Record<string, unknown>>;
  if (hasFirstFrame) {
    const image = await resolveImageInput(imageInputs!.firstFrame!);
    input = [
      { type: "text", text: `<FIRST_FRAME> ${prompt}` },
      { type: "image", data: image.data, mime_type: image.mimeType },
    ];
  } else {
    input = prompt;
  }

  const requestBody: Record<string, unknown> = {
    model: modelId,
    input,
    // delivery "uri" siempre: el límite de 4MB de base64 alcanza para <2s de
    // video. El extractor igual acepta data inline si la API la devuelve.
    response_format: {
      type: "video",
      aspect_ratio: config.aspectRatio,
      delivery: "uri",
    },
    generation_config: { video_config: { task } },
    // store=true habilita previous_interaction_id (fase 2).
    store: true,
    background: true,
  };
  if (config.previousInteractionId) {
    requestBody.previous_interaction_id = config.previousInteractionId;
  }

  console.log(`[Omni Video] Submit: model=${modelId} task=${task} aspect=${config.aspectRatio}`);

  onProgress?.({
    status: "processing",
    message: "Enviando solicitud a Gemini Omni...",
    progress: 10,
  });

  let interaction: OmniInteraction | undefined;
  let retryDelay = RETRY_CONFIG.initialDelayMs;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    const response = await fetch(`${OMNI_API_BASE}/interactions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      interaction = await response.json();
      break;
    }

    if (!isRetriableStatus(response.status) || attempt === RETRY_CONFIG.maxRetries) {
      const errorText = await response.text();
      console.error(`[Omni Video] Submit failed (${response.status}): ${errorText}`);
      if (response.status === 429) {
        throw new Error("Gemini Omni está saturado en este momento. Espera un momento e intenta de nuevo.");
      }
      throw new Error(`Gemini Omni submit failed (${response.status}): ${errorText}`);
    }

    console.warn(
      `[Omni Video] Submit failed (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}). ` +
      `Retrying in ${retryDelay / 1000}s... Status: ${response.status}`
    );
    onProgress?.({
      status: "processing",
      message: `Reintentando (${attempt + 1}/${RETRY_CONFIG.maxRetries + 1})...`,
      progress: 5,
    });
    await sleep(retryDelay);
    retryDelay = Math.min(retryDelay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs);
  }

  if (!interaction?.id) {
    throw new Error("Gemini Omni no devolvió un id de interaction");
  }

  console.log(`[Omni Video] Submitted. interaction=${interaction.id} status=${interaction.status ?? "?"}`);

  onProgress?.({
    status: "processing",
    message: "Video en cola de generación...",
    progress: 20,
  });

  // Si el create ya volvió terminal (modo síncrono), no hay que pollear.
  const finalInteraction = isTerminalStatus(interaction.status)
    ? interaction
    : await pollInteraction(interaction.id, apiKey, onProgress);

  return extractAndDownloadVideo(finalInteraction, apiKey, onProgress);
}

// ============================================
// POLLING
// ============================================

const COMPLETED_STATUSES = new Set(["completed", "succeeded", "done"]);
const FAILED_STATUSES = new Set(["failed", "cancelled", "canceled", "expired", "error"]);

function isTerminalStatus(status?: string): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return COMPLETED_STATUSES.has(s) || FAILED_STATUSES.has(s);
}

async function pollInteraction(
  interactionId: string,
  apiKey: string,
  onProgress?: (progress: VideoGenerationProgress) => void,
): Promise<OmniInteraction> {
  const startTime = Date.now();
  let pollDelay = POLLING_CONFIG.initialDelayMs;
  let progressPercent = 20;
  let pollCount = 0;

  while (true) {
    pollCount++;
    const elapsedMs = Date.now() - startTime;
    const elapsedMinutes = (elapsedMs / 60000).toFixed(1);

    if (elapsedMs > POLLING_CONFIG.maxDurationMs) {
      const timeoutMinutes = Math.round(POLLING_CONFIG.maxDurationMs / 60000);
      throw new Error(`La generación con Gemini Omni superó el tiempo máximo (${timeoutMinutes} minutos). Intenta de nuevo.`);
    }

    await sleep(pollDelay);
    pollDelay = Math.min(pollDelay * POLLING_CONFIG.backoffMultiplier, POLLING_CONFIG.maxDelayMs);

    progressPercent = Math.min(progressPercent + 2, 90);
    onProgress?.({
      status: "processing",
      message: `Generando video... (${elapsedMinutes} min)`,
      progress: progressPercent,
    });

    let interaction: OmniInteraction | undefined;
    try {
      const response = await fetch(`${OMNI_API_BASE}/interactions/${encodeURIComponent(interactionId)}`, {
        headers: { "x-goog-api-key": apiKey },
      });
      if (!response.ok) {
        console.error(`[Omni Video] Poll #${pollCount} HTTP ${response.status}`);
        continue;
      }
      interaction = await response.json();
    } catch (error) {
      console.error(`[Omni Video] Poll #${pollCount} network error:`, error);
      continue;
    }

    const status = interaction?.status ?? "unknown";
    console.log(`[Omni Video] Poll #${pollCount} (${elapsedMinutes} min) - status=${status}`);

    if (interaction && isTerminalStatus(status)) {
      return interaction;
    }

    // in_progress | queued | unknown → seguir polleando. El enum exacto del
    // preview no está documentado; los valores desconocidos solo se loguean.
  }
}

// ============================================
// EXTRACTION + DOWNLOAD
// ============================================

function findVideoPart(interaction: OmniInteraction): OmniContentPart | null {
  const candidates: OmniContentPart[] = [];
  for (const step of interaction.steps ?? []) {
    if (step.type && step.type !== "model_output") continue;
    for (const part of step.content ?? []) {
      if (part.type === "video") candidates.push(part);
    }
  }
  for (const part of interaction.outputs ?? []) {
    if (part.type === "video") candidates.push(part);
  }
  if (interaction.output_video?.uri || interaction.output_video?.data) {
    candidates.push({
      type: "video",
      uri: interaction.output_video.uri,
      data: interaction.output_video.data,
    });
  }
  // El último part de video es el resultado final.
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

function looksLikeSafetyBlock(interaction: OmniInteraction): boolean {
  const errorMsg = typeof interaction.error === "string"
    ? interaction.error
    : interaction.error?.message ?? "";
  const haystack = `${errorMsg} ${JSON.stringify(interaction.steps ?? []).slice(0, 2000)}`.toLowerCase();
  return /safety|blocked|prohibited|violat|rai/.test(haystack);
}

async function extractAndDownloadVideo(
  interaction: OmniInteraction,
  apiKey: string,
  onProgress?: (progress: VideoGenerationProgress) => void,
): Promise<GeneratedVideo> {
  const status = (interaction.status ?? "").toLowerCase();

  if (FAILED_STATUSES.has(status)) {
    const errorMsg = typeof interaction.error === "string"
      ? interaction.error
      : interaction.error?.message ?? "sin detalle";
    console.error(`[Omni Video] Interaction ${interaction.id} failed:`, errorMsg);
    if (looksLikeSafetyBlock(interaction)) {
      throw new Error("El video fue bloqueado por los filtros de seguridad de Google. Prueba ajustando tu prompt.");
    }
    throw new Error(`La generación con Gemini Omni falló: ${errorMsg}`);
  }

  const videoPart = findVideoPart(interaction);
  if (!videoPart) {
    console.error(`[Omni Video] No video part in interaction ${interaction.id}. Keys: ${Object.keys(interaction).join(", ")}`);
    if (looksLikeSafetyBlock(interaction)) {
      throw new Error("El video fue bloqueado por los filtros de seguridad de Google. Prueba ajustando tu prompt.");
    }
    throw new Error("Gemini Omni no devolvió un video en la respuesta. Intenta de nuevo.");
  }

  let videoData: Buffer;
  if (videoPart.data) {
    videoData = Buffer.from(videoPart.data, "base64");
  } else if (videoPart.uri) {
    onProgress?.({
      status: "processing",
      message: "Procesando archivo de video...",
      progress: 92,
    });
    videoData = await downloadFileUri(videoPart.uri, apiKey);
  } else {
    throw new Error("Gemini Omni devolvió un video sin datos ni URI.");
  }

  onProgress?.({
    status: "completed",
    message: "Video generado, descargando...",
    progress: 95,
  });

  // Costo desde los usage tokens (facturación exacta). Los tokens de video
  // facturados pueden exceder la duración real del mp4, así que NO se usan
  // para derivar la duración salvo como último recurso.
  if (interaction.usage) {
    console.log("[Omni Video] usage:", JSON.stringify(interaction.usage));
  }
  const usage = interaction.usage;
  const inputTokens = usage?.total_input_tokens ?? 0;
  const totalOutputTokens = usage?.total_output_tokens ?? 0;
  const videoTokens = (usage?.output_tokens_by_modality ?? [])
    .filter(m => m.modality === "video")
    .reduce((sum, m) => sum + (m.tokens ?? 0), 0);

  let actualCost: number | undefined;
  if (videoTokens > 0 || totalOutputTokens > 0) {
    const billedVideoTokens = videoTokens > 0 ? videoTokens : totalOutputTokens;
    const otherOutputTokens = Math.max(0, totalOutputTokens - billedVideoTokens);
    actualCost = Number((
      inputTokens * OMNI_INPUT_COST_PER_TOKEN +
      billedVideoTokens * OMNI_VIDEO_OUTPUT_COST_PER_TOKEN +
      otherOutputTokens * OMNI_TEXT_OUTPUT_COST_PER_TOKEN
    ).toFixed(6));
  }

  // Duración: mp4 real (mvhd) → derivada de tokens → estimación fija.
  let duration: number | null = probeMp4DurationSeconds(videoData);
  if (duration !== null) {
    duration = Math.max(1, Math.round(duration));
  } else if (videoTokens > 0) {
    duration = Math.max(1, Math.round(videoTokens / OMNI_VIDEO_TOKENS_PER_SECOND));
  } else {
    console.warn(`[Omni Video] Could not derive duration for interaction ${interaction.id}; defaulting to 8s estimate`);
    duration = 8;
  }

  onProgress?.({
    status: "completed",
    message: "Video generado exitosamente",
    progress: 100,
  });

  return {
    data: videoData,
    mimeType: videoPart.mime_type ?? videoPart.mimeType ?? "video/mp4",
    duration,
    hasAudio: true,  // Omni siempre genera audio integrado
    seed: 0,         // no soportado por la interactions API
    actualCost,
    providerRef: interaction.id,
  };
}

/**
 * Descarga un video referenciado por URI de la Files API. Espera a que el
 * archivo esté ACTIVE (con timeout corto) y luego baja los bytes.
 */
async function downloadFileUri(uri: string, apiKey: string): Promise<Buffer> {
  // uri con forma .../v1beta/files/{id} o .../files/{id}:download?alt=media
  const fileMatch = uri.match(/\/(files\/[^/:?]+)/);

  if (fileMatch) {
    const fileName = fileMatch[1];
    const startTime = Date.now();
    while (true) {
      let state = "";
      try {
        const response = await fetch(`${OMNI_API_BASE}/${fileName}`, {
          headers: { "x-goog-api-key": apiKey },
        });
        if (response.ok) {
          const info = await response.json();
          state = (info?.state?.name ?? info?.state ?? "").toString().toUpperCase();
        } else {
          console.error(`[Omni Video] File status HTTP ${response.status} for ${fileName}`);
        }
      } catch (error) {
        console.error(`[Omni Video] File status error for ${fileName}:`, error);
      }

      if (state === "ACTIVE" || state === "") break;
      if (state === "FAILED") {
        throw new Error("El archivo de video no quedó disponible (procesamiento fallido). Intenta de nuevo.");
      }
      if (Date.now() - startTime > FILE_ACTIVE_TIMEOUT_MS) {
        throw new Error("El archivo de video no quedó disponible a tiempo, intenta de nuevo.");
      }
      await sleep(FILE_ACTIVE_POLL_MS);
    }
  }

  // Mismo criterio que downloadVideo() de google-ai-video: para URIs de
  // generativelanguage.googleapis.com la key puede ir como query param, pero el
  // header también sirve; usamos ambos por robustez.
  const downloadUrl = uri.includes("alt=media")
    ? uri
    : `${uri}${uri.includes("?") ? "&" : ":download?"}alt=media`;

  const response = await fetch(downloadUrl, {
    headers: { "x-goog-api-key": apiKey },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`No se pudo descargar el video generado (${response.status}): ${detail}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
