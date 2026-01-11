import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getGcpCostsSummary,
  getGcpDailyTotals,
  getLastSyncInfo,
  isBillingConfigured,
} from "@/lib/gcp-billing";

// GET - Get GCP costs summary
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    // Check if billing is configured
    const configured = isBillingConfigured();

    if (!configured) {
      return NextResponse.json({
        configured: false,
        message: "BigQuery billing export no está configurado",
      });
    }

    // Get summary data
    const summary = await getGcpCostsSummary();

    // Get daily totals for last 30 days (for chart)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dailyTotals = await getGcpDailyTotals(thirtyDaysAgo, new Date());

    // Get last sync info
    const lastSync = await getLastSyncInfo();

    return NextResponse.json({
      configured: true,
      summary,
      dailyTotals,
      lastSync,
    });
  } catch (error) {
    console.error("Error fetching GCP costs summary:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
