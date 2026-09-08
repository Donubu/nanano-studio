import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getProductionAiLimits, getProductionAiUsage } from "@/lib/production/ai-rate-limit";

/**
 * GET /api/production/projects/[id]/ai-costs
 *
 * Resumen de costos de IA (Banner Designer) por proyecto de producción.
 * Lee `production_ai_invocations` — la tabla se escribe en cada llamada al
 * agente desde las rutas /ai/*, pero hasta ahora nadie la consumía.
 *
 * Query params:
 *   days  — ventana en días para el bloque `period` (default 30, max 365).
 *
 * Respuesta:
 *   {
 *     quota:  { daily_usd_per_project, used_today_usd, hourly_calls_per_user, calls_last_hour },
 *     total:  { invocations, errors, cost_usd, input_tokens, output_tokens },
 *     period: { days, invocations, errors, cost_usd },
 *     by_operation: [{ operation, invocations, errors, cost_usd, avg_cost_usd }],
 *     recent: [{ id, operation, agent_name, success, cost_usd, error_msg,
 *                rationale, template_id, target_template_id, created_by_name,
 *                created_at }]
 *   }
 */

interface TotalsRow extends RowDataPacket {
  invocations: number;
  errors: number;
  cost_usd: string | null;
  input_tokens: string | null;
  output_tokens: string | null;
}

interface PeriodRow extends RowDataPacket {
  invocations: number;
  errors: number;
  cost_usd: string | null;
}

interface ByOperationRow extends RowDataPacket {
  operation: string;
  invocations: number;
  errors: number;
  cost_usd: string | null;
}

interface RecentRow extends RowDataPacket {
  id: number;
  operation: string;
  agent_name: string;
  success: number;
  estimated_cost: string | null;
  error_msg: string | null;
  rationale: string | null;
  template_id: number | null;
  target_template_id: number | null;
  created_by_name: string | null;
  created_at: Date;
}

const num = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const daysRaw = Number(request.nextUrl.searchParams.get("days") ?? 30);
    const days = Number.isFinite(daysRaw) ? Math.min(365, Math.max(1, Math.floor(daysRaw))) : 30;

    const [exists] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM production_projects WHERE id = ? AND deleted_at IS NULL",
      [projectId]
    );
    if (exists.length === 0) {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }

    const [[totals]] = await pool.execute<TotalsRow[]>(
      `SELECT COUNT(*) AS invocations,
              SUM(success = 0) AS errors,
              SUM(estimated_cost) AS cost_usd,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens
         FROM production_ai_invocations
        WHERE production_project_id = ?`,
      [projectId]
    );

    const [[period]] = await pool.execute<PeriodRow[]>(
      `SELECT COUNT(*) AS invocations,
              SUM(success = 0) AS errors,
              SUM(estimated_cost) AS cost_usd
         FROM production_ai_invocations
        WHERE production_project_id = ?
          AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [projectId, days]
    );

    const [byOperation] = await pool.execute<ByOperationRow[]>(
      `SELECT operation,
              COUNT(*) AS invocations,
              SUM(success = 0) AS errors,
              SUM(estimated_cost) AS cost_usd
         FROM production_ai_invocations
        WHERE production_project_id = ?
        GROUP BY operation
        ORDER BY cost_usd DESC`,
      [projectId]
    );

    const [recent] = await pool.execute<RecentRow[]>(
      `SELECT i.id, i.operation, i.agent_name, i.success, i.estimated_cost,
              i.error_msg, i.rationale, i.template_id, i.target_template_id,
              i.created_at, u.name AS created_by_name
         FROM production_ai_invocations i
         LEFT JOIN users u ON u.id = i.created_by
        WHERE i.production_project_id = ?
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT 20`,
      [projectId]
    );

    const limits = getProductionAiLimits();
    const usage = await getProductionAiUsage(projectId, Number(session.user.id));

    return NextResponse.json({
      quota: {
        daily_usd_per_project: limits.dailyUsdPerProject,
        used_today_usd: usage.usedTodayUsd,
        hourly_calls_per_user: limits.hourlyCallsPerUser,
        calls_last_hour: usage.callsLastHour,
      },
      total: {
        invocations: num(totals?.invocations),
        errors: num(totals?.errors),
        cost_usd: num(totals?.cost_usd),
        input_tokens: num(totals?.input_tokens),
        output_tokens: num(totals?.output_tokens),
      },
      period: {
        days,
        invocations: num(period?.invocations),
        errors: num(period?.errors),
        cost_usd: num(period?.cost_usd),
      },
      by_operation: byOperation.map((r) => {
        const invocations = num(r.invocations);
        const cost = num(r.cost_usd);
        return {
          operation: r.operation,
          invocations,
          errors: num(r.errors),
          cost_usd: cost,
          avg_cost_usd: invocations > 0 ? cost / invocations : 0,
        };
      }),
      recent: recent.map((r) => ({
        id: r.id,
        operation: r.operation,
        agent_name: r.agent_name,
        success: r.success === 1,
        cost_usd: r.estimated_cost == null ? null : Number(r.estimated_cost),
        error_msg: r.error_msg,
        rationale: r.rationale,
        template_id: r.template_id,
        target_template_id: r.target_template_id,
        created_by_name: r.created_by_name,
        created_at: r.created_at,
      })),
    });
  } catch (error) {
    console.error("Error obteniendo costos IA de production_project:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
