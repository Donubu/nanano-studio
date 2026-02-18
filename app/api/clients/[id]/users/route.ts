import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

// GET - List users assigned to this client (admin only)
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

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT u.id, u.name, u.email, u.image, cu.created_at as assigned_at
       FROM client_users cu
       JOIN users u ON cu.user_id = u.id
       WHERE cu.client_id = ?
       ORDER BY u.name ASC`,
      [id]
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error obteniendo usuarios del cliente:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Assign user(s) to client (admin only)
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
    const body = await request.json();
    const { userIds } = body as { userIds: number[] };

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: "userIds es requerido" }, { status: 400 });
    }

    // Verify client exists
    const [clientRows] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM clients WHERE id = ?",
      [id]
    );
    if (clientRows.length === 0) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    // Insert each user (ignore duplicates)
    for (const userId of userIds) {
      await pool.execute(
        "INSERT IGNORE INTO client_users (client_id, user_id) VALUES (?, ?)",
        [id, userId]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error asignando usuarios al cliente:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE - Remove user from client (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { userId } = body as { userId: number };

    if (!userId) {
      return NextResponse.json({ error: "userId es requerido" }, { status: 400 });
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "DELETE FROM client_users WHERE client_id = ? AND user_id = ?",
      [id, userId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Asignación no encontrada" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removiendo usuario del cliente:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
