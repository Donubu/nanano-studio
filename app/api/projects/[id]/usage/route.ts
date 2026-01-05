import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface UsageRow extends RowDataPacket {
  max_monthly_generations: number;
  current_month_count: number;
}

// GET - Obtener uso del usuario en el proyecto
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    // Admin no tiene límites
    if (session.user.role === "admin") {
      return NextResponse.json({
        used: 0,
        limit: 0, // 0 = sin límite
        unlimited: true,
      });
    }

    // Obtener límite y uso actual del usuario en el proyecto
    const [rows] = await pool.execute<UsageRow[]>(`
      SELECT
        pu.max_monthly_generations,
        (
          SELECT COUNT(*)
          FROM messages m
          JOIN conversations c ON m.conversation_id = c.id
          WHERE c.project_id = ?
            AND c.user_id = ?
            AND m.role = 'user'
            AND m.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
        ) as current_month_count
      FROM project_users pu
      WHERE pu.project_id = ? AND pu.user_id = ?
    `, [id, session.user.id, id, session.user.id]);

    if (rows.length === 0) {
      return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
    }

    const { max_monthly_generations, current_month_count } = rows[0];

    return NextResponse.json({
      used: current_month_count,
      limit: max_monthly_generations,
      unlimited: max_monthly_generations === 0,
    });
  } catch (error) {
    console.error("Error obteniendo uso del proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
