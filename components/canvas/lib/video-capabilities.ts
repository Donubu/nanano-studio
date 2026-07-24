/**
 * Per-model capability lookup for video generation.
 *
 * Each backend exposes different durations, aspect ratios and resolutions.
 * The video node UI reads from here instead of hardcoding option arrays,
 * so adding a new model means adding one entry here (or extending the
 * matcher) and nothing else in the UI.
 *
 * Source of truth:
 *  - VEO (Gemini/Vertex):   lib/google-ai-video.ts (VideoGenerationConfig)
 *  - xAI Grok Imagine:      lib/xai-video.ts (validateXaiVideoConfig)
 *  - Kling v2.6 / v3 Omni:  lib/kling-video.ts
 *  - OpenRouter Seedance:   lib/openrouter-video.ts (validateOpenRouterVideoConfig)
 *  - Gemini Omni:           lib/omni-video.ts (interactions API)
 */

import type { CanvasModel } from "../canvas-workspace";

export interface VideoCapabilities {
  durations: number[];
  aspectRatios: string[];
  resolutions: string[];
  supportsAudio: boolean;
  supportsSeed: boolean;
  // Default values to pick when the current node setting is invalid for the
  // selected model (after a model switch).
  defaultDuration: number;
  defaultAspectRatio: string;
  defaultResolution: string;
  // Flags for providers whose API simply lacks a control (vs offering a single
  // option). Omitted = current behavior (control visible). durations/resolutions
  // keep a canonical single value for storage/reconciliation even when hidden.
  hasDurationControl?: boolean;      // false ⇒ hide the duration selector
  hasResolutionControl?: boolean;    // false ⇒ hide the resolution selector
  supportsNegativePrompt?: boolean;  // false ⇒ hide the negative prompt input
  audioAlwaysOn?: boolean;           // true ⇒ "audio integrado" badge instead of checkbox
  hints?: string[];                  // user-visible notes about model constraints
}

const VEO_CAPS: VideoCapabilities = {
  durations: [4, 6, 8],
  aspectRatios: ["16:9", "9:16"],
  resolutions: ["720p", "1080p", "4K"],
  supportsAudio: true,
  supportsSeed: true,
  defaultDuration: 8,
  defaultAspectRatio: "16:9",
  defaultResolution: "720p",
};

const XAI_CAPS: VideoCapabilities = {
  durations: [4, 6, 8, 10, 12, 15],
  aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
  resolutions: ["480p", "720p"],
  supportsAudio: false,
  supportsSeed: false,
  defaultDuration: 8,
  defaultAspectRatio: "16:9",
  defaultResolution: "720p",
};

const KLING_V3_CAPS: VideoCapabilities = {
  durations: [5, 10],
  aspectRatios: ["16:9", "9:16", "1:1"],
  resolutions: ["720p", "1080p"],
  supportsAudio: true,
  supportsSeed: false,
  defaultDuration: 5,
  defaultAspectRatio: "16:9",
  defaultResolution: "720p",
};

const KLING_V26_CAPS: VideoCapabilities = {
  durations: [5, 10],
  aspectRatios: ["16:9", "9:16", "1:1"],
  resolutions: ["720p", "1080p"],
  supportsAudio: true,
  supportsSeed: false,
  defaultDuration: 5,
  defaultAspectRatio: "16:9",
  defaultResolution: "720p",
};

const SEEDANCE_CAPS: VideoCapabilities = {
  durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  aspectRatios: ["1:1", "3:4", "9:16", "4:3", "16:9", "21:9", "9:21"],
  resolutions: ["480p", "720p", "1080p"],
  supportsAudio: true,
  supportsSeed: true,
  defaultDuration: 5,
  defaultAspectRatio: "16:9",
  defaultResolution: "720p",
};

const SEEDANCE_FAST_CAPS: VideoCapabilities = {
  ...SEEDANCE_CAPS,
  resolutions: ["480p", "720p"], // fast does not support 1080p
};

// Gemini Omni (interactions API): sin control de duración ni resolución (720p
// fijo, la duración se pide en el prompt), audio siempre integrado, sin
// negative prompt ni seed. durations/resolutions guardan el valor canónico
// para reconciliación — no se muestran.
const OMNI_CAPS: VideoCapabilities = {
  durations: [8],
  aspectRatios: ["16:9", "9:16"],
  resolutions: ["720p"],
  supportsAudio: false,
  supportsSeed: false,
  defaultDuration: 8,
  defaultAspectRatio: "16:9",
  defaultResolution: "720p",
  hasDurationControl: false,
  hasResolutionControl: false,
  supportsNegativePrompt: false,
  audioAlwaysOn: true,
  hints: [
    "La duración la decide el modelo: pídela en el prompt (p. ej. \"un clip de 10 segundos\").",
    "Salida fija en 720p a 24 fps, con audio integrado siempre.",
    "No soporta negative prompt ni seed.",
  ],
};

// Fallback when the model is unknown — most permissive subset so the UI
// stays usable. Backend validation is the final guard.
const FALLBACK_CAPS: VideoCapabilities = VEO_CAPS;

export function getVideoCapabilities(model: Pick<CanvasModel, "model_id" | "api_backend"> | null | undefined): VideoCapabilities {
  if (!model) return FALLBACK_CAPS;

  const backend = model.api_backend;
  const id = model.model_id;

  if (backend === "openrouter") {
    if (id === "bytedance/seedance-2.0-fast") return SEEDANCE_FAST_CAPS;
    if (id === "bytedance/seedance-2.0") return SEEDANCE_CAPS;
    return SEEDANCE_CAPS; // any future Seedance variant defaults to full caps
  }

  if (backend === "xai") return XAI_CAPS;

  // Gemini Omni: match by backend only — 'kling-v3-omni' also contains "omni".
  if (backend === "omni") return OMNI_CAPS;

  if (backend === "kling" || id === "kling-v2-6") return id === "kling-v2-6" ? KLING_V26_CAPS : KLING_V3_CAPS;

  // gemini / vertex / unset → VEO
  return VEO_CAPS;
}

/**
 * VEO on the Gemini API only allows 4s/6s clips at 720p without images. It
 * silently upgrades to 8s when the resolution is 1080p/4K, when reference
 * images are used, or when first+last frame interpolation is used. This mirrors
 * the guard in `lib/google-ai-video.ts` (`if (!isVertex && ...) config.durationSeconds = 8`)
 * so the UI can disable 4s/6s up front instead of letting the user pick a
 * duration the API will override behind their back.
 *
 * Returns the reason 8s is forced, or null when 4s/6s are allowed.
 * Keep this in sync with the backend guard.
 */
export function veoForcesEightSeconds(
  model: Pick<CanvasModel, "model_id" | "api_backend"> | null | undefined,
  opts: { resolution?: string; hasInterpolation?: boolean; hasReference?: boolean },
): "resolution" | "interpolation" | "reference" | null {
  if (!model) return null;
  // Vertex AI has no such restriction; only the Gemini API does. An unset
  // backend defaults to Gemini in this deployment.
  if (model.api_backend === "vertex") return null;
  if (model.api_backend && model.api_backend !== "gemini") return null; // xai / kling / openrouter
  if (opts.hasReference) return "reference";
  if (opts.hasInterpolation) return "interpolation";
  if (opts.resolution && opts.resolution !== "720p") return "resolution";
  return null;
}

/**
 * Given current settings and the capabilities of the active model, returns
 * an update patch with any field that needs to snap to a valid value.
 * Returns {} if everything is already valid.
 */
export function reconcileVideoSettings(
  current: { duration?: number; aspectRatio?: string; resolution?: string },
  caps: VideoCapabilities,
): { duration?: number; aspectRatio?: string; resolution?: string } {
  const patch: { duration?: number; aspectRatio?: string; resolution?: string } = {};
  if (typeof current.duration !== "number" || !caps.durations.includes(current.duration)) {
    patch.duration = caps.defaultDuration;
  }
  if (!current.aspectRatio || !caps.aspectRatios.includes(current.aspectRatio)) {
    patch.aspectRatio = caps.defaultAspectRatio;
  }
  if (!current.resolution || !caps.resolutions.includes(current.resolution)) {
    patch.resolution = caps.defaultResolution;
  }
  return patch;
}
