import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getGcpCostsSummary,
  getGcpCostsByService,
  getGcpDailyTotals,
  getLastSyncInfo,
  isBillingConfigured,
} from "@/lib/gcp-billing";

// GET - Get GCP costs summary
export async function GET(request: Request) {
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

    // Parse period/date params
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "30";
    const dateFromParam = searchParams.get("date_from");
    const dateToParam = searchParams.get("date_to");

    let fromDate: Date;
    let toDate = new Date();
    if (dateFromParam && dateToParam) {
      fromDate = new Date(dateFromParam);
      toDate = new Date(dateToParam);
      toDate.setHours(23, 59, 59, 999);
    } else if (period === "1") {
      fromDate = new Date();
      fromDate.setHours(0, 0, 0, 0);
    } else if (period === "all") {
      // Todo el tiempo: usar una fecha base muy antigua para no acotar el rango.
      fromDate = new Date("2000-01-01T00:00:00Z");
    } else {
      const days = parseInt(period) || 30;
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
    }

    // Fetch daily totals, by-service breakdown, and last sync in parallel
    const [dailyTotals, byServiceForPeriod, lastSync] = await Promise.all([
      getGcpDailyTotals(fromDate, toDate),
      getGcpCostsByService(fromDate, toDate),
      getLastSyncInfo(),
    ]);

    return NextResponse.json({
      configured: true,
      summary: { ...summary, byService: byServiceForPeriod },
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
