import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getGcpCostsByRange,
  getGcpCostsByService,
  getGcpDailyTotals,
  getLastSyncInfo,
} from "@/lib/gcp-billing";

// GET - Get GCP costs with filters
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);

    // Parse date range (defaults to last 30 days)
    const period = searchParams.get("period") || "30";
    const serviceFilter = searchParams.get("service") || undefined;
    const view = searchParams.get("view") || "detailed"; // "detailed", "by_service", "daily_totals"

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();

    if (period === "all") {
      startDate.setFullYear(startDate.getFullYear() - 1); // Last year
    } else {
      const days = parseInt(period);
      startDate.setDate(startDate.getDate() - days);
    }

    // Get data based on view type
    let data;
    switch (view) {
      case "by_service":
        data = await getGcpCostsByService(startDate, endDate);
        break;
      case "daily_totals":
        data = await getGcpDailyTotals(startDate, endDate);
        break;
      case "detailed":
      default:
        data = await getGcpCostsByRange(startDate, endDate, serviceFilter);
        break;
    }

    // Get last sync info
    const lastSync = await getLastSyncInfo();

    return NextResponse.json({
      data,
      period,
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
      lastSync,
    });
  } catch (error) {
    console.error("Error fetching GCP costs:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
