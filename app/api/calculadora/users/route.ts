import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

// GET - List active users for hour assignment in calculator
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const userId = (session.user as { id: number }).id;
    const isAdmin = session.user.role === "admin";

    if (!isAdmin) {
      const [accessRows] = await pool.execute<RowDataPacket[]>(
        "SELECT ai_calculator_access FROM users WHERE id = ?",
        [userId]
      );
      if (!accessRows.length || accessRows[0].ai_calculator_access !== 1) {
        return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      }
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT id, name, email, cargo FROM users WHERE deleted_at IS NULL AND blocked_at IS NULL ORDER BY name ASC"
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error obteniendo usuarios:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
