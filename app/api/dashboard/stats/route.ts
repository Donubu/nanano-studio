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
  totalMusic: number;
  totalAudio: number;
  totalAudioHd: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalEstimatedCost: number;
  topazImageCredits: number;
  topazVideoCredits: number;
  totalModels: number;
  activeModels: number;
  assignedModels: number;
  totalBudgets: number;
  draftBudgets: number;
  acceptedBudgets: number;
  rejectedBudgets: number;
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
        (SELECT COUNT(*) FROM messages WHERE role = 'model' AND music_url IS NOT NULL AND music_url != '') as totalMusic,
        (SELECT COUNT(*) FROM messages WHERE role = 'model' AND audio_url IS NOT NULL AND audio_url != '' AND quality_tier != 'chirp') as totalAudio,
        (SELECT COUNT(*) FROM messages WHERE role = 'model' AND quality_tier = 'chirp') as totalAudioHd,
        (SELECT COALESCE(SUM(tokens_input), 0) FROM messages) as totalTokensInput,
        (SELECT COALESCE(SUM(tokens_output), 0) FROM messages) as totalTokensOutput,
        (SELECT COALESCE(SUM(total_estimated_cost), 0) FROM conversations) as totalEstimatedCost,
        (SELECT COALESCE(SUM(credits_consumed), 0) FROM topaz_edits) as topazImageCredits,
        (SELECT COALESCE(SUM(credits_consumed), 0) FROM topaz_video_edits WHERE status = 'completed') as topazVideoCredits,
        (SELECT COUNT(*) FROM models) as totalModels,
        (SELECT COUNT(*) FROM models WHERE is_active = 1) as activeModels,
        (SELECT COUNT(DISTINCT model_id) FROM project_generation_models pgm JOIN project_generation_config pgc ON pgc.project_id = pgm.project_id AND pgc.generation_type = pgm.generation_type WHERE pgc.is_enabled = 1) as assignedModels,
        (SELECT COUNT(*) FROM budgets WHERE deleted_at IS NULL) as totalBudgets,
        (SELECT COUNT(*) FROM budgets WHERE deleted_at IS NULL AND status = 'draft') as draftBudgets,
        (SELECT COUNT(*) FROM budgets WHERE deleted_at IS NULL AND status = 'accepted') as acceptedBudgets,
        (SELECT COUNT(*) FROM budgets WHERE deleted_at IS NULL AND status = 'rejected') as rejectedBudgets
    `);

    const result = stats[0] || {
      totalUsers: 0,
      totalProjects: 0,
      totalConversations: 0,
      totalImages: 0,
      totalVideos: 0,
      totalMusic: 0,
      totalAudio: 0,
      totalAudioHd: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      totalEstimatedCost: 0,
      topazImageCredits: 0,
      topazVideoCredits: 0,
      totalModels: 0,
      activeModels: 0,
      assignedModels: 0,
      totalBudgets: 0,
      draftBudgets: 0,
      acceptedBudgets: 0,
      rejectedBudgets: 0,
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
