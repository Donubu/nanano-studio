import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  calculateTopazStudioCredits,
  TopazModel,
  TopazScaleFactor,
  TOPAZ_MODELS,
  TOPAZ_SCALE_FACTORS,
} from "@/lib/cost-calculator";

// GET - Estimate credits for a Topaz Studio operation
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const width = parseInt(searchParams.get("width") || "0");
    const height = parseInt(searchParams.get("height") || "0");
    const scaleFactor = parseInt(searchParams.get("scaleFactor") || "2") as TopazScaleFactor;
    const model = (searchParams.get("model") || "Standard V2") as TopazModel;

    // Validate inputs
    if (!width || !height) {
      return NextResponse.json({
        error: "Parámetros requeridos: width, height"
      }, { status: 400 });
    }

    if (!TOPAZ_SCALE_FACTORS.includes(scaleFactor)) {
      return NextResponse.json({
        error: `Scale factor inválido: ${scaleFactor}. Valores válidos: ${TOPAZ_SCALE_FACTORS.join(", ")}`
      }, { status: 400 });
    }

    if (!TOPAZ_MODELS[model]) {
      return NextResponse.json({
        error: `Modelo inválido: ${model}. Modelos disponibles: ${Object.keys(TOPAZ_MODELS).join(", ")}`
      }, { status: 400 });
    }

    try {
      const result = calculateTopazStudioCredits(width, height, scaleFactor, model);

      return NextResponse.json({
        inputWidth: width,
        inputHeight: height,
        scaleFactor,
        model,
        outputWidth: result.outputWidth,
        outputHeight: result.outputHeight,
        outputMegapixels: result.megapixels,
        creditsRequired: result.credits,
        modelInfo: TOPAZ_MODELS[model],
      });
    } catch (err) {
      return NextResponse.json({
        error: err instanceof Error ? err.message : "Error calculando estimación"
      }, { status: 400 });
    }

  } catch (error) {
    console.error("[Topaz Studio Estimate] Error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
