import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

interface QualityUsage {
  used: number;
  limit: number;
  unlimited: boolean;
}

interface TypeUsage {
  normal: QualityUsage;
  hq: QualityUsage;
}

interface UsageResponse {
  text: TypeUsage;
  image: TypeUsage;
  video: TypeUsage;
  audio: TypeUsage;
}

// GET - Obtener uso del usuario en el proyecto (separado por tipo y calidad)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    // Todos los usuarios tienen cuotas ilimitadas
    const unlimitedQuality: QualityUsage = { used: 0, limit: 0, unlimited: true };
    const unlimitedType: TypeUsage = { normal: unlimitedQuality, hq: unlimitedQuality };
    return NextResponse.json({
      text: unlimitedType,
      image: unlimitedType,
      video: unlimitedType,
      audio: unlimitedType,
    } as UsageResponse);
  } catch (error) {
    console.error("Error obteniendo uso del proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
