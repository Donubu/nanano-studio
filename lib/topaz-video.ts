/**
 * Topaz Video API Client
 *
 * Handles video enhancement through Topaz Labs Video API
 * Uses async workflow: create → accept → upload → complete-upload → poll status → download
 */

// ===========================================
// TYPES
// ===========================================

export type TopazVideoModel =
  // Upscaling & Enhancement
  | "prob-4"    // Proteus - General upscaling (recommended)
  | "ahq-12"    // Artemis HQ - Denoise + sharpen
  | "amq-13"    // Artemis MQ
  | "alq-13"    // Artemis LQ
  | "nyx-3"     // Nyx - Dedicated denoise
  | "nxf-1"     // Nyx Fast
  | "nxl-1"     // Nyx XL
  | "nxhf-1"    // Nyx High Fidelity
  | "rhea-1"    // Rhea - Advanced 4x upscale
  | "ghq-5"     // Gaia HQ - AI/CG content
  | "gcg-5"     // Gaia CG
  // Frame Interpolation
  | "apo-8"     // Apollo - Slowmo up to 8x
  | "apf-2"     // Apollo Fast
  | "chr-2"     // Chronos - Framerate conversion
  | "chf-3"     // Chronos Fast
  // Advanced
  | "ddv-3"     // Dione DV
  | "dtd-4"     // Dione TD
  | "thd-3"     // Theia Detail
  | "thf-4"     // Theia Fidelity
  | "Iris-3"    // Iris - Face enhancement
  | "thm-2"     // Themis - Motion deblur
  | "color-1";  // Colorize B&W

export type TopazVideoModelCategory =
  | "upscaling"
  | "denoise"
  | "frame_interpolation"
  | "advanced";

export interface TopazVideoModelConfig {
  code: TopazVideoModel;
  name: string;
  description: string;
  category: TopazVideoModelCategory;
  supportsUpscale: boolean;
  supportsSlowmo: boolean;
  maxScaleFactor: number;
  maxSlowmoFactor: number;
  creditsPerMinute: number;
  recommended?: boolean;
}

export interface TopazVideoParameters {
  // Output format
  outputFormat?: "mp4" | "mov";

  // Upscaling (for upscaling models)
  scaleFactor?: 1 | 2 | 4;

  // Frame interpolation (for Apollo/Chronos)
  slowmoFactor?: 2 | 4 | 8;
  targetFps?: number;

  // Enhancement (varies by model)
  denoiseStrength?: number;  // 0-100
  sharpenStrength?: number;  // 0-100
}

export interface TopazVideoEditStatus {
  status: "pending" | "accepted" | "uploading" | "processing" | "completed" | "failed" | "cancelled";
  progress?: number;
  message?: string;
  downloadUrl?: string;
  creditsUsed?: number;
  outputDuration?: number;
  outputWidth?: number;
  outputHeight?: number;
}

// ===========================================
// MODEL CONFIGURATIONS
// ===========================================

export const TOPAZ_VIDEO_MODELS: Record<TopazVideoModel, TopazVideoModelConfig> = {
  // Upscaling & Enhancement
  "prob-4": {
    code: "prob-4",
    name: "Proteus",
    description: "Best for most videos - general upscaling and enhancement",
    category: "upscaling",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 4,
    maxSlowmoFactor: 1,
    creditsPerMinute: 50,
    recommended: true,
  },
  "ahq-12": {
    code: "ahq-12",
    name: "Artemis HQ",
    description: "High quality denoising with sharpening",
    category: "denoise",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 4,
    maxSlowmoFactor: 1,
    creditsPerMinute: 60,
  },
  "amq-13": {
    code: "amq-13",
    name: "Artemis MQ",
    description: "Medium quality denoising - faster processing",
    category: "denoise",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 4,
    maxSlowmoFactor: 1,
    creditsPerMinute: 45,
  },
  "alq-13": {
    code: "alq-13",
    name: "Artemis LQ",
    description: "Low quality denoising - fastest processing",
    category: "denoise",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 4,
    maxSlowmoFactor: 1,
    creditsPerMinute: 35,
  },
  "nyx-3": {
    code: "nyx-3",
    name: "Nyx",
    description: "Dedicated denoising for noisy footage",
    category: "denoise",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 2,
    maxSlowmoFactor: 1,
    creditsPerMinute: 50,
  },
  "nxf-1": {
    code: "nxf-1",
    name: "Nyx Fast",
    description: "Fast denoising for quick processing",
    category: "denoise",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 2,
    maxSlowmoFactor: 1,
    creditsPerMinute: 35,
  },
  "nxl-1": {
    code: "nxl-1",
    name: "Nyx XL",
    description: "Extended denoising for heavy noise",
    category: "denoise",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 2,
    maxSlowmoFactor: 1,
    creditsPerMinute: 65,
  },
  "nxhf-1": {
    code: "nxhf-1",
    name: "Nyx High Fidelity",
    description: "High fidelity denoising preserving details",
    category: "denoise",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 2,
    maxSlowmoFactor: 1,
    creditsPerMinute: 70,
  },
  "rhea-1": {
    code: "rhea-1",
    name: "Rhea",
    description: "Advanced 4x upscaling with detail recovery",
    category: "upscaling",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 4,
    maxSlowmoFactor: 1,
    creditsPerMinute: 80,
  },
  "ghq-5": {
    code: "ghq-5",
    name: "Gaia HQ",
    description: "Optimized for AI-generated and CG content",
    category: "upscaling",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 4,
    maxSlowmoFactor: 1,
    creditsPerMinute: 55,
    recommended: true,
  },
  "gcg-5": {
    code: "gcg-5",
    name: "Gaia CG",
    description: "Best for computer generated animations",
    category: "upscaling",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 4,
    maxSlowmoFactor: 1,
    creditsPerMinute: 55,
  },

  // Frame Interpolation
  "apo-8": {
    code: "apo-8",
    name: "Apollo",
    description: "Best frame interpolation - up to 8x slowmo",
    category: "frame_interpolation",
    supportsUpscale: false,
    supportsSlowmo: true,
    maxScaleFactor: 1,
    maxSlowmoFactor: 8,
    creditsPerMinute: 75,
    recommended: true,
  },
  "apf-2": {
    code: "apf-2",
    name: "Apollo Fast",
    description: "Fast frame interpolation for quick slowmo",
    category: "frame_interpolation",
    supportsUpscale: false,
    supportsSlowmo: true,
    maxScaleFactor: 1,
    maxSlowmoFactor: 4,
    creditsPerMinute: 50,
  },
  "chr-2": {
    code: "chr-2",
    name: "Chronos",
    description: "General framerate conversion (24→60fps)",
    category: "frame_interpolation",
    supportsUpscale: false,
    supportsSlowmo: true,
    maxScaleFactor: 1,
    maxSlowmoFactor: 4,
    creditsPerMinute: 60,
  },
  "chf-3": {
    code: "chf-3",
    name: "Chronos Fast",
    description: "Fast framerate conversion",
    category: "frame_interpolation",
    supportsUpscale: false,
    supportsSlowmo: true,
    maxScaleFactor: 1,
    maxSlowmoFactor: 2,
    creditsPerMinute: 40,
  },

  // Advanced
  "ddv-3": {
    code: "ddv-3",
    name: "Dione DV",
    description: "Best for DV/MiniDV footage",
    category: "advanced",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 4,
    maxSlowmoFactor: 1,
    creditsPerMinute: 65,
  },
  "dtd-4": {
    code: "dtd-4",
    name: "Dione TD",
    description: "Best for interlaced TV content",
    category: "advanced",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 4,
    maxSlowmoFactor: 1,
    creditsPerMinute: 65,
  },
  "thd-3": {
    code: "thd-3",
    name: "Theia Detail",
    description: "High fidelity detail enhancement",
    category: "advanced",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 2,
    maxSlowmoFactor: 1,
    creditsPerMinute: 70,
  },
  "thf-4": {
    code: "thf-4",
    name: "Theia Fidelity",
    description: "Maximum fidelity preservation",
    category: "advanced",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 2,
    maxSlowmoFactor: 1,
    creditsPerMinute: 70,
  },
  "Iris-3": {
    code: "Iris-3",
    name: "Iris",
    description: "Specialized face enhancement",
    category: "advanced",
    supportsUpscale: true,
    supportsSlowmo: false,
    maxScaleFactor: 2,
    maxSlowmoFactor: 1,
    creditsPerMinute: 80,
  },
  "thm-2": {
    code: "thm-2",
    name: "Themis",
    description: "Motion deblur for shaky footage",
    category: "advanced",
    supportsUpscale: false,
    supportsSlowmo: false,
    maxScaleFactor: 1,
    maxSlowmoFactor: 1,
    creditsPerMinute: 75,
  },
  "color-1": {
    code: "color-1",
    name: "Colorize",
    description: "Add color to black & white footage",
    category: "advanced",
    supportsUpscale: false,
    supportsSlowmo: false,
    maxScaleFactor: 1,
    maxSlowmoFactor: 1,
    creditsPerMinute: 60,
  },
};

// Group models by category for UI
export const TOPAZ_VIDEO_MODEL_GROUPS = {
  upscaling: {
    label: "Upscaling & Enhancement",
    models: ["prob-4", "rhea-1", "ghq-5", "gcg-5"] as TopazVideoModel[],
  },
  denoise: {
    label: "Denoising",
    models: ["ahq-12", "amq-13", "alq-13", "nyx-3", "nxf-1", "nxl-1", "nxhf-1"] as TopazVideoModel[],
  },
  frame_interpolation: {
    label: "Frame Interpolation",
    models: ["apo-8", "apf-2", "chr-2", "chf-3"] as TopazVideoModel[],
  },
  advanced: {
    label: "Advanced",
    models: ["ddv-3", "dtd-4", "thd-3", "thf-4", "Iris-3", "thm-2", "color-1"] as TopazVideoModel[],
  },
};

// ===========================================
// API CLIENT
// ===========================================

const TOPAZ_VIDEO_API_BASE = "https://api.topazlabs.com/video";

interface TopazApiConfig {
  apiKey: string;
}

interface VideoSourceMetadata {
  width: number;
  height: number;
  duration: number;      // in seconds
  frameRate: number;     // fps
  fileSize: number;      // in bytes
  container: "mp4" | "mov" | "avi" | "mkv" | "webm";
}

/**
 * Create a video enhancement request
 * This is free and does not consume credits - just returns estimates
 */
export async function createVideoEnhancement(
  config: TopazApiConfig,
  request: {
    model: TopazVideoModel;
    parameters: TopazVideoParameters;
    sourceMetadata: VideoSourceMetadata;
  }
): Promise<{
  requestId: string;
  estimatedCredits: number;
  estimatedTime: number;
}> {
  const modelConfig = TOPAZ_VIDEO_MODELS[request.model];

  // Build filters array based on model type
  // The filter uses specific parameter names from the Topaz API
  const filter: Record<string, unknown> = {
    model: request.model,
  };

  // Add slowmo for frame interpolation models
  if (modelConfig.supportsSlowmo && request.parameters.slowmoFactor && request.parameters.slowmoFactor > 1) {
    filter.slowmo = request.parameters.slowmoFactor;
  }

  // Add enhancement parameters using API field names
  // noise: -1 to 1 (negative = denoise, positive = add noise)
  if (request.parameters.denoiseStrength !== undefined && request.parameters.denoiseStrength > 0) {
    filter.noise = -(request.parameters.denoiseStrength / 100); // Convert 0-100 to 0 to -1
  }
  // details: -1 to 1 (positive = sharpen/add details)
  if (request.parameters.sharpenStrength !== undefined && request.parameters.sharpenStrength > 0) {
    filter.details = request.parameters.sharpenStrength / 100; // Convert 0-100 to 0-1
  }

  // Calculate frame count
  const frameCount = Math.round(request.sourceMetadata.duration * request.sourceMetadata.frameRate);

  // Build output settings
  const outputWidth = modelConfig.supportsUpscale && request.parameters.scaleFactor
    ? request.sourceMetadata.width * (request.parameters.scaleFactor || 1)
    : request.sourceMetadata.width;
  const outputHeight = modelConfig.supportsUpscale && request.parameters.scaleFactor
    ? request.sourceMetadata.height * (request.parameters.scaleFactor || 1)
    : request.sourceMetadata.height;

  const requestBody = {
    source: {
      resolution: {
        width: request.sourceMetadata.width,
        height: request.sourceMetadata.height,
      },
      container: request.sourceMetadata.container,
      size: request.sourceMetadata.fileSize || 10000000, // Default 10MB if unknown
      duration: request.sourceMetadata.duration,
      frameRate: request.sourceMetadata.frameRate,
      frameCount: frameCount,
    },
    output: {
      resolution: {
        width: outputWidth,
        height: outputHeight,
      },
      audioCodec: "AAC",
      audioTransfer: "Copy",
      frameRate: request.sourceMetadata.frameRate,
      dynamicCompressionLevel: "High",
      container: request.parameters.outputFormat || "mp4",
    },
    filters: [filter],
  };

  console.log("Topaz Video API request:", JSON.stringify(requestBody, null, 2));

  const response = await fetch(`${TOPAZ_VIDEO_API_BASE}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-API-Key": config.apiKey,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Topaz API error response:", errorText);
    let errorMessage = `Topaz API error: ${response.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message || errorJson.error || errorJson.detail || errorMessage;
    } catch {
      if (errorText) errorMessage = errorText;
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  return {
    requestId: data.requestId || data.request_id,
    estimatedCredits: data.cost?.credits || data.estimated_credits || 0,
    estimatedTime: data.time?.estimate || 0,
  };
}

/**
 * Accept request and get upload URL
 */
export async function acceptVideoRequest(
  config: TopazApiConfig,
  requestId: string
): Promise<{
  uploadUrl: string;
  uploadId: string;
  expiresAt: string;
}> {
  const response = await fetch(`${TOPAZ_VIDEO_API_BASE}/${requestId}/accept`, {
    method: "PATCH",
    headers: {
      "X-API-Key": config.apiKey,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Topaz API error: ${response.status}`);
  }

  const data = await response.json();
  console.log("Topaz accept response:", JSON.stringify(data, null, 2));

  // The API returns upload URLs in "urls" array for multi-part upload
  let uploadUrl = "";
  if (data.urls && Array.isArray(data.urls) && data.urls.length > 0) {
    uploadUrl = data.urls[0]; // Use first URL for single-part upload
  }

  return {
    uploadUrl,
    uploadId: data.uploadId || "",
    expiresAt: data.expires_at || data.expiresAt || "",
  };
}

/**
 * Signal that upload is complete and start processing
 * Requires the eTag from the S3 upload response
 */
export async function completeVideoUpload(
  config: TopazApiConfig,
  requestId: string,
  eTag: string
): Promise<void> {
  const body = {
    uploadResults: [
      {
        partNum: 1,
        eTag: eTag.replace(/"/g, ""), // Remove quotes if present
      },
    ],
  };

  console.log("Topaz complete-upload request:", JSON.stringify(body, null, 2));

  const response = await fetch(`${TOPAZ_VIDEO_API_BASE}/${requestId}/complete-upload`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Topaz complete-upload error:", errorText);
    let errorMessage = `Topaz API error: ${response.status}`;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message || errorJson.error || errorJson.detail || errorMessage;
    } catch {
      if (errorText) errorMessage = errorText;
    }
    throw new Error(errorMessage);
  }
}

/**
 * Get current status of video processing
 */
export async function getVideoRequestStatus(
  config: TopazApiConfig,
  requestId: string
): Promise<TopazVideoEditStatus> {
  const response = await fetch(`${TOPAZ_VIDEO_API_BASE}/${requestId}/status`, {
    method: "GET",
    headers: {
      "X-API-Key": config.apiKey,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Topaz API error: ${response.status}`);
  }

  const data = await response.json();
  console.log("Topaz status response:", JSON.stringify(data, null, 2));

  // Map Topaz status to our status enum
  // Check multiple indicators for completion
  let status: TopazVideoEditStatus["status"] = "processing";

  // Get download URL from various possible fields
  const downloadUrl = data.download?.url || data.download_url || data.downloadUrl ||
    data.output?.url || data.outputs?.[0]?.url || data.result?.url || "";

  const progressNum = Number(data.progress) || 0;
  const messageLC = (data.message || "").toLowerCase();

  console.log("Status check - progress:", progressNum, "message:", messageLC, "downloadUrl:", downloadUrl);

  const isComplete =
    data.status === "completed" ||
    data.status === "done" ||
    data.status === "complete" ||
    (progressNum >= 100 && messageLC.includes("complete")) ||
    (progressNum >= 100 && downloadUrl) ||
    Boolean(downloadUrl); // If we have download URL, it's complete

  console.log("isComplete:", isComplete);

  if (isComplete) {
    status = "completed";
  } else if (data.status === "failed" || data.status === "error") {
    status = "failed";
  } else if (data.status === "cancelled") {
    status = "cancelled";
  }

  return {
    status,
    progress: data.progress,
    message: data.message,
    downloadUrl,
    creditsUsed: data.credits_used || data.creditsUsed || data.cost?.credits,
    outputDuration: data.output_duration || data.output?.duration,
    outputWidth: data.output_width || data.output?.resolution?.width,
    outputHeight: data.output_height || data.output?.resolution?.height,
  };
}

/**
 * Cancel a pending or processing request
 */
export async function cancelVideoRequest(
  config: TopazApiConfig,
  requestId: string
): Promise<void> {
  const response = await fetch(`${TOPAZ_VIDEO_API_BASE}/${requestId}/cancel`, {
    method: "PATCH",
    headers: {
      "X-API-Key": config.apiKey,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Topaz API error: ${response.status}`);
  }
}

// ===========================================
// CREDIT CALCULATION
// ===========================================

/**
 * Calculate estimated credits for video enhancement
 */
export function calculateTopazVideoCredits(
  durationSeconds: number,
  model: TopazVideoModel,
  parameters: TopazVideoParameters
): {
  credits: number;
  outputDuration: number;
  breakdown: {
    baseCredits: number;
    slowmoMultiplier: number;
    scaleMultiplier: number;
  };
} {
  const modelConfig = TOPAZ_VIDEO_MODELS[model];
  const durationMinutes = Math.ceil(durationSeconds / 60);

  // Base credits from model
  let baseCredits = durationMinutes * modelConfig.creditsPerMinute;

  // Calculate output duration (affected by slowmo)
  let outputDuration = durationSeconds;
  let slowmoMultiplier = 1;
  if (parameters.slowmoFactor && parameters.slowmoFactor > 1) {
    outputDuration = durationSeconds * parameters.slowmoFactor;
    // Slowmo increases cost proportionally
    slowmoMultiplier = 1 + (parameters.slowmoFactor - 1) * 0.5;
  }

  // Scale factor affects cost
  let scaleMultiplier = 1;
  if (parameters.scaleFactor && parameters.scaleFactor > 1) {
    scaleMultiplier = parameters.scaleFactor === 2 ? 1.25 : 1.75; // 4x costs more
  }

  const totalCredits = Math.ceil(baseCredits * slowmoMultiplier * scaleMultiplier);

  return {
    credits: totalCredits,
    outputDuration,
    breakdown: {
      baseCredits,
      slowmoMultiplier,
      scaleMultiplier,
    },
  };
}

/**
 * Get human-readable model name
 */
export function getTopazVideoModelName(model: TopazVideoModel): string {
  return TOPAZ_VIDEO_MODELS[model]?.name || model;
}

/**
 * Check if model supports upscaling
 */
export function modelSupportsUpscale(model: TopazVideoModel): boolean {
  return TOPAZ_VIDEO_MODELS[model]?.supportsUpscale || false;
}

/**
 * Check if model supports slowmo
 */
export function modelSupportsSlowmo(model: TopazVideoModel): boolean {
  return TOPAZ_VIDEO_MODELS[model]?.supportsSlowmo || false;
}
