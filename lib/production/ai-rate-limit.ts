// Tope de uso del Banner Designer (rutas /api/production/**/ai/*).
//
// Dos límites, ambos leídos de production_ai_invocations (la tabla que cada
// ruta escribe al terminar, con éxito o error):
//   - Presupuesto diario por proyecto en USD (suma de estimated_cost del día
//     en hora Chile — la conexión ya está en America/Santiago, ver lib/db.ts).
//   - Ráfaga por usuario: cantidad de llamadas en la última hora.
//
// Los valores vienen de env con defaults conservadores. 0 o negativo
// desactiva ese límite. Nota: una llamada se registra cuando termina, así
// que N llamadas simultáneas pueden pasar el chequeo a la vez; para el uso
// real (un productor, una llamada de 1-3 min) es suficiente.

import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

export const PRODUCTION_AI_QUOTA_CODE = "PRODUCTION_AI_QUOTA_EXCEEDED";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export interface ProductionAiLimits {
  dailyUsdPerProject: number; // <= 0 desactiva
  hourlyCallsPerUser: number; // <= 0 desactiva
}

export function getProductionAiLimits(): ProductionAiLimits {
  return {
    dailyUsdPerProject: envNumber("PRODUCTION_AI_DAILY_USD_PER_PROJECT", 10),
    hourlyCallsPerUser: envNumber("PRODUCTION_AI_HOURLY_CALLS_PER_USER", 20),
  };
}

export interface ProductionAiUsage {
  usedTodayUsd: number;
  callsLastHour: number;
}

export interface QuotaOk {
  ok: true;
  limits: ProductionAiLimits;
  usage: ProductionAiUsage;
}

export interface QuotaBlocked {
  ok: false;
  code: typeof PRODUCTION_AI_QUOTA_CODE;
  reason: "daily_usd" | "hourly_calls";
  message: string;
  limits: ProductionAiLimits;
  usage: ProductionAiUsage;
}

export type ProductionAiQuotaCheck = QuotaOk | QuotaBlocked;

interface UsdRow extends RowDataPacket {
  used_usd: string | null;
}
interface CountRow extends RowDataPacket {
  calls: number;
}

export async function getProductionAiUsage(
  projectId: number,
  userId: number,
): Promise<ProductionAiUsage> {
  const [[usd]] = await pool.execute<UsdRow[]>(
    `SELECT SUM(estimated_cost) AS used_usd
       FROM production_ai_invocations
      WHERE production_project_id = ?
        AND created_at >= CURDATE()`,
    [projectId],
  );
  const [[cnt]] = await pool.execute<CountRow[]>(
    `SELECT COUNT(*) AS calls
       FROM production_ai_invocations
      WHERE created_by = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
    [userId],
  );
  return {
    usedTodayUsd: Number(usd?.used_usd ?? 0),
    callsLastHour: Number(cnt?.calls ?? 0),
  };
}

const usd = (n: number) => `USD ${n.toFixed(2)}`;

export async function checkProductionAiQuota(params: {
  projectId: number;
  userId: number;
}): Promise<ProductionAiQuotaCheck> {
  const limits = getProductionAiLimits();
  const usage = await getProductionAiUsage(params.projectId, params.userId);

  if (limits.hourlyCallsPerUser > 0 && usage.callsLastHour >= limits.hourlyCallsPerUser) {
    return {
      ok: false,
      code: PRODUCTION_AI_QUOTA_CODE,
      reason: "hourly_calls",
      message: `Llegaste al máximo de ${limits.hourlyCallsPerUser} llamadas al Banner Designer por hora. Espera un rato antes de volver a generar.`,
      limits,
      usage,
    };
  }
  if (limits.dailyUsdPerProject > 0 && usage.usedTodayUsd >= limits.dailyUsdPerProject) {
    return {
      ok: false,
      code: PRODUCTION_AI_QUOTA_CODE,
      reason: "daily_usd",
      message: `Este proyecto ya usó su presupuesto diario de IA (${usd(usage.usedTodayUsd)} de ${usd(limits.dailyUsdPerProject)}). Vuelve a intentar mañana o pide que amplíen el tope.`,
      limits,
      usage,
    };
  }
  return { ok: true, limits, usage };
}

// Cuerpo estándar de la respuesta 429 para las rutas de IA.
export function quotaBlockedBody(check: QuotaBlocked) {
  return {
    error: check.message,
    code: check.code,
    reason: check.reason,
    limits: {
      daily_usd_per_project: check.limits.dailyUsdPerProject,
      hourly_calls_per_user: check.limits.hourlyCallsPerUser,
    },
    usage: {
      used_today_usd: check.usage.usedTodayUsd,
      calls_last_hour: check.usage.callsLastHour,
    },
  };
}
