import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { ResultSetHeader } from "mysql2";

// DELETE - Eliminar un ajuste (revertir crédito)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; adjId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id, adjId } = await params;
    const clientId = Number(id);
    const adjustmentId = Number(adjId);
    if (!Number.isFinite(clientId) || !Number.isFinite(adjustmentId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "DELETE FROM client_credit_adjustments WHERE id = ? AND client_id = ?",
      [adjustmentId, clientId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Ajuste no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando ajuste:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
