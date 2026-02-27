import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getCostMultiplier } from "@/lib/cost-calculator";

interface StatsRow extends RowDataPacket {
  totalConversations: number;
  totalImages: number;
  totalVideos: number;
  totalMusic: number;
  activeUsers: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalEstimatedCost: number;
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

    // Cost correction multiplier from environment
    const costMultiplier = getCostMultiplier();

    // Get all stats in one query
    const [stats] = await pool.execute<StatsRow[]>(`
      SELECT
        (SELECT COUNT(*) FROM conversations WHERE project_id = ?) as totalConversations,
        (SELECT COUNT(*) FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.project_id = ? AND m.role = 'model' AND m.image_url IS NOT NULL AND m.image_url != '') as totalImages,
        (SELECT COUNT(*) FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.project_id = ? AND m.role = 'model' AND m.video_url IS NOT NULL AND m.video_url != '') as totalVideos,
        (SELECT COUNT(*) FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.project_id = ? AND m.role = 'model' AND m.music_url IS NOT NULL AND m.music_url != '') as totalMusic,
        (SELECT COUNT(*) FROM project_users WHERE project_id = ?) as activeUsers,
        (SELECT COALESCE(SUM(m.tokens_input), 0) FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.project_id = ?) as totalTokensInput,
        (SELECT COALESCE(SUM(m.tokens_output), 0) FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.project_id = ?) as totalTokensOutput,
        (SELECT COALESCE(SUM(total_estimated_cost), 0) FROM conversations WHERE project_id = ?) as totalEstimatedCost
    `, [projectId, projectId, projectId, projectId, projectId, projectId, projectId, projectId]);

    const result = stats[0] || {
      totalConversations: 0,
      totalImages: 0,
      totalVideos: 0,
      totalMusic: 0,
      activeUsers: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      totalEstimatedCost: 0,
    };

    // Apply cost correction multiplier
    result.totalEstimatedCost = Number(result.totalEstimatedCost) * costMultiplier;

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching project stats:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
