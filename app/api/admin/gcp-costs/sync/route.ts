import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncGcpCosts, isBillingConfigured } from "@/lib/gcp-billing";

// POST - Trigger manual sync of GCP costs
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    // Check if billing is configured
    if (!isBillingConfigured()) {
      return NextResponse.json(
        {
          error: "BigQuery billing export no está configurado",
          details: "Configura GCP_BILLING_ACCOUNT_ID, GCP_BILLING_DATASET y GCP_BILLING_PROJECT en las variables de entorno",
        },
        { status: 400 }
      );
    }

    // Get optional days parameter (default: 2 for today and yesterday)
    const { searchParams } = new URL(request.url);
    const daysBack = Math.min(Number(searchParams.get("days")) || 2, 30);

    // Run sync
    const result = await syncGcpCosts(daysBack);

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Error al sincronizar costos",
          details: result.error,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Sincronización completada: ${result.recordsSynced} registros`,
      recordsSynced: result.recordsSynced,
      totalCost: result.totalCost,
    });
  } catch (error) {
    console.error("Error in sync endpoint:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json(
      {
        error: "Error interno del servidor",
        details: errorMessage,
        stack: process.env.NODE_ENV === "development" ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}
