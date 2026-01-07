import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface StatsRow extends RowDataPacket {
  totalConversations: number;
  totalImages: number;
  totalVideos: number;
  activeUsers: number;
  totalTokensInput: number;
  totalTokensOutput: number;
}

// GET - Get project statistics
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: projectId } = await params;

    // Verify access
    if (session.user.role !== "admin") {
      const [access] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM project_users WHERE project_id = ? AND user_id = ?",
        [projectId, session.user.id]
      );
      if (access.length === 0) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
    }

    // Get all stats in one query
    const [stats] = await pool.execute<StatsRow[]>(`
      SELECT
        (SELECT COUNT(*) FROM conversations WHERE project_id = ?) as totalConversations,
        (SELECT COUNT(*) FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.project_id = ? AND m.role = 'model' AND m.image_url IS NOT NULL AND m.image_url != '' AND m.deleted_at IS NULL) as totalImages,
        (SELECT COUNT(*) FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.project_id = ? AND m.role = 'model' AND m.video_url IS NOT NULL AND m.video_url != '' AND m.deleted_at IS NULL) as totalVideos,
        (SELECT COUNT(*) FROM project_users WHERE project_id = ?) as activeUsers,
        (SELECT COALESCE(SUM(m.tokens_input), 0) FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.project_id = ?) as totalTokensInput,
        (SELECT COALESCE(SUM(m.tokens_output), 0) FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.project_id = ?) as totalTokensOutput
    `, [projectId, projectId, projectId, projectId, projectId, projectId]);

    return NextResponse.json(stats[0] || {
      totalConversations: 0,
      totalImages: 0,
      totalVideos: 0,
      activeUsers: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
    });
  } catch (error) {
    console.error("Error fetching project stats:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
