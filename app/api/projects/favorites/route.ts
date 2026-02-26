import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface FavoriteProjectRow extends RowDataPacket {
  id: number;
  title: string;
  client_id: number | null;
  client_name: string | null;
  client_logo: string | null;
  generation_count: number;
  created_at: string;
}

// GET - List user's favorite projects
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const [rows] = await pool.execute<FavoriteProjectRow[]>(`
      SELECT
        p.id, p.title, p.client_id,
        c.name as client_name, c.logo as client_logo,
        COALESCE(gen.generation_count, 0) as generation_count,
        p.created_at
      FROM user_favorite_projects ufp
      JOIN projects p ON ufp.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN (
        SELECT
          conv.project_id,
          COUNT(msg.id) as generation_count
        FROM conversations conv
        JOIN messages msg ON conv.id = msg.conversation_id
        WHERE msg.role = 'model'
          AND (msg.image_url IS NOT NULL OR msg.video_url IS NOT NULL OR msg.audio_url IS NOT NULL)
          AND msg.deleted_at IS NULL
        GROUP BY conv.project_id
      ) gen ON p.id = gen.project_id
      WHERE ufp.user_id = ? AND p.hidden = 0
      ORDER BY ufp.created_at DESC
    `, [session.user.id]);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error fetching favorite projects:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
