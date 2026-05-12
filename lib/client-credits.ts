import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

export type CreditGenerationType = "image" | "video";

export const CREDIT_ERROR_CODE = "CLIENT_QUOTA_EXCEEDED";

export interface ClientCreditPolicy {
  monthly_image_limit: number | null;
  monthly_video_limit: number | null;
}

export interface CreditPeriod {
  year: number;
  month: number; // 1-12
}

export interface CreditStatus {
  type: CreditGenerationType;
  // null = ilimitado; número (>=0) = cuota efectiva (base + ajustes)
  effective_limit: number | null;
  used: number;
  remaining: number | null;
  blocked: boolean; // true cuando effective_limit > 0 y used >= effective_limit, o effective_limit === 0
}

export interface QuotaCheckOk {
  ok: true;
  exempt: boolean; // true si admin o usuario marcado como exento
  status: CreditStatus | null; // null si no aplica (ej. admin o sin cliente)
}

export interface QuotaCheckBlocked {
  ok: false;
  code: typeof CREDIT_ERROR_CODE;
  type: CreditGenerationType;
  limit: number;
  used: number;
  period: CreditPeriod;
  client_id: number;
  message: string;
}

export type QuotaCheck = QuotaCheckOk | QuotaCheckBlocked;

const MONTH_NAMES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// Fechas YYYY-MM-DD para acotar el mes en queries (rango semi-abierto)
function monthBoundsSQL(period: CreditPeriod): { start: string; nextStart: string } {
  const y = period.year;
  const m = period.month;
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const nextStart = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
  return { start, nextStart };
}

// Periodo actual usando la zona horaria de la conexión (America/Santiago).
// Se hace una query liviana para evitar discrepancias con el reloj del servidor Node.
export async function getCurrentPeriod(): Promise<CreditPeriod> {
  interface PeriodRow extends RowDataPacket {
    y: number;
    m: number;
  }
  const [rows] = await pool.execute<PeriodRow[]>(
    "SELECT YEAR(NOW()) AS y, MONTH(NOW()) AS m"
  );
  return { year: Number(rows[0].y), month: Number(rows[0].m) };
}

export async function getClientPolicy(clientId: number): Promise<ClientCreditPolicy | null> {
  interface Row extends RowDataPacket {
    monthly_image_limit: number | null;
    monthly_video_limit: number | null;
  }
  const [rows] = await pool.execute<Row[]>(
    "SELECT monthly_image_limit, monthly_video_limit FROM clients WHERE id = ?",
    [clientId]
  );
  if (rows.length === 0) return null;
  return {
    monthly_image_limit: rows[0].monthly_image_limit,
    monthly_video_limit: rows[0].monthly_video_limit,
  };
}

export async function isUserExempt(clientId: number, userId: number): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT 1 FROM client_credit_exceptions WHERE client_id = ? AND user_id = ? AND unlimited = 1 LIMIT 1",
    [clientId, userId]
  );
  return rows.length > 0;
}

export async function getAdjustmentsSum(
  clientId: number,
  type: CreditGenerationType,
  period: CreditPeriod
): Promise<number> {
  interface Row extends RowDataPacket {
    total: number | null;
  }
  const [rows] = await pool.execute<Row[]>(
    `SELECT COALESCE(SUM(delta), 0) AS total
       FROM client_credit_adjustments
      WHERE client_id = ?
        AND period_year = ?
        AND period_month = ?
        AND generation_type = ?`,
    [clientId, period.year, period.month, type]
  );
  return Number(rows[0]?.total ?? 0);
}

// Cuota efectiva = base + ajustes. null si base es null (ilimitado).
export async function getEffectiveLimit(
  clientId: number,
  type: CreditGenerationType,
  period: CreditPeriod
): Promise<number | null> {
  const policy = await getClientPolicy(clientId);
  if (!policy) return null;
  const base = type === "image" ? policy.monthly_image_limit : policy.monthly_video_limit;
  if (base === null) return null;
  const topups = await getAdjustmentsSum(clientId, type, period);
  return Math.max(0, base + topups);
}

// Cuenta generaciones completadas en el mes que pertenecen al cliente,
// excluyendo las hechas por usuarios exentos.
export async function getCurrentMonthUsage(
  clientId: number,
  type: CreditGenerationType,
  period: CreditPeriod
): Promise<number> {
  const { start, nextStart } = monthBoundsSQL(period);
  interface Row extends RowDataPacket {
    cnt: number;
  }
  const [rows] = await pool.execute<Row[]>(
    `SELECT COUNT(*) AS cnt
       FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       JOIN projects p ON c.project_id = p.id
      WHERE p.client_id = ?
        AND m.role = 'model'
        AND m.status = 'completed'
        AND m.content_type = ?
        AND m.created_at >= ?
        AND m.created_at < ?
        AND (m.user_id IS NULL OR m.user_id NOT IN (
          SELECT cce.user_id FROM client_credit_exceptions cce
           WHERE cce.client_id = ? AND cce.unlimited = 1
        ))`,
    [clientId, type, start, nextStart, clientId]
  );
  return Number(rows[0]?.cnt ?? 0);
}

export async function getCreditStatus(
  clientId: number,
  type: CreditGenerationType,
  period: CreditPeriod
): Promise<CreditStatus> {
  const [effective_limit, used] = await Promise.all([
    getEffectiveLimit(clientId, type, period),
    getCurrentMonthUsage(clientId, type, period),
  ]);
  const blocked =
    effective_limit !== null && (effective_limit === 0 || used >= effective_limit);
  const remaining =
    effective_limit === null ? null : Math.max(0, effective_limit - used);
  return { type, effective_limit, used, remaining, blocked };
}

// Resuelve el client_id a partir de la conversación.
// Conversaciones sin proyecto o cuyo proyecto no tenga cliente devuelven null.
export async function getClientIdForConversation(conversationId: number): Promise<number | null> {
  interface Row extends RowDataPacket {
    client_id: number | null;
  }
  const [rows] = await pool.execute<Row[]>(
    `SELECT p.client_id
       FROM conversations c
       LEFT JOIN projects p ON c.project_id = p.id
      WHERE c.id = ?
      LIMIT 1`,
    [conversationId]
  );
  if (rows.length === 0) return null;
  return rows[0].client_id ?? null;
}

interface AssertOpts {
  clientId: number;
  userId: number;
  isAdmin: boolean;
  type: CreditGenerationType;
  period?: CreditPeriod;
}

// Verifica si una generación puede proceder. Admins y usuarios exentos siempre pueden.
export async function checkClientCreditQuota(opts: AssertOpts): Promise<QuotaCheck> {
  if (opts.isAdmin) {
    return { ok: true, exempt: true, status: null };
  }

  const exempt = await isUserExempt(opts.clientId, opts.userId);
  if (exempt) {
    return { ok: true, exempt: true, status: null };
  }

  const period = opts.period ?? (await getCurrentPeriod());
  const status = await getCreditStatus(opts.clientId, opts.type, period);

  if (status.blocked) {
    const monthName = MONTH_NAMES_ES[period.month - 1] ?? `${period.month}`;
    const tipoLabel = opts.type === "image" ? "imágenes" : "videos";
    const message =
      status.effective_limit === 0
        ? `Las generaciones de ${tipoLabel} están bloqueadas para este cliente.`
        : `Se alcanzó el límite mensual de ${tipoLabel} del cliente para ${monthName} ${period.year} (${status.used}/${status.effective_limit}). Contacta a un administrador para sumar créditos adicionales.`;
    return {
      ok: false,
      code: CREDIT_ERROR_CODE,
      type: opts.type,
      limit: status.effective_limit ?? 0,
      used: status.used,
      period,
      client_id: opts.clientId,
      message,
    };
  }

  return { ok: true, exempt: false, status };
}
