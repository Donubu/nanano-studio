import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";

interface AdjustmentRow extends RowDataPacket {
  id: number;
  client_id: number;
  period_year: number;
  period_month: number;
  generation_type: "image" | "video";
  delta: number;
  reason: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_by_email: string | null;
  created_at: string;
}

// GET - Listar ajustes del cliente (filtrable por año/mes vía query params).
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
    const clientId = Number(id);
    if (!Number.isFinite(clientId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const month = searchParams.get("month");

    const where: string[] = ["a.client_id = ?"];
    const values: (number | string)[] = [clientId];
    if (year) {
      where.push("a.period_year = ?");
      values.push(Number(year));
    }
    if (month) {
      where.push("a.period_month = ?");
      values.push(Number(month));
    }

    const [rows] = await pool.execute<AdjustmentRow[]>(
      `SELECT a.id, a.client_id, a.period_year, a.period_month, a.generation_type,
              a.delta, a.reason, a.created_by, a.created_at,
              u.name AS created_by_name, u.email AS created_by_email
         FROM client_credit_adjustments a
         LEFT JOIN users u ON a.created_by = u.id
        WHERE ${where.join(" AND ")}
        ORDER BY a.period_year DESC, a.period_month DESC, a.created_at DESC`,
      values
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error listando ajustes:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// POST - Crear ajuste (top-up o corrección)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const clientId = Number(id);
    if (!Number.isFinite(clientId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const schema = z.object({
      period_year: z.number().int().min(2000).max(2100),
      period_month: z.number().int().min(1).max(12),
      generation_type: z.enum(["image", "video"]),
      delta: z.number().int(),
      reason: z.string().max(255).nullable().optional(),
    });
    const parsed = await parseBody(request, schema);
    if (parsed.error) return parsed.error;

    if (parsed.data.delta === 0) {
      return NextResponse.json({ error: "El delta no puede ser 0" }, { status: 400 });
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO client_credit_adjustments
         (client_id, period_year, period_month, generation_type, delta, reason, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        clientId,
        parsed.data.period_year,
        parsed.data.period_month,
        parsed.data.generation_type,
        parsed.data.delta,
        parsed.data.reason ?? null,
        Number(session.user.id),
      ]
    );

    return NextResponse.json({ id: result.insertId, success: true }, { status: 201 });
  } catch (error) {
    console.error("Error creando ajuste:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
