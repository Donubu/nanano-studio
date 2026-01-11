/**
 * Cost Calculator for AI Generation
 * Calculates estimated costs based on model pricing and usage
 */

// ============================================
// TOPAZ STUDIO - Models and Configuration
// ============================================

export type TopazModelType = "standard" | "generative";

export interface TopazModelConfig {
  shortCode: string;
  type: TopazModelType;
  async: boolean;
  maxMP: number;
  description: string;
  // Parameters supported by this model
  supportsCreativity: boolean;
  supportsTexture: boolean;
  supportsSharpen: boolean;
  supportsDenoise: boolean;
  supportsDetail: boolean;
  supportsMinorDeblur: boolean;
  supportsMinorDenoise: boolean;
  supportsFixCompression: boolean;
  supportsFaceEnhancement: boolean;
}

export const TOPAZ_MODELS: Record<string, TopazModelConfig> = {
  // Standard Models - fast, preserve fidelity
  "Standard V2": {
    shortCode: "std",
    type: "standard",
    async: false,
    maxMP: 512,
    description: "Default, mejor para imágenes de alta calidad",
    supportsCreativity: false,
    supportsTexture: false,
    supportsSharpen: true,
    supportsDenoise: true,
    supportsDetail: true,
    supportsMinorDeblur: true,
    supportsMinorDenoise: true,
    supportsFixCompression: true,
    supportsFaceEnhancement: true,
  },
  "High Fidelity V2": {
    shortCode: "hifi",
    type: "standard",
    async: false,
    maxMP: 512,
    description: "Preserva grano/ruido original para estética",
    supportsCreativity: false,
    supportsTexture: false,
    supportsSharpen: true,
    supportsDenoise: true,
    supportsDetail: true,
    supportsMinorDeblur: true,
    supportsMinorDenoise: true,
    supportsFixCompression: true,
    supportsFaceEnhancement: true,
  },
  "Low Resolution V2": {
    shortCode: "lowres",
    type: "standard",
    async: false,
    maxMP: 512,
    description: "Para imágenes comprimidas o de baja calidad",
    supportsCreativity: false,
    supportsTexture: false,
    supportsSharpen: true,
    supportsDenoise: true,
    supportsDetail: true,
    supportsMinorDeblur: true,
    supportsMinorDenoise: true,
    supportsFixCompression: true,
    supportsFaceEnhancement: true,
  },
  "CGI": {
    shortCode: "cgi",
    type: "standard",
    async: false,
    maxMP: 512,
    description: "Optimizado para arte digital y CGI",
    supportsCreativity: false,
    supportsTexture: false,
    supportsSharpen: true,
    supportsDenoise: true,
    supportsDetail: true,
    supportsMinorDeblur: true,
    supportsMinorDenoise: true,
    supportsFixCompression: true,
    supportsFaceEnhancement: true,
  },
  "Text Refine": {
    shortCode: "text",
    type: "standard",
    async: false,
    maxMP: 512,
    description: "Optimizado para imágenes con texto",
    supportsCreativity: false,
    supportsTexture: false,
    supportsSharpen: true,
    supportsDenoise: true,
    supportsDetail: true,
    supportsMinorDeblur: true,
    supportsMinorDenoise: true,
    supportsFixCompression: true,
    supportsFaceEnhancement: true,
  },
  // Generative Models - creative, async only
  "Wonder": {
    shortCode: "wonder",
    type: "generative",
    async: true,
    maxMP: 128,
    description: "Para fotos antiguas, caras pequeñas, ruido pesado",
    supportsCreativity: true,
    supportsTexture: true,
    supportsSharpen: false,
    supportsDenoise: false,
    supportsDetail: false,
    supportsMinorDeblur: false,
    supportsMinorDenoise: false,
    supportsFixCompression: false,
    supportsFaceEnhancement: true, // Disabled at creativity 3-6
  },
  "Redefine": {
    shortCode: "redefine",
    type: "generative",
    async: true,
    maxMP: 128,
    description: "Añade definición y detalle, modo realista o creativo",
    supportsCreativity: true,
    supportsTexture: true,
    supportsSharpen: false,
    supportsDenoise: false,
    supportsDetail: false,
    supportsMinorDeblur: false,
    supportsMinorDenoise: false,
    supportsFixCompression: false,
    supportsFaceEnhancement: true, // Disabled at creativity 3-6
  },
  "Recovery V2": {
    shortCode: "recovery",
    type: "generative",
    async: true,
    maxMP: 128,
    description: "Para fotos viejas y de baja calidad (<1MP)",
    supportsCreativity: true,
    supportsTexture: true,
    supportsSharpen: false,
    supportsDenoise: false,
    supportsDetail: false,
    supportsMinorDeblur: false,
    supportsMinorDenoise: false,
    supportsFixCompression: false,
    supportsFaceEnhancement: true, // Disabled at creativity 3-6
  },
};

export type TopazModel = keyof typeof TOPAZ_MODELS;

export const TOPAZ_SCALE_FACTORS = [2, 3, 4, 5, 6] as const;
export type TopazScaleFactor = typeof TOPAZ_SCALE_FACTORS[number];

// Parameters for Standard models
export interface TopazStandardParameters {
  sharpen?: number;              // 0-1 (decimal)
  denoise?: number;              // 0-1 (decimal)
  detail?: number;               // 0-1 (decimal)
  minorDeblur?: number;          // 0.01-1 (decimal)
  minorDenoise?: number;         // 0.01-1 (decimal)
  fixCompression?: number;       // 0-1 (decimal)
  faceEnhancement?: boolean;
  faceEnhancementStrength?: number;    // 0-1
  outputFormat?: "jpeg" | "png" | "tiff";
  cropToFill?: boolean;
}

// Parameters for Generative models
export interface TopazGenerativeParameters {
  creativity?: number;           // 1-6 (integer) - higher = more creative
  texture?: number;              // 1-5 (integer) - add texture
  faceEnhancement?: boolean;     // Disabled at creativity 3-6
  faceEnhancementStrength?: number;    // 0-1
  outputFormat?: "jpeg" | "png" | "tiff";
  cropToFill?: boolean;
}

// Union type for all parameters
export type TopazParameters = TopazStandardParameters & TopazGenerativeParameters;

/**
 * Calculate output dimensions for a given scale factor
 * @param inputWidth - Input width in pixels
 * @param inputHeight - Input height in pixels
 * @param scaleFactor - Scale factor (2-6)
 * @returns Output dimensions and megapixels
 */
export function calculateOutputDimensions(
  inputWidth: number,
  inputHeight: number,
  scaleFactor: number
): { width: number; height: number; megapixels: number } {
  const width = Math.min(inputWidth * scaleFactor, 32000);
  const height = Math.min(inputHeight * scaleFactor, 32000);
  const megapixels = (width * height) / 1_000_000;
  return { width, height, megapixels };
}

/**
 * Calculate Topaz credits based on output resolution in megapixels
 * @param outputWidth - Output width in pixels
 * @param outputHeight - Output height in pixels
 * @returns Number of credits required
 */
export function calculateTopazCredits(outputWidth: number, outputHeight: number): number {
  const megapixels = (outputWidth * outputHeight) / 1_000_000;

  if (megapixels <= 24) return 1;
  if (megapixels <= 32) return 2;
  if (megapixels <= 48) return 3;
  if (megapixels <= 64) return 4;
  if (megapixels <= 128) return 6;
  if (megapixels <= 256) return 10;
  if (megapixels <= 512) return 16;

  // Beyond 512MP not supported
  return 16;
}

/**
 * Validate and calculate Topaz credits with model-specific limits
 * @param inputWidth - Input width in pixels
 * @param inputHeight - Input height in pixels
 * @param scaleFactor - Scale factor (2-6)
 * @param model - Topaz model name
 * @returns Credits and output info, or throws error if invalid
 */
export function calculateTopazStudioCredits(
  inputWidth: number,
  inputHeight: number,
  scaleFactor: TopazScaleFactor,
  model: TopazModel
): { credits: number; outputWidth: number; outputHeight: number; megapixels: number } {
  const modelConfig = TOPAZ_MODELS[model];
  if (!modelConfig) {
    throw new Error(`Unknown Topaz model: ${model}`);
  }

  const { width, height, megapixels } = calculateOutputDimensions(inputWidth, inputHeight, scaleFactor);

  // Check model-specific limits
  if (megapixels > modelConfig.maxMP) {
    throw new Error(`${model} model limited to ${modelConfig.maxMP}MP output. Requested: ${megapixels.toFixed(1)}MP`);
  }

  // Check absolute limits
  if (width > 32000 || height > 32000) {
    throw new Error(`Output dimensions exceed maximum 32000px. Requested: ${width}x${height}`);
  }

  const credits = calculateTopazCredits(width, height);

  return {
    credits,
    outputWidth: width,
    outputHeight: height,
    megapixels: Math.round(megapixels * 100) / 100,
  };
}

/**
 * Get the short code for a Topaz model (used in filenames)
 */
export function getTopazModelShortCode(model: TopazModel): string {
  return TOPAZ_MODELS[model]?.shortCode || "std";
}

export interface ModelCosts {
  cost_input_per_million: number;
  cost_output_per_million: number;
  cost_image_1k: number;
  cost_image_2k: number;
  cost_image_4k: number;
  cost_video_per_second: number;
  cost_audio_per_minute?: number;
}

export interface GenerationUsage {
  tokensInput: number;
  tokensOutput: number;
  imageGenerated: boolean;
  imageSize: string | null; // "1K", "2K", "4K"
  videoSeconds?: number | null;
  audioMinutes?: number | null;
}

/**
 * Calculate the estimated cost for a generation
 * @param costs - Model cost configuration
 * @param usage - Actual usage of the generation
 * @returns Estimated cost in USD
 */
export function calculateEstimatedCost(
  costs: ModelCosts,
  usage: GenerationUsage
): number {
  let totalCost = 0;

  // Token costs (per million tokens)
  if (usage.tokensInput > 0 && costs.cost_input_per_million > 0) {
    totalCost += (usage.tokensInput / 1_000_000) * costs.cost_input_per_million;
  }
  if (usage.tokensOutput > 0 && costs.cost_output_per_million > 0) {
    totalCost += (usage.tokensOutput / 1_000_000) * costs.cost_output_per_million;
  }

  // Image costs (based on resolution)
  if (usage.imageGenerated) {
    switch (usage.imageSize) {
      case "4K":
        totalCost += costs.cost_image_4k || costs.cost_image_2k || costs.cost_image_1k || 0;
        break;
      case "2K":
        totalCost += costs.cost_image_2k || costs.cost_image_1k || 0;
        break;
      case "1K":
      default:
        totalCost += costs.cost_image_1k || 0;
        break;
    }
  }

  // Video costs (per second)
  if (usage.videoSeconds && usage.videoSeconds > 0 && costs.cost_video_per_second > 0) {
    totalCost += usage.videoSeconds * costs.cost_video_per_second;
  }

  // Audio costs (per minute)
  if (usage.audioMinutes && usage.audioMinutes > 0 && costs.cost_audio_per_minute && costs.cost_audio_per_minute > 0) {
    totalCost += usage.audioMinutes * costs.cost_audio_per_minute;
  }

  // Round to 6 decimal places to match database precision
  return Math.round(totalCost * 1_000_000) / 1_000_000;
}

/**
 * Format cost for display
 * @param cost - Cost in USD
 * @returns Formatted string (e.g., "$0.0012" or "$1.23")
 */
export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Format cost with more precision for totals
 * @param cost - Cost in USD
 * @returns Formatted string with appropriate precision
 */
export function formatCostPrecise(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.001) {
    return `$${cost.toFixed(6)}`;
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  if (cost < 1) {
    return `$${cost.toFixed(3)}`;
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Get the cost correction multiplier from environment
 * @returns The cost multiplier (defaults to 1)
 */
export function getCostMultiplier(): number {
  return parseFloat(process.env.COST_CORRECTION_MULTIPLIER || "1");
}

/**
 * Get the monthly cost correction from environment variable COST_YYYYMM
 * Only returns value if the variable exists and matches current month/year
 * @returns The monthly cost correction or 0 if not found/not current month
 */
export function getMonthlyBaseCost(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const envKey = `COST_${year}${month}`;

  const value = process.env[envKey];
  if (!value) {
    return 0;
  }

  // Parse value, supporting both comma and dot as decimal separator
  const parsed = parseFloat(value.replace(",", "."));
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Apply cost corrections to a total: multiplier + monthly base cost
 * @param rawCost - The raw cost from database
 * @param includeMonthlyBase - Whether to include monthly base cost (for global totals only)
 * @returns The corrected cost
 */
export function applyCostCorrections(rawCost: number, includeMonthlyBase: boolean = false): number {
  const multiplier = getCostMultiplier();
  let correctedCost = rawCost * multiplier;

  if (includeMonthlyBase) {
    correctedCost += getMonthlyBaseCost();
  }

  return correctedCost;
}

// ===========================================
// TOPAZ VIDEO STUDIO - Re-exports from topaz-video.ts
// ===========================================

export {
  TOPAZ_VIDEO_MODELS,
  TOPAZ_VIDEO_MODEL_GROUPS,
  calculateTopazVideoCredits,
  getTopazVideoModelName,
  modelSupportsUpscale,
  modelSupportsSlowmo,
  type TopazVideoModel,
  type TopazVideoModelConfig,
  type TopazVideoParameters,
  type TopazVideoEditStatus,
} from "./topaz-video";
