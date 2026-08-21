/**
 * OpenRouter video (Seedance) — per-model capabilities, canonical sizes and
 * token pricing. Pure constants: safe to import from client components
 * (canvas node panel, full mode) and from the server lib alike.
 */

export type OpenRouterAspectRatio = "1:1" | "3:4" | "9:16" | "4:3" | "16:9" | "21:9" | "9:21";
export type OpenRouterResolution = "480p" | "720p" | "1080p";

//
// Source of truth: GET https://openrouter.ai/api/v1/videos/models
// (supported_durations / supported_resolutions / supported_aspect_ratios /
// supported_sizes / pricing_skus.video_tokens). Last synced 2026-08-21.
//
// `dims` is the canonical WIDTHxHEIGHT OpenRouter lists for each
// (resolution, aspect ratio) pair. We send it explicitly as `size` so the
// provider renders exactly those pixels and our token-based cost estimate
// matches the billed amount.

type DimensionTable = Partial<Record<OpenRouterResolution, Partial<Record<OpenRouterAspectRatio, [number, number]>>>>;

export interface OpenRouterModelCaps {
  pricePerToken: number;            // USD per video token (w*h*d*24/1024)
  minDuration: number;
  maxDuration: number;
  resolutions: OpenRouterResolution[];
  aspectRatios: OpenRouterAspectRatio[];
  maxReferenceImages: number;
  dims: DimensionTable;
}

// Seedance 2.0 family (2.0 / 2.0-fast) — same size grid, different price/res.
const SEEDANCE_20_DIMS: DimensionTable = {
  "480p": {
    "1:1": [480, 480],
    "3:4": [480, 640],
    "9:16": [480, 854],
    "4:3": [640, 480],
    "16:9": [854, 480],
    "21:9": [1120, 480],
    "9:21": [480, 1120],
  },
  "720p": {
    "1:1": [720, 720],
    "3:4": [720, 960],
    "9:16": [720, 1280],
    "4:3": [960, 720],
    "16:9": [1280, 720],
    "21:9": [1680, 720],
    "9:21": [720, 1680],
  },
  "1080p": {
    "1:1": [1080, 1080],
    "3:4": [1080, 1440],
    "9:16": [1080, 1920],
    "4:3": [1440, 1080],
    "16:9": [1920, 1080],
    "21:9": [2520, 1080],
    "9:21": [1080, 2520],
  },
};

// Seedance 2.5 — different grid: 1:1, 3:4/4:3 and 21:9 changed pixel counts,
// 9:21 and 1080p are gone, duration goes up to 30s.
const SEEDANCE_25_DIMS: DimensionTable = {
  "480p": {
    "16:9": [854, 480],
    "4:3": [752, 560],
    "1:1": [640, 640],
    "3:4": [560, 752],
    "9:16": [480, 854],
    "21:9": [992, 432],
  },
  "720p": {
    "16:9": [1280, 720],
    "4:3": [1112, 834],
    "1:1": [960, 960],
    "3:4": [834, 1112],
    "9:16": [720, 1280],
    "21:9": [1470, 630],
  },
};

const SEEDANCE_20_ASPECTS: OpenRouterAspectRatio[] = ["1:1", "3:4", "9:16", "4:3", "16:9", "21:9", "9:21"];
const SEEDANCE_25_ASPECTS: OpenRouterAspectRatio[] = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];

// Seedance 2.0 documents 9 reference images; OpenRouter does not publish a
// cap for 2.5 (ByteDance's own UI allows 30). Stay at 9 until a real call
// proves more are accepted.
const DEFAULT_MAX_REFERENCE_IMAGES = 9;

export const OPENROUTER_MODEL_CAPS: Record<string, OpenRouterModelCaps> = {
  "bytedance/seedance-2.5": {
    pricePerToken: 0.0000107,
    minDuration: 4,
    maxDuration: 30,
    resolutions: ["480p", "720p"],
    aspectRatios: SEEDANCE_25_ASPECTS,
    maxReferenceImages: DEFAULT_MAX_REFERENCE_IMAGES,
    dims: SEEDANCE_25_DIMS,
  },
  "bytedance/seedance-2.0": {
    pricePerToken: 0.000007,
    minDuration: 4,
    maxDuration: 15,
    resolutions: ["480p", "720p", "1080p"],
    aspectRatios: SEEDANCE_20_ASPECTS,
    maxReferenceImages: DEFAULT_MAX_REFERENCE_IMAGES,
    dims: SEEDANCE_20_DIMS,
  },
  "bytedance/seedance-2.0-fast": {
    pricePerToken: 0.0000042,
    minDuration: 4,
    maxDuration: 15,
    resolutions: ["480p", "720p"],
    aspectRatios: SEEDANCE_20_ASPECTS,
    maxReferenceImages: DEFAULT_MAX_REFERENCE_IMAGES,
    dims: SEEDANCE_20_DIMS,
  },
};

// Unknown OpenRouter video model → assume the current flagship (2.5) shape.
export const DEFAULT_OPENROUTER_MODEL_ID = "bytedance/seedance-2.5";

export function getOpenRouterModelCaps(modelId: string): OpenRouterModelCaps {
  return OPENROUTER_MODEL_CAPS[modelId] ?? OPENROUTER_MODEL_CAPS[DEFAULT_OPENROUTER_MODEL_ID];
}

export function resolveOpenRouterDimensions(
  modelId: string,
  resolution: OpenRouterResolution,
  aspectRatio: OpenRouterAspectRatio,
): [number, number] {
  const caps = getOpenRouterModelCaps(modelId);
  const dims = caps.dims[resolution]?.[aspectRatio];
  if (dims) return dims;
  // Fallback: 16:9 at the requested resolution (or the model's largest) —
  // keeps the cost estimate conservative if a combo slips through validation.
  return caps.dims[resolution]?.["16:9"]
    ?? caps.dims[caps.resolutions[caps.resolutions.length - 1]]?.["16:9"]
    ?? [1280, 720];
}

export function computeSeedanceCost(
  modelId: string,
  width: number,
  height: number,
  durationSeconds: number,
): number {
  const rate = OPENROUTER_MODEL_CAPS[modelId]?.pricePerToken;
  if (!rate) return 0;
  const tokens = (width * height * durationSeconds * 24) / 1024;
  return Number((tokens * rate).toFixed(6));
}

/** Convenience for UI/route estimates: cost for a (model, resolution, aspect, duration). */
export function estimateOpenRouterVideoCost(
  modelId: string,
  resolution: OpenRouterResolution,
  aspectRatio: OpenRouterAspectRatio,
  durationSeconds: number,
): number {
  const [w, h] = resolveOpenRouterDimensions(modelId, resolution, aspectRatio);
  return computeSeedanceCost(modelId, w, h, durationSeconds);
}

