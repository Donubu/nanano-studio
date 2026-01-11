import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  TOPAZ_VIDEO_MODELS,
  calculateTopazVideoCredits,
  type TopazVideoModel,
  type TopazVideoParameters,
} from "@/lib/topaz-video";

/**
 * GET - Estimate credits for video enhancement
 * Query params: duration, model, scaleFactor?, slowmoFactor?
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const duration = parseFloat(searchParams.get("duration") || "0");
    const model = searchParams.get("model") as TopazVideoModel;
    const scaleFactor = parseInt(searchParams.get("scaleFactor") || "1") as 1 | 2 | 4;
    const slowmoFactor = parseInt(searchParams.get("slowmoFactor") || "1") as 1 | 2 | 4 | 8;
    const width = parseInt(searchParams.get("width") || "0");
    const height = parseInt(searchParams.get("height") || "0");

    // Validate required params
    if (!duration || !model) {
      return NextResponse.json({
        error: "Parámetros requeridos: duration, model"
      }, { status: 400 });
    }

    // Validate model
    const modelConfig = TOPAZ_VIDEO_MODELS[model];
    if (!modelConfig) {
      return NextResponse.json({
        error: `Modelo inválido: ${model}`
      }, { status: 400 });
    }

    // Build parameters
    const parameters: TopazVideoParameters = {};
    if (scaleFactor > 1 && modelConfig.supportsUpscale) {
      parameters.scaleFactor = scaleFactor as 1 | 2 | 4;
    }
    if (slowmoFactor > 1 && modelConfig.supportsSlowmo) {
      parameters.slowmoFactor = slowmoFactor as 2 | 4 | 8;
    }

    // Calculate credits
    const creditsInfo = calculateTopazVideoCredits(duration, model, parameters);

    // Calculate output dimensions if provided
    let outputWidth = width;
    let outputHeight = height;
    if (width && height && parameters.scaleFactor) {
      outputWidth = width * parameters.scaleFactor;
      outputHeight = height * parameters.scaleFactor;
    }

    return NextResponse.json({
      inputDuration: duration,
      inputWidth: width || null,
      inputHeight: height || null,
      model,
      modelInfo: modelConfig,
      parameters,
      outputDuration: creditsInfo.outputDuration,
      outputWidth: outputWidth || null,
      outputHeight: outputHeight || null,
      creditsRequired: creditsInfo.credits,
      breakdown: creditsInfo.breakdown,
      estimatedProcessingTime: getEstimatedProcessingTime(duration, model),
    });

  } catch (error) {
    console.error("Error in Topaz Video estimate:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    );
  }
}

/**
 * Get estimated processing time based on duration and model
 */
function getEstimatedProcessingTime(durationSeconds: number, model: TopazVideoModel): string {
  // Rough estimates - actual time varies by server load
  const modelConfig = TOPAZ_VIDEO_MODELS[model];
  const category = modelConfig.category;

  // Processing time multipliers
  const multipliers: Record<string, number> = {
    upscaling: 3,        // 3x input duration
    denoise: 2.5,        // 2.5x input duration
    frame_interpolation: 4, // 4x input duration
    advanced: 3.5,       // 3.5x input duration
  };

  const multiplier = multipliers[category] || 3;
  const estimatedSeconds = durationSeconds * multiplier;

  if (estimatedSeconds < 60) {
    return `~${Math.ceil(estimatedSeconds)} segundos`;
  } else if (estimatedSeconds < 3600) {
    const minutes = Math.ceil(estimatedSeconds / 60);
    return `~${minutes} minuto${minutes > 1 ? "s" : ""}`;
  } else {
    const hours = Math.ceil(estimatedSeconds / 3600);
    return `~${hours} hora${hours > 1 ? "s" : ""}`;
  }
}
