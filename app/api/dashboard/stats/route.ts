import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface StatsRow extends RowDataPacket {
  totalUsers: number;
  totalProjects: number;
  totalConversations: number;
  totalImages: number;
  totalVideos: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalEstimatedCost: number;
}

// GET - Get global dashboard statistics (admin only)
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    // Cost correction multiplier from environment
    const costMultiplier = parseFloat(process.env.COST_CORRECTION_MULTIPLIER || "1");

    // Get all stats in one query
    const [stats] = await pool.execute<StatsRow[]>(`
      SELECT
        (SELECT COUNT(*) FROM users) as totalUsers,
        (SELECT COUNT(*) FROM projects) as totalProjects,
        (SELECT COUNT(*) FROM conversations) as totalConversations,
        (SELECT COUNT(*) FROM messages WHERE role = 'model' AND image_url IS NOT NULL AND image_url != '') as totalImages,
        (SELECT COUNT(*) FROM messages WHERE role = 'model' AND video_url IS NOT NULL AND video_url != '') as totalVideos,
        (SELECT COALESCE(SUM(tokens_input), 0) FROM messages) as totalTokensInput,
        (SELECT COALESCE(SUM(tokens_output), 0) FROM messages) as totalTokensOutput,
        (SELECT COALESCE(SUM(total_estimated_cost), 0) FROM conversations) as totalEstimatedCost
    `);

    const result = stats[0] || {
      totalUsers: 0,
      totalProjects: 0,
      totalConversations: 0,
      totalImages: 0,
      totalVideos: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      totalEstimatedCost: 0,
    };

    // Apply cost correction multiplier
    result.totalEstimatedCost = Number(result.totalEstimatedCost) * costMultiplier;

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
