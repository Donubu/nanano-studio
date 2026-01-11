import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { applyCostCorrections } from "@/lib/cost-calculator";

interface StatsRow extends RowDataPacket {
  totalUsers: number;
  totalProjects: number;
  totalConversations: number;
  totalImages: number;
  totalVideos: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalEstimatedCost: number;
  topazImageCredits: number;
  topazVideoCredits: number;
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
        (SELECT COALESCE(SUM(total_estimated_cost), 0) FROM conversations) as totalEstimatedCost,
        (SELECT COALESCE(SUM(credits_consumed), 0) FROM topaz_edits) as topazImageCredits,
        (SELECT COALESCE(SUM(credits_consumed), 0) FROM topaz_video_edits WHERE status = 'completed') as topazVideoCredits
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
      topazImageCredits: 0,
      topazVideoCredits: 0,
    };

    // Apply cost corrections (multiplier + monthly base cost for current month)
    result.totalEstimatedCost = applyCostCorrections(Number(result.totalEstimatedCost), true);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
