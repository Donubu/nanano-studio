import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";

interface ExceptionRow extends RowDataPacket {
  id: number;
  client_id: number;
  user_id: number;
  unlimited: number;
  reason: string | null;
  created_by: number | null;
  created_at: string;
  user_email: string;
  user_name: string | null;
  user_image: string | null;
}

// GET - Listar usuarios exentos del cliente
export async function GET(
  _request: NextRequest,
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

    const [rows] = await pool.execute<ExceptionRow[]>(
      `SELECT e.id, e.client_id, e.user_id, e.unlimited, e.reason, e.created_by, e.created_at,
              u.email AS user_email, u.name AS user_name, u.image AS user_image
         FROM client_credit_exceptions e
         JOIN users u ON e.user_id = u.id
        WHERE e.client_id = ?
        ORDER BY e.created_at DESC`,
      [clientId]
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error listando exenciones:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// POST - Marcar un usuario como exento del cliente
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
      user_id: z.number().int().positive(),
      reason: z.string().max(255).nullable().optional(),
    });
    const parsed = await parseBody(request, schema);
    if (parsed.error) return parsed.error;

    const [existing] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM client_credit_exceptions WHERE client_id = ? AND user_id = ?",
      [clientId, parsed.data.user_id]
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { error: "El usuario ya está exento en este cliente" },
        { status: 409 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO client_credit_exceptions (client_id, user_id, unlimited, reason, created_by)
       VALUES (?, ?, 1, ?, ?)`,
      [clientId, parsed.data.user_id, parsed.data.reason ?? null, Number(session.user.id)]
    );

    return NextResponse.json({ id: result.insertId, success: true }, { status: 201 });
  } catch (error) {
    console.error("Error creando exención:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
