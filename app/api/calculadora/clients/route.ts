import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

// GET - List clients for calculator (accessible to users with calculator access)
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

    let query: string;
    let params: number[] = [];

    if (isAdmin) {
      query = "SELECT id, name FROM clients ORDER BY name ASC";
    } else {
      query = `SELECT c.id, c.name FROM clients c
        INNER JOIN client_users cu ON c.id = cu.client_id
        WHERE cu.user_id = ?
        ORDER BY c.name ASC`;
      params = [userId];
    }

    const [rows] = await pool.execute<RowDataPacket[]>(query, params);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error obteniendo clientes:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
