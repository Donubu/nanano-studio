// =====================================
// AUDIO GENERATION TYPES
// =====================================

// =====================================
// VOCES DISPONIBLES (30 voices from Gemini TTS)
// =====================================

export const AUDIO_VOICES = [
  // Bright/Upbeat
  { id: "Zephyr", name: "Zephyr", gender: "neutral", style: "bright", description: "Neutral, brillante" },
  { id: "Puck", name: "Puck", gender: "male", style: "upbeat", description: "Masculino, animado" },
  { id: "Leda", name: "Leda", gender: "female", style: "bright", description: "Femenino, brillante" },
  { id: "Autonoe", name: "Autonoe", gender: "female", style: "bright", description: "Femenino, luminoso" },
  { id: "Laomedeia", name: "Laomedeia", gender: "female", style: "upbeat", description: "Femenino, alegre" },

  // Informative/Clear
  { id: "Charon", name: "Charon", gender: "male", style: "informative", description: "Masculino, informativo" },
  { id: "Iapetus", name: "Iapetus", gender: "male", style: "clear", description: "Masculino, claro" },
  { id: "Erinome", name: "Erinome", gender: "female", style: "clear", description: "Femenino, claro" },
  { id: "Rasalgethi", name: "Rasalgethi", gender: "male", style: "informative", description: "Masculino, didáctico" },
  { id: "Sadaltager", name: "Sadaltager", gender: "male", style: "clear", description: "Masculino, preciso" },

  // Firm/Smooth
  { id: "Kore", name: "Kore", gender: "female", style: "firm", description: "Femenino, firme y suave" },
  { id: "Orus", name: "Orus", gender: "male", style: "firm", description: "Masculino, firme" },
  { id: "Algieba", name: "Algieba", gender: "male", style: "smooth", description: "Masculino, fluido" },
  { id: "Despina", name: "Despina", gender: "female", style: "smooth", description: "Femenino, suave" },
  { id: "Alnilam", name: "Alnilam", gender: "male", style: "firm", description: "Masculino, estable" },

  // Distinctive/Expressive
  { id: "Fenrir", name: "Fenrir", gender: "male", style: "excitable", description: "Masculino, entusiasta" },
  { id: "Aoede", name: "Aoede", gender: "female", style: "breezy", description: "Femenino, desenfadado" },
  { id: "Callirrhoe", name: "Callirrhoe", gender: "female", style: "easygoing", description: "Femenino, relajado" },
  { id: "Umbriel", name: "Umbriel", gender: "neutral", style: "easygoing", description: "Neutral, tranquilo" },

  // Unique Characteristics
  { id: "Enceladus", name: "Enceladus", gender: "neutral", style: "breathy", description: "Neutral, susurrante" },
  { id: "Algenib", name: "Algenib", gender: "male", style: "gravelly", description: "Masculino, áspero" },
  { id: "Achernar", name: "Achernar", gender: "female", style: "soft", description: "Femenino, suave" },
  { id: "Schedar", name: "Schedar", gender: "female", style: "even", description: "Femenino, equilibrado" },
  { id: "Gacrux", name: "Gacrux", gender: "male", style: "mature", description: "Masculino, maduro" },
  { id: "Pulcherrima", name: "Pulcherrima", gender: "female", style: "forward", description: "Femenino, directo" },
  { id: "Achird", name: "Achird", gender: "male", style: "friendly", description: "Masculino, amigable" },
  { id: "Zubenelgenubi", name: "Zubenelgenubi", gender: "male", style: "casual", description: "Masculino, casual" },
  { id: "Vindemiatrix", name: "Vindemiatrix", gender: "female", style: "gentle", description: "Femenino, gentil" },
  { id: "Sadachbia", name: "Sadachbia", gender: "female", style: "lively", description: "Femenino, vivaz" },
  { id: "Sulafat", name: "Sulafat", gender: "female", style: "warm", description: "Femenino, cálido" },
] as const;

export type AudioVoiceId = typeof AUDIO_VOICES[number]["id"];
export type AudioVoiceGender = "male" | "female" | "neutral";
export type AudioOutputFormat = "wav" | "mp3";

// =====================================
// CONFIGURACIÓN
// =====================================

export interface AudioVoiceConfig {
  voiceId: AudioVoiceId;
  speakerName?: string; // Para identificación en multi-speaker
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

export function getVoiceById(voiceId: string): typeof AUDIO_VOICES[number] | undefined {
  return AUDIO_VOICES.find(v => v.id === voiceId);
}
