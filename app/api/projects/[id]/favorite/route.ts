import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

// POST - Toggle favorite status for a project
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
    const userId = session.user.id;

    // Verify project exists and is accessible
    const [projects] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM projects WHERE id = ? AND hidden = 0",
      [id]
    );

    if (projects.length === 0) {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }

    // Check if already favorited
    const [existing] = await pool.execute<RowDataPacket[]>(
      "SELECT user_id FROM user_favorite_projects WHERE user_id = ? AND project_id = ?",
      [userId, id]
    );

    if (existing.length > 0) {
      // Remove favorite
      await pool.execute<ResultSetHeader>(
        "DELETE FROM user_favorite_projects WHERE user_id = ? AND project_id = ?",
        [userId, id]
      );
      return NextResponse.json({ project_id: Number(id), is_favorite: false });
    } else {
      // Add favorite
      await pool.execute<ResultSetHeader>(
        "INSERT INTO user_favorite_projects (user_id, project_id) VALUES (?, ?)",
        [userId, id]
      );
      return NextResponse.json({ project_id: Number(id), is_favorite: true });
    }
  } catch (error) {
    console.error("Error toggling project favorite:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
