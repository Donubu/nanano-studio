import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { ResultSetHeader } from "mysql2";

// POST - Restaurar conversación archivada
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    // Restaurar: establecer deleted_at a NULL
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE conversations SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`,
      [id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { error: "Conversación no encontrada o ya está activa" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error restaurando conversación:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
