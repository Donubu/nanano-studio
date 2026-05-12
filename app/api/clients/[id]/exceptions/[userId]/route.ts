import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { ResultSetHeader } from "mysql2";

// DELETE - Remover exención de un usuario en el cliente
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id, userId } = await params;
    const clientId = Number(id);
    const targetUserId = Number(userId);
    if (!Number.isFinite(clientId) || !Number.isFinite(targetUserId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "DELETE FROM client_credit_exceptions WHERE client_id = ? AND user_id = ?",
      [clientId, targetUserId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Exención no encontrada" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando exención:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
