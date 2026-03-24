import { describe, it, expect } from "vitest";
import {
  calculateEstimatedCost,
  calculateTopazCredits,
  calculateTopazStudioCredits,
  calculateOutputDimensions,
  formatCost,
  formatCostPrecise,
  type ModelCosts,
  type GenerationUsage,
} from "@/lib/cost-calculator";

describe("calculateEstimatedCost", () => {
  const baseCosts: ModelCosts = {
    cost_input_per_million: 1.25,
    cost_output_per_million: 5.0,
    cost_image_1k: 0.02,
    cost_image_2k: 0.04,
    cost_image_4k: 0.08,
    cost_video_per_second: 0.05,
    cost_audio_per_minute: 0.10,
    cost_music_per_minute: 0.15,
  };

  it("calculates token costs correctly", () => {
    const usage: GenerationUsage = {
      tokensInput: 1000,
      tokensOutput: 500,
      imageGenerated: false,
      imageSize: null,
    };
    // (1000/1M) * 1.25 + (500/1M) * 5.0 = 0.00125 + 0.0025 = 0.00375
    expect(calculateEstimatedCost(baseCosts, usage)).toBeCloseTo(0.00375, 6);
  });

  it("calculates image 1K cost", () => {
    const usage: GenerationUsage = {
      tokensInput: 0,
      tokensOutput: 0,
      imageGenerated: true,
      imageSize: "1K",
    };
    expect(calculateEstimatedCost(baseCosts, usage)).toBe(0.02);
  });

  it("calculates image 2K cost", () => {
    const usage: GenerationUsage = {
      tokensInput: 0,
      tokensOutput: 0,
      imageGenerated: true,
      imageSize: "2K",
    };
    expect(calculateEstimatedCost(baseCosts, usage)).toBe(0.04);
  });

  it("calculates image 4K cost", () => {
    const usage: GenerationUsage = {
      tokensInput: 0,
      tokensOutput: 0,
      imageGenerated: true,
      imageSize: "4K",
    };
    expect(calculateEstimatedCost(baseCosts, usage)).toBe(0.08);
  });

  it("falls back to lower resolution cost when higher is 0", () => {
    const costs: ModelCosts = { ...baseCosts, cost_image_4k: 0, cost_image_2k: 0 };
    const usage: GenerationUsage = {
      tokensInput: 0,
      tokensOutput: 0,
      imageGenerated: true,
      imageSize: "4K",
    };
    expect(calculateEstimatedCost(costs, usage)).toBe(0.02); // falls to 1K
  });

  it("calculates video cost per second", () => {
    const usage: GenerationUsage = {
      tokensInput: 0,
      tokensOutput: 0,
      imageGenerated: false,
      imageSize: null,
      videoSeconds: 10,
    };
    expect(calculateEstimatedCost(baseCosts, usage)).toBe(0.5);
  });

  it("calculates audio cost per minute", () => {
    const usage: GenerationUsage = {
      tokensInput: 0,
      tokensOutput: 0,
      imageGenerated: false,
      imageSize: null,
      audioMinutes: 5,
    };
    expect(calculateEstimatedCost(baseCosts, usage)).toBe(0.5);
  });

  it("calculates music cost per minute", () => {
    const usage: GenerationUsage = {
      tokensInput: 0,
      tokensOutput: 0,
      imageGenerated: false,
      imageSize: null,
      musicMinutes: 2,
    };
    expect(calculateEstimatedCost(baseCosts, usage)).toBe(0.3);
  });

  it("combines multiple cost types", () => {
    const usage: GenerationUsage = {
      tokensInput: 500000,
      tokensOutput: 100000,
      imageGenerated: true,
      imageSize: "2K",
      videoSeconds: 5,
    };
    // tokens: (500000/1M)*1.25 + (100000/1M)*5.0 = 0.625 + 0.5 = 1.125
    // image: 0.04
    // video: 5 * 0.05 = 0.25
    // total: 1.415
    expect(calculateEstimatedCost(baseCosts, usage)).toBeCloseTo(1.415, 6);
  });

  it("returns 0 for zero usage", () => {
    const usage: GenerationUsage = {
      tokensInput: 0,
      tokensOutput: 0,
      imageGenerated: false,
      imageSize: null,
    };
    expect(calculateEstimatedCost(baseCosts, usage)).toBe(0);
  });

  it("rounds to 6 decimal places", () => {
    const usage: GenerationUsage = {
      tokensInput: 1,
      tokensOutput: 1,
      imageGenerated: false,
      imageSize: null,
    };
    const result = calculateEstimatedCost(baseCosts, usage);
    const decimals = result.toString().split(".")[1]?.length || 0;
    expect(decimals).toBeLessThanOrEqual(6);
  });
});

describe("calculateTopazCredits", () => {
  it("returns 1 credit for <= 24MP", () => {
    expect(calculateTopazCredits(4000, 6000)).toBe(1); // 24MP
    expect(calculateTopazCredits(1000, 1000)).toBe(1); // 1MP
  });

  it("returns 2 credits for <= 32MP", () => {
    expect(calculateTopazCredits(4000, 8000)).toBe(2); // 32MP exactly
    expect(calculateTopazCredits(5000, 5000)).toBe(2); // 25MP
  });

  it("returns 3 credits for <= 48MP", () => {
    expect(calculateTopazCredits(8000, 6000)).toBe(3); // 48MP
  });

  it("returns 4 credits for <= 64MP", () => {
    expect(calculateTopazCredits(8000, 8000)).toBe(4); // 64MP
  });

  it("returns 6 credits for <= 128MP", () => {
    expect(calculateTopazCredits(12000, 10000)).toBe(6); // 120MP
  });

  it("returns 10 credits for <= 256MP", () => {
    expect(calculateTopazCredits(16000, 16000)).toBe(10); // 256MP
  });

  it("returns 16 credits for <= 512MP", () => {
    expect(calculateTopazCredits(22627, 22627)).toBe(16); // ~512MP
  });

  it("returns 16 credits for > 512MP", () => {
    expect(calculateTopazCredits(30000, 30000)).toBe(16);
  });
});

describe("calculateOutputDimensions", () => {
  it("scales dimensions correctly", () => {
    expect(calculateOutputDimensions(1000, 500, 2)).toEqual({
      width: 2000,
      height: 1000,
      megapixels: 2,
    });
  });

  it("caps at 32000px", () => {
    const result = calculateOutputDimensions(10000, 10000, 6);
    expect(result.width).toBe(32000);
    expect(result.height).toBe(32000);
  });

  it("calculates megapixels correctly", () => {
    const result = calculateOutputDimensions(4000, 3000, 1);
    expect(result.megapixels).toBe(12);
  });
});

describe("calculateTopazStudioCredits", () => {
  it("calculates credits for Standard V2", () => {
    const result = calculateTopazStudioCredits(1000, 1000, 2, "Standard V2");
    expect(result.credits).toBe(1);
    expect(result.outputWidth).toBe(2000);
    expect(result.outputHeight).toBe(2000);
  });

  it("throws for unknown model", () => {
    expect(() => calculateTopazStudioCredits(100, 100, 2, "Nonexistent" as any))
      .toThrow("Unknown Topaz model");
  });

  it("throws when exceeding model MP limit", () => {
    // Wonder maxMP = 128, try to exceed it
    expect(() => calculateTopazStudioCredits(5000, 5000, 6, "Wonder"))
      .toThrow("limited to 128MP");
  });

  it("rounds megapixels to 2 decimal places", () => {
    const result = calculateTopazStudioCredits(333, 333, 2, "Standard V2");
    const decimals = result.megapixels.toString().split(".")[1]?.length || 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });
});

describe("formatCost", () => {
  it("formats zero", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("formats small values with 4 decimals", () => {
    expect(formatCost(0.0012)).toBe("$0.0012");
  });

  it("formats normal values with 2 decimals", () => {
    expect(formatCost(1.234)).toBe("$1.23");
  });

  it("formats values >= 0.01 with 2 decimals", () => {
    expect(formatCost(0.05)).toBe("$0.05");
  });
});

describe("formatCostPrecise", () => {
  it("formats zero", () => {
    expect(formatCostPrecise(0)).toBe("$0.00");
  });

  it("formats very small values with 6 decimals", () => {
    expect(formatCostPrecise(0.000123)).toBe("$0.000123");
  });

  it("formats small values with 4 decimals", () => {
    expect(formatCostPrecise(0.0045)).toBe("$0.0045");
  });

  it("formats medium values with 3 decimals", () => {
    expect(formatCostPrecise(0.456)).toBe("$0.456");
  });

  it("formats large values with 2 decimals", () => {
    expect(formatCostPrecise(123.456)).toBe("$123.46");
  });
});
