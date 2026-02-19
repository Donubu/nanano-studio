// =====================================
// AUDIO GENERATION TYPES
// =====================================

// =====================================
// TTS ENGINE
// =====================================

export type AudioTTSEngine = "gemini" | "chirp";

// =====================================
// VOCES DISPONIBLES (30 voices from Gemini TTS)
// =====================================

export const AUDIO_VOICES = [
  // Bright/Upbeat
  { id: "Zephyr", name: "Zephyr", gender: "neutral", style: "bright", description: "Neutral, brillante", engine: "gemini" as const },
  { id: "Puck", name: "Puck", gender: "male", style: "upbeat", description: "Masculino, animado", engine: "gemini" as const },
  { id: "Leda", name: "Leda", gender: "female", style: "bright", description: "Femenino, brillante", engine: "gemini" as const },
  { id: "Autonoe", name: "Autonoe", gender: "female", style: "bright", description: "Femenino, luminoso", engine: "gemini" as const },
  { id: "Laomedeia", name: "Laomedeia", gender: "female", style: "upbeat", description: "Femenino, alegre", engine: "gemini" as const },

  // Informative/Clear
  { id: "Charon", name: "Charon", gender: "male", style: "informative", description: "Masculino, informativo", engine: "gemini" as const },
  { id: "Iapetus", name: "Iapetus", gender: "male", style: "clear", description: "Masculino, claro", engine: "gemini" as const },
  { id: "Erinome", name: "Erinome", gender: "female", style: "clear", description: "Femenino, claro", engine: "gemini" as const },
  { id: "Rasalgethi", name: "Rasalgethi", gender: "male", style: "informative", description: "Masculino, didáctico", engine: "gemini" as const },
  { id: "Sadaltager", name: "Sadaltager", gender: "male", style: "clear", description: "Masculino, preciso", engine: "gemini" as const },

  // Firm/Smooth
  { id: "Kore", name: "Kore", gender: "female", style: "firm", description: "Femenino, firme y suave", engine: "gemini" as const },
  { id: "Orus", name: "Orus", gender: "male", style: "firm", description: "Masculino, firme", engine: "gemini" as const },
  { id: "Algieba", name: "Algieba", gender: "male", style: "smooth", description: "Masculino, fluido", engine: "gemini" as const },
  { id: "Despina", name: "Despina", gender: "female", style: "smooth", description: "Femenino, suave", engine: "gemini" as const },
  { id: "Alnilam", name: "Alnilam", gender: "male", style: "firm", description: "Masculino, estable", engine: "gemini" as const },

  // Distinctive/Expressive
  { id: "Fenrir", name: "Fenrir", gender: "male", style: "excitable", description: "Masculino, entusiasta", engine: "gemini" as const },
  { id: "Aoede", name: "Aoede", gender: "female", style: "breezy", description: "Femenino, desenfadado", engine: "gemini" as const },
  { id: "Callirrhoe", name: "Callirrhoe", gender: "female", style: "easygoing", description: "Femenino, relajado", engine: "gemini" as const },
  { id: "Umbriel", name: "Umbriel", gender: "neutral", style: "easygoing", description: "Neutral, tranquilo", engine: "gemini" as const },

  // Unique Characteristics
  { id: "Enceladus", name: "Enceladus", gender: "neutral", style: "breathy", description: "Neutral, susurrante", engine: "gemini" as const },
  { id: "Algenib", name: "Algenib", gender: "male", style: "gravelly", description: "Masculino, áspero", engine: "gemini" as const },
  { id: "Achernar", name: "Achernar", gender: "female", style: "soft", description: "Femenino, suave", engine: "gemini" as const },
  { id: "Schedar", name: "Schedar", gender: "female", style: "even", description: "Femenino, equilibrado", engine: "gemini" as const },
  { id: "Gacrux", name: "Gacrux", gender: "male", style: "mature", description: "Masculino, maduro", engine: "gemini" as const },
  { id: "Pulcherrima", name: "Pulcherrima", gender: "female", style: "forward", description: "Femenino, directo", engine: "gemini" as const },
  { id: "Achird", name: "Achird", gender: "male", style: "friendly", description: "Masculino, amigable", engine: "gemini" as const },
  { id: "Zubenelgenubi", name: "Zubenelgenubi", gender: "male", style: "casual", description: "Masculino, casual", engine: "gemini" as const },
  { id: "Vindemiatrix", name: "Vindemiatrix", gender: "female", style: "gentle", description: "Femenino, gentil", engine: "gemini" as const },
  { id: "Sadachbia", name: "Sadachbia", gender: "female", style: "lively", description: "Femenino, vivaz", engine: "gemini" as const },
  { id: "Sulafat", name: "Sulafat", gender: "female", style: "warm", description: "Femenino, cálido", engine: "gemini" as const },
] as const;

// =====================================
// CHIRP 3 HD VOICES (same 30 voice names, Cloud TTS engine)
// =====================================

export const CHIRP_VOICES = [
  // Bright/Upbeat
  { id: "Zephyr", name: "Zephyr", gender: "neutral", style: "bright", description: "Neutral, brillante", engine: "chirp" as const },
  { id: "Puck", name: "Puck", gender: "male", style: "upbeat", description: "Masculino, animado", engine: "chirp" as const },
  { id: "Leda", name: "Leda", gender: "female", style: "bright", description: "Femenino, brillante", engine: "chirp" as const },
  { id: "Autonoe", name: "Autonoe", gender: "female", style: "bright", description: "Femenino, luminoso", engine: "chirp" as const },
  { id: "Laomedeia", name: "Laomedeia", gender: "female", style: "upbeat", description: "Femenino, alegre", engine: "chirp" as const },

  // Informative/Clear
  { id: "Charon", name: "Charon", gender: "male", style: "informative", description: "Masculino, informativo", engine: "chirp" as const },
  { id: "Iapetus", name: "Iapetus", gender: "male", style: "clear", description: "Masculino, claro", engine: "chirp" as const },
  { id: "Erinome", name: "Erinome", gender: "female", style: "clear", description: "Femenino, claro", engine: "chirp" as const },
  { id: "Rasalgethi", name: "Rasalgethi", gender: "male", style: "informative", description: "Masculino, didáctico", engine: "chirp" as const },
  { id: "Sadaltager", name: "Sadaltager", gender: "male", style: "clear", description: "Masculino, preciso", engine: "chirp" as const },

  // Firm/Smooth
  { id: "Kore", name: "Kore", gender: "female", style: "firm", description: "Femenino, firme y suave", engine: "chirp" as const },
  { id: "Orus", name: "Orus", gender: "male", style: "firm", description: "Masculino, firme", engine: "chirp" as const },
  { id: "Algieba", name: "Algieba", gender: "male", style: "smooth", description: "Masculino, fluido", engine: "chirp" as const },
  { id: "Despina", name: "Despina", gender: "female", style: "smooth", description: "Femenino, suave", engine: "chirp" as const },
  { id: "Alnilam", name: "Alnilam", gender: "male", style: "firm", description: "Masculino, estable", engine: "chirp" as const },

  // Distinctive/Expressive
  { id: "Fenrir", name: "Fenrir", gender: "male", style: "excitable", description: "Masculino, entusiasta", engine: "chirp" as const },
  { id: "Aoede", name: "Aoede", gender: "female", style: "breezy", description: "Femenino, desenfadado", engine: "chirp" as const },
  { id: "Callirrhoe", name: "Callirrhoe", gender: "female", style: "easygoing", description: "Femenino, relajado", engine: "chirp" as const },
  { id: "Umbriel", name: "Umbriel", gender: "neutral", style: "easygoing", description: "Neutral, tranquilo", engine: "chirp" as const },

  // Unique Characteristics
  { id: "Enceladus", name: "Enceladus", gender: "neutral", style: "breathy", description: "Neutral, susurrante", engine: "chirp" as const },
  { id: "Algenib", name: "Algenib", gender: "male", style: "gravelly", description: "Masculino, áspero", engine: "chirp" as const },
  { id: "Achernar", name: "Achernar", gender: "female", style: "soft", description: "Femenino, suave", engine: "chirp" as const },
  { id: "Schedar", name: "Schedar", gender: "female", style: "even", description: "Femenino, equilibrado", engine: "chirp" as const },
  { id: "Gacrux", name: "Gacrux", gender: "male", style: "mature", description: "Masculino, maduro", engine: "chirp" as const },
  { id: "Pulcherrima", name: "Pulcherrima", gender: "female", style: "forward", description: "Femenino, directo", engine: "chirp" as const },
  { id: "Achird", name: "Achird", gender: "male", style: "friendly", description: "Masculino, amigable", engine: "chirp" as const },
  { id: "Zubenelgenubi", name: "Zubenelgenubi", gender: "male", style: "casual", description: "Masculino, casual", engine: "chirp" as const },
  { id: "Vindemiatrix", name: "Vindemiatrix", gender: "female", style: "gentle", description: "Femenino, gentil", engine: "chirp" as const },
  { id: "Sadachbia", name: "Sadachbia", gender: "female", style: "lively", description: "Femenino, vivaz", engine: "chirp" as const },
  { id: "Sulafat", name: "Sulafat", gender: "female", style: "warm", description: "Femenino, cálido", engine: "chirp" as const },
] as const;

// =====================================
// CHIRP LOCALES (51 languages supported by Chirp 3 HD)
// =====================================

export const CHIRP_LOCALES = [
  { code: "af-ZA", name: "Afrikáans" },
  { code: "ar-XA", name: "Árabe" },
  { code: "bg-BG", name: "Búlgaro" },
  { code: "bn-IN", name: "Bengalí" },
  { code: "ca-ES", name: "Catalán" },
  { code: "cs-CZ", name: "Checo" },
  { code: "cy-GB", name: "Galés" },
  { code: "da-DK", name: "Danés" },
  { code: "de-DE", name: "Alemán" },
  { code: "el-GR", name: "Griego" },
  { code: "en-AU", name: "Inglés (Australia)" },
  { code: "en-GB", name: "Inglés (UK)" },
  { code: "en-IN", name: "Inglés (India)" },
  { code: "en-US", name: "Inglés (US)" },
  { code: "es-ES", name: "Español (España)" },
  { code: "es-US", name: "Español (US)" },
  { code: "eu-ES", name: "Euskera" },
  { code: "fi-FI", name: "Finés" },
  { code: "fil-PH", name: "Filipino" },
  { code: "fr-CA", name: "Francés (Canadá)" },
  { code: "fr-FR", name: "Francés (Francia)" },
  { code: "gl-ES", name: "Gallego" },
  { code: "gu-IN", name: "Guyaratí" },
  { code: "he-IL", name: "Hebreo" },
  { code: "hi-IN", name: "Hindi" },
  { code: "hu-HU", name: "Húngaro" },
  { code: "id-ID", name: "Indonesio" },
  { code: "is-IS", name: "Islandés" },
  { code: "it-IT", name: "Italiano" },
  { code: "ja-JP", name: "Japonés" },
  { code: "kn-IN", name: "Canarés" },
  { code: "ko-KR", name: "Coreano" },
  { code: "lt-LT", name: "Lituano" },
  { code: "lv-LV", name: "Letón" },
  { code: "ml-IN", name: "Malabar" },
  { code: "mr-IN", name: "Maratí" },
  { code: "ms-MY", name: "Malayo" },
  { code: "nb-NO", name: "Noruego" },
  { code: "nl-BE", name: "Neerlandés (Bélgica)" },
  { code: "nl-NL", name: "Neerlandés" },
  { code: "pl-PL", name: "Polaco" },
  { code: "pt-BR", name: "Portugués (Brasil)" },
  { code: "pt-PT", name: "Portugués (Portugal)" },
  { code: "ro-RO", name: "Rumano" },
  { code: "ru-RU", name: "Ruso" },
  { code: "sk-SK", name: "Eslovaco" },
  { code: "sr-RS", name: "Serbio" },
  { code: "sv-SE", name: "Sueco" },
  { code: "ta-IN", name: "Tamil" },
  { code: "te-IN", name: "Telugu" },
  { code: "th-TH", name: "Tailandés" },
  { code: "tr-TR", name: "Turco" },
  { code: "uk-UA", name: "Ucraniano" },
  { code: "vi-VN", name: "Vietnamita" },
  { code: "zh-CN", name: "Chino (simplificado)" },
  { code: "zh-TW", name: "Chino (tradicional)" },
] as const;

export type ChirpLocale = typeof CHIRP_LOCALES[number]["code"];

export type AudioVoiceId = typeof AUDIO_VOICES[number]["id"];
export type AudioVoiceGender = "male" | "female" | "neutral";
export type AudioOutputFormat = "wav" | "mp3";

// =====================================
// CONFIGURACIÓN
// =====================================

export interface AudioVoiceConfig {
  voiceId: AudioVoiceId;
  speakerName?: string; // Para identificación en multi-speaker
  engine?: AudioTTSEngine;
}

export interface AudioSpeaker {
  name: string;
  voiceId: AudioVoiceId;
}

export interface AudioSpeakerConfig {
  speakers: AudioSpeaker[];
}

export interface AudioGenerationSettings {
  voiceId: AudioVoiceId;
  stylePrompt: string;
  multiSpeaker: boolean;
  speakerConfig: AudioSpeakerConfig | null;
  outputFormat: AudioOutputFormat;
  ttsEngine: AudioTTSEngine;
  speakingRate?: number;
  locale?: string;
}

// =====================================
// INPUT / OUTPUT
// =====================================

export interface AudioGenerationRequest {
  text: string;
  settings: AudioGenerationSettings;
}

export interface GeneratedAudio {
  data: Buffer;
  mimeType: string;
  duration: number; // seconds
  sampleRate: number;
}

// =====================================
// MESSAGE INTERFACE
// =====================================

export interface AudioMessage {
  audio_url: string;
  audio_mime_type: string;
  audio_file_size: number;
  audio_duration: number | null;
  audio_voice_config: AudioVoiceConfig | AudioSpeakerConfig | null;
}

// =====================================
// DATABASE ROWS
// =====================================

export interface AudioConversationSettings {
  audio_voice_id: AudioVoiceId;
  audio_style_prompt: string | null;
  audio_multi_speaker: boolean;
  audio_speaker_config: AudioSpeakerConfig | null;
  audio_output_format: AudioOutputFormat;
  audio_tts_engine: AudioTTSEngine;
  audio_speaking_rate: number;
  audio_locale: string;
}

export interface AudioMessageRow {
  audio_url: string | null;
  audio_mime_type: string | null;
  audio_file_size: number | null;
  audio_duration: number | null;
  audio_voice_config: string | null; // JSON string
}

// =====================================
// SSE EVENTS
// =====================================

export type AudioGenerationStatus = "pending" | "processing" | "completed" | "failed";

export interface AudioSSEUserMessage {
  type: "user_message";
  messageId: number;
}

export interface AudioSSEProgress {
  type: "progress";
  status: AudioGenerationStatus;
  message: string;
}

export interface AudioSSEAudio {
  type: "audio";
  messageId: number;
  audioUrl: string;
  mimeType: string;
  fileSize: number;
  duration: number;
  voiceConfig: AudioVoiceConfig | AudioSpeakerConfig;
}

export interface AudioSSEComplete {
  type: "complete";
  messageId: number;
  estimatedCost: number;
}

export interface AudioSSEError {
  type: "error";
  message: string;
  code?: string;
}

export type AudioSSEEvent =
  | AudioSSEUserMessage
  | AudioSSEProgress
  | AudioSSEAudio
  | AudioSSEComplete
  | AudioSSEError;

// =====================================
// UTILITY FUNCTIONS
// =====================================

export function getVoiceById(voiceId: string, engine?: AudioTTSEngine): (typeof AUDIO_VOICES[number] | typeof CHIRP_VOICES[number]) | undefined {
  if (engine === "chirp") {
    return CHIRP_VOICES.find(v => v.id === voiceId);
  }
  return AUDIO_VOICES.find(v => v.id === voiceId);
}

export function getVoicesForEngine(engine: AudioTTSEngine) {
  return engine === "chirp" ? CHIRP_VOICES : AUDIO_VOICES;
}
