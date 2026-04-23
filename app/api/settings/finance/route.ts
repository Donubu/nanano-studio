import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

const KEY_BALANCE = "finance.available_balance_usd";
const KEY_RATE = "finance.usd_clp_rate";

interface ConfigRow extends RowDataPacket {
  config_key: string;
  config_value: unknown;
  updated_at: string;
}

function parseConfigValue(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      const n = Number(parsed);
      return Number.isFinite(n) ? n : null;
    } catch {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const [rows] = await pool.execute<ConfigRow[]>(
      "SELECT config_key, config_value, updated_at FROM budget_config WHERE config_key IN (?, ?)",
      [KEY_BALANCE, KEY_RATE]
    );

    let balanceUsd: number | null = null;
    let rate: number | null = null;
    let updatedAt: string | null = null;
    for (const r of rows) {
      if (r.config_key === KEY_BALANCE) balanceUsd = parseConfigValue(r.config_value);
      else if (r.config_key === KEY_RATE) rate = parseConfigValue(r.config_value);
      if (!updatedAt || (r.updated_at && r.updated_at > updatedAt)) updatedAt = r.updated_at;
    }

    return NextResponse.json({
      available_balance_usd: balanceUsd,
      usd_clp_rate: rate,
      updated_at: updatedAt,
    });
  } catch (error) {
    console.error("Error leyendo finance settings:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const userId = (session.user as { id: number }).id;
    const body = await request.json();

    const balance = body.available_balance_usd;
    const rate = body.usd_clp_rate;

    if (balance !== undefined) {
      const n = Number(balance);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: "Saldo inválido" }, { status: 400 });
      }
      await pool.execute(
        `INSERT INTO budget_config (config_key, config_value, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by)`,
        [KEY_BALANCE, JSON.stringify(n), userId]
      );
    }

    if (rate !== undefined) {
      const n = Number(rate);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: "Tasa inválida" }, { status: 400 });
      }
      await pool.execute(
        `INSERT INTO budget_config (config_key, config_value, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by)`,
        [KEY_RATE, JSON.stringify(n), userId]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error guardando finance settings:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
