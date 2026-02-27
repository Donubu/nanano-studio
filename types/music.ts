// =====================================
// MUSIC GENERATION TYPES (Lyria)
// =====================================

// =====================================
// SCALES & MODES
// =====================================

export const MUSIC_SCALES = [
  { id: "UNSPECIFIED", name: "Sin especificar", description: "Lyria decide la escala" },
  { id: "C_MAJOR_A_MINOR", name: "Do Mayor / La Menor", description: "Brillante, alegre / Nostálgico" },
  { id: "D_FLAT_MAJOR_B_FLAT_MINOR", name: "Re♭ Mayor / Si♭ Menor", description: "Soñador, contemplativo" },
  { id: "D_MAJOR_B_MINOR", name: "Re Mayor / Si Menor", description: "Triunfante, festivo" },
  { id: "E_FLAT_MAJOR_C_MINOR", name: "Mi♭ Mayor / Do Menor", description: "Heroico, dramático" },
  { id: "E_MAJOR_D_FLAT_MINOR", name: "Mi Mayor / Re♭ Menor", description: "Poderoso, enérgico" },
  { id: "F_MAJOR_D_MINOR", name: "Fa Mayor / Re Menor", description: "Pastoral, melancólico" },
  { id: "G_FLAT_MAJOR_E_FLAT_MINOR", name: "Sol♭ Mayor / Mi♭ Menor", description: "Misterioso, etéreo" },
  { id: "G_MAJOR_E_MINOR", name: "Sol Mayor / Mi Menor", description: "Simple, reflexivo" },
  { id: "A_FLAT_MAJOR_F_MINOR", name: "La♭ Mayor / Fa Menor", description: "Sereno, tenso" },
  { id: "A_MAJOR_G_FLAT_MINOR", name: "La Mayor / Sol♭ Menor", description: "Cálido, intenso" },
  { id: "B_FLAT_MAJOR_G_MINOR", name: "Si♭ Mayor / Sol Menor", description: "Noble, apasionado" },
  { id: "B_MAJOR_A_FLAT_MINOR", name: "Si Mayor / La♭ Menor", description: "Luminoso, sombrío" },
] as const;

export type MusicScale = typeof MUSIC_SCALES[number]["id"];

export const MUSIC_GENERATION_MODES = [
  { id: "QUALITY", name: "Calidad", description: "Mayor calidad, menos variación" },
  { id: "DIVERSITY", name: "Diverso", description: "Más variedad, resultados creativos" },
] as const;

export type MusicGenerationMode = typeof MUSIC_GENERATION_MODES[number]["id"];

// =====================================
// WEIGHTED PROMPTS
// =====================================

export interface WeightedPrompt {
  text: string;
  weight: number; // 0.0 - 1.0
}

// =====================================
// CONFIGURATION
// =====================================

export interface MusicGenerationSettings {
  prompts: WeightedPrompt[];
  bpm: number; // 60-200
  density: number; // 0.0-1.0
  brightness: number; // 0.0-1.0
  scale: MusicScale;
  guidance: number; // 1.0-6.0
  generationMode: MusicGenerationMode;
  duration: number; // seconds, 10-120
  muteBass: boolean;
  muteDrums: boolean;
  onlyBassAndDrums: boolean;
}

export const DEFAULT_MUSIC_SETTINGS: MusicGenerationSettings = {
  prompts: [{ text: "", weight: 1.0 }],
  bpm: 120,
  density: 0.5,
  brightness: 0.5,
  scale: "UNSPECIFIED",
  guidance: 3.5,
  generationMode: "QUALITY",
  duration: 30,
  muteBass: false,
  muteDrums: false,
  onlyBassAndDrums: false,
};

// =====================================
// INPUT / OUTPUT
// =====================================

export interface GeneratedMusic {
  data: Buffer;
  mimeType: string;
  duration: number; // seconds
  sampleRate: number;
}

// =====================================
// MESSAGE INTERFACE
// =====================================

export interface MusicMessage {
  music_url: string;
  music_mime_type: string;
  music_file_size: number;
  music_duration: number | null;
  music_config: MusicGenerationSettings | null;
}

// =====================================
// DATABASE ROWS
// =====================================

export interface MusicConversationSettings {
  music_prompts: WeightedPrompt[] | null;
  music_bpm: number;
  music_density: number;
  music_brightness: number;
  music_scale: MusicScale;
  music_guidance: number;
  music_generation_mode: MusicGenerationMode;
  music_duration: number;
  music_mute_bass: boolean;
  music_mute_drums: boolean;
  music_only_bass_and_drums: boolean;
}

export interface MusicMessageRow {
  music_url: string | null;
  music_mime_type: string | null;
  music_file_size: number | null;
  music_duration: number | null;
  music_config: string | null; // JSON string
}

// =====================================
// SSE EVENTS
// =====================================

export type MusicGenerationStatus = "connecting" | "generating" | "converting" | "uploading" | "completed" | "failed";

export interface MusicSSEUserMessage {
  type: "user_message";
  messageId: number;
}

export interface MusicSSEProgress {
  type: "progress";
  status: MusicGenerationStatus;
  message: string;
  percent?: number;
}

export interface MusicSSEPreview {
  type: "preview";
  tempUrl: string;
  tempKey: string;
  duration: number;
  fileSize: number;
  userMessageId: number;
}

export interface MusicSSESaved {
  type: "saved";
  messageId: number;
  musicUrl: string;
  estimatedCost: number;
}

export interface MusicSSEDiscarded {
  type: "discarded";
}

export interface MusicSSEError {
  type: "error";
  message: string;
  code?: string;
}

export type MusicSSEEvent =
  | MusicSSEUserMessage
  | MusicSSEProgress
  | MusicSSEPreview
  | MusicSSESaved
  | MusicSSEDiscarded
  | MusicSSEError;

// =====================================
// UTILITY FUNCTIONS
// =====================================

export function getScaleById(scaleId: string) {
  return MUSIC_SCALES.find(s => s.id === scaleId);
}

export function getModeById(modeId: string) {
  return MUSIC_GENERATION_MODES.find(m => m.id === modeId);
}

export function validateMusicSettings(settings: Partial<MusicGenerationSettings>): string[] {
  const errors: string[] = [];

  if (settings.prompts) {
    if (settings.prompts.length === 0) {
      errors.push("Se requiere al menos un prompt");
    }
    for (const p of settings.prompts) {
      if (!p.text || p.text.trim().length === 0) {
        errors.push("Todos los prompts deben tener texto");
        break;
      }
      if (p.weight < 0 || p.weight > 1) {
        errors.push("El peso del prompt debe estar entre 0 y 1");
        break;
      }
    }
  }

  if (settings.bpm !== undefined && (settings.bpm < 60 || settings.bpm > 200)) {
    errors.push("BPM debe estar entre 60 y 200");
  }

  if (settings.density !== undefined && (settings.density < 0 || settings.density > 1)) {
    errors.push("Densidad debe estar entre 0 y 1");
  }

  if (settings.brightness !== undefined && (settings.brightness < 0 || settings.brightness > 1)) {
    errors.push("Brillo debe estar entre 0 y 1");
  }

  if (settings.guidance !== undefined && (settings.guidance < 1 || settings.guidance > 6)) {
    errors.push("Guía debe estar entre 1 y 6");
  }

  if (settings.duration !== undefined && (settings.duration < 10 || settings.duration > 120)) {
    errors.push("Duración debe estar entre 10 y 120 segundos");
  }

  return errors;
}
