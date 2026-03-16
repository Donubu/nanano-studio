import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

// PATCH - Change budget status (accept/reject with note)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const isAdmin = session.user.role === "admin";
    const userId = (session.user as { id: number }).id;

    const body = await request.json();
    const { status, note } = body;

    if (!status || !["accepted", "rejected"].includes(status)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    }

    // Verify budget exists and user has access (admin, owner, or client user)
    const [budgets] = await pool.execute<RowDataPacket[]>(
      isAdmin
        ? `SELECT id, status FROM budgets WHERE id = ? AND deleted_at IS NULL`
        : `SELECT b.id, b.status FROM budgets b
           WHERE b.id = ? AND b.deleted_at IS NULL
           AND (b.created_by = ? OR b.client_id IN (SELECT client_id FROM client_users WHERE user_id = ?))`,
      isAdmin ? [id] : [id, userId, userId]
    );

    if (budgets.length === 0) {
      return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
    }

    const current = budgets[0];
    if (current.status !== "draft") {
      return NextResponse.json({ error: "Solo se pueden cambiar presupuestos en borrador" }, { status: 400 });
    }

    await pool.execute<ResultSetHeader>(
      "UPDATE budgets SET status = ?, status_note = ?, status_date = NOW() WHERE id = ?",
      [status, note || null, id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando estado:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
