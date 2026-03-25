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
  is_personal: number;
  created_at: string;
}

// GET - List user's favorite projects
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const userId = session.user.id;

    // User-favorited projects (non-hidden) + personal project always included
    const [rows] = await pool.execute<FavoriteProjectRow[]>(`
      SELECT
        p.id, p.title, p.client_id,
        c.name as client_name, c.logo as client_logo,
        COALESCE(gen.generation_count, 0) as generation_count,
        p.is_personal,
        p.created_at
      FROM (
        SELECT project_id, created_at as fav_created_at FROM user_favorite_projects WHERE user_id = ?
        UNION
        SELECT id as project_id, created_at as fav_created_at FROM projects WHERE is_personal = 1 AND owner_user_id = ?
      ) src
      JOIN projects p ON src.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN (
        SELECT project_id, COUNT(*) as generation_count
        FROM conversations
        WHERE deleted_at IS NULL
        GROUP BY project_id
      ) gen ON p.id = gen.project_id
      WHERE p.hidden = 0 OR (p.is_personal = 1 AND p.owner_user_id = ?)
      ORDER BY p.is_personal DESC, src.fav_created_at DESC
    `, [userId, userId, userId]);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error fetching favorite projects:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
