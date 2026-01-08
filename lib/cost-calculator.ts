/**
 * Cost Calculator for AI Generation
 * Calculates estimated costs based on model pricing and usage
 */

export interface ModelCosts {
  cost_input_per_million: number;
  cost_output_per_million: number;
  cost_image_1k: number;
  cost_image_2k: number;
  cost_image_4k: number;
  cost_video_per_second: number;
}

export interface GenerationUsage {
  tokensInput: number;
  tokensOutput: number;
  imageGenerated: boolean;
  imageSize: string | null; // "1K", "2K", "4K"
  videoSeconds: number | null;
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
