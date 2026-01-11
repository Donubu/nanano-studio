import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getCostMultiplier, getMonthlyBaseCost } from "@/lib/cost-calculator";

interface DailyStatsRow extends RowDataPacket {
  date: string;
  tokens_input: number;
  tokens_output: number;
  estimated_cost: number;
  image_count: number;
  video_count: number;
  message_count: number;
}

interface ModelBreakdownRow extends RowDataPacket {
  model_id: number;
  model_name: string;
  tokens_input: number;
  tokens_output: number;
  estimated_cost: number;
  image_count: number;
  video_count: number;
  message_count: number;
}

interface UserBreakdownRow extends RowDataPacket {
  user_id: number;
  user_name: string;
  user_email: string;
  tokens_input: number;
  tokens_output: number;
  estimated_cost: number;
  image_count: number;
  video_count: number;
  conversation_count: number;
}

interface ProjectBreakdownRow extends RowDataPacket {
  project_id: number;
  project_name: string;
  tokens_input: number;
  tokens_output: number;
  estimated_cost: number;
  image_count: number;
  video_count: number;
  conversation_count: number;
}

interface PeriodSummaryRow extends RowDataPacket {
  tokens_input: number;
  tokens_output: number;
  estimated_cost: number;
  image_count: number;
  video_count: number;
  message_count: number;
  conversation_count: number;
}

interface TopazCreditsRow extends RowDataPacket {
  topaz_image_credits: number;
  topaz_video_credits: number;
}

// GET - Get analytics data (admin only)
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "30"; // 7, 30, 90, all
    const projectId = searchParams.get("project_id");

    // Build date filter
    let dateFilter = "";
    let dateFilterConv = "";
    if (period !== "all") {
      const days = parseInt(period);
      dateFilter = `AND m.created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`;
      dateFilterConv = `AND c.created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`;
    }

    // Project filter
    let projectFilter = "";
    let projectFilterConv = "";
    if (projectId) {
      projectFilter = `AND c.project_id = ${parseInt(projectId)}`;
      projectFilterConv = `AND c.project_id = ${parseInt(projectId)}`;
    }

    // 1. Daily stats for chart
    const [dailyStats] = await pool.execute<DailyStatsRow[]>(`
      SELECT
        DATE(m.created_at) as date,
        COALESCE(SUM(m.tokens_input), 0) as tokens_input,
        COALESCE(SUM(m.tokens_output), 0) as tokens_output,
        COALESCE(SUM(m.estimated_cost), 0) as estimated_cost,
        SUM(CASE WHEN m.image_url IS NOT NULL AND m.image_url != '' THEN 1 ELSE 0 END) as image_count,
        SUM(CASE WHEN m.video_url IS NOT NULL AND m.video_url != '' THEN 1 ELSE 0 END) as video_count,
        COUNT(*) as message_count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.role = 'model'
        ${dateFilter}
        ${projectFilter}
      GROUP BY DATE(m.created_at)
      ORDER BY date ASC
    `);

    // 2. Model breakdown
    const [modelBreakdown] = await pool.execute<ModelBreakdownRow[]>(`
      SELECT
        mo.id as model_id,
        mo.display_name as model_name,
        COALESCE(SUM(m.tokens_input), 0) as tokens_input,
        COALESCE(SUM(m.tokens_output), 0) as tokens_output,
        COALESCE(SUM(m.estimated_cost), 0) as estimated_cost,
        SUM(CASE WHEN m.image_url IS NOT NULL AND m.image_url != '' THEN 1 ELSE 0 END) as image_count,
        SUM(CASE WHEN m.video_url IS NOT NULL AND m.video_url != '' THEN 1 ELSE 0 END) as video_count,
        COUNT(*) as message_count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      JOIN models mo ON c.model_id = mo.id
      WHERE m.role = 'model'
        ${dateFilter}
        ${projectFilter}
      GROUP BY mo.id, mo.display_name
      ORDER BY estimated_cost DESC
    `);

    // 3. User breakdown (top 10)
    const [userBreakdown] = await pool.execute<UserBreakdownRow[]>(`
      SELECT
        u.id as user_id,
        u.name as user_name,
        u.email as user_email,
        COALESCE(SUM(m.tokens_input), 0) as tokens_input,
        COALESCE(SUM(m.tokens_output), 0) as tokens_output,
        COALESCE(SUM(m.estimated_cost), 0) as estimated_cost,
        SUM(CASE WHEN m.image_url IS NOT NULL AND m.image_url != '' THEN 1 ELSE 0 END) as image_count,
        SUM(CASE WHEN m.video_url IS NOT NULL AND m.video_url != '' THEN 1 ELSE 0 END) as video_count,
        COUNT(DISTINCT c.id) as conversation_count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      JOIN users u ON c.user_id = u.id
      WHERE m.role = 'model'
        ${dateFilter}
        ${projectFilter}
      GROUP BY u.id, u.name, u.email
      ORDER BY estimated_cost DESC
      LIMIT 10
    `);

    // 4. Project breakdown
    const [projectBreakdown] = await pool.execute<ProjectBreakdownRow[]>(`
      SELECT
        p.id as project_id,
        p.title as project_name,
        COALESCE(SUM(m.tokens_input), 0) as tokens_input,
        COALESCE(SUM(m.tokens_output), 0) as tokens_output,
        COALESCE(SUM(m.estimated_cost), 0) as estimated_cost,
        SUM(CASE WHEN m.image_url IS NOT NULL AND m.image_url != '' THEN 1 ELSE 0 END) as image_count,
        SUM(CASE WHEN m.video_url IS NOT NULL AND m.video_url != '' THEN 1 ELSE 0 END) as video_count,
        COUNT(DISTINCT c.id) as conversation_count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN projects p ON c.project_id = p.id
      WHERE m.role = 'model'
        ${dateFilter}
        ${projectFilter}
      GROUP BY p.id, p.title
      ORDER BY estimated_cost DESC
    `);

    // 5. Period summaries (7d, 30d, all)
    const getSummary = async (days: number | null): Promise<PeriodSummaryRow> => {
      const filter = days ? `AND m.created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)` : "";
      const filterConv = days ? `AND c.created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)` : "";

      const [rows] = await pool.execute<PeriodSummaryRow[]>(`
        SELECT
          COALESCE(SUM(m.tokens_input), 0) as tokens_input,
          COALESCE(SUM(m.tokens_output), 0) as tokens_output,
          COALESCE(SUM(m.estimated_cost), 0) as estimated_cost,
          SUM(CASE WHEN m.image_url IS NOT NULL AND m.image_url != '' THEN 1 ELSE 0 END) as image_count,
          SUM(CASE WHEN m.video_url IS NOT NULL AND m.video_url != '' THEN 1 ELSE 0 END) as video_count,
          COUNT(*) as message_count,
          COUNT(DISTINCT c.id) as conversation_count
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE m.role = 'model'
            ${filter}
          ${projectFilter}
      `);

      return rows[0];
    };

    const [summary7d, summary30d, summaryAll] = await Promise.all([
      getSummary(7),
      getSummary(30),
      getSummary(null),
    ]);

    // 6. Hourly distribution (for activity heatmap)
    const [hourlyDistribution] = await pool.execute<RowDataPacket[]>(`
      SELECT
        HOUR(m.created_at) as hour,
        DAYOFWEEK(m.created_at) as day_of_week,
        COUNT(*) as count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.role = 'model'
        ${dateFilter}
        ${projectFilter}
      GROUP BY HOUR(m.created_at), DAYOFWEEK(m.created_at)
    `);

    // 7. Generation types breakdown
    const [generationTypes] = await pool.execute<RowDataPacket[]>(`
      SELECT
        CASE
          WHEN m.video_url IS NOT NULL AND m.video_url != '' THEN 'video'
          WHEN m.image_url IS NOT NULL AND m.image_url != '' THEN 'image'
          ELSE 'text'
        END as type,
        COUNT(*) as count,
        COALESCE(SUM(m.estimated_cost), 0) as cost
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.role = 'model'
        ${dateFilter}
        ${projectFilter}
      GROUP BY type
    `);

    // 8. Topaz credits (separate query for each period)
    const getTopazCredits = async (days: number | null): Promise<{ imageCredits: number; videoCredits: number }> => {
      const imageFilter = days ? `WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)` : "";
      const videoFilter = days ? `AND created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)` : "";

      const [imageRows] = await pool.execute<TopazCreditsRow[]>(`
        SELECT COALESCE(SUM(credits_consumed), 0) as topaz_image_credits
        FROM topaz_edits
        ${imageFilter}
      `);

      const [videoRows] = await pool.execute<TopazCreditsRow[]>(`
        SELECT COALESCE(SUM(credits_consumed), 0) as topaz_video_credits
        FROM topaz_video_edits
        WHERE status = 'completed' ${videoFilter}
      `);

      return {
        imageCredits: Number(imageRows[0]?.topaz_image_credits || 0),
        videoCredits: Number(videoRows[0]?.topaz_video_credits || 0),
      };
    };

    const [topaz7d, topaz30d, topazAll] = await Promise.all([
      getTopazCredits(7),
      getTopazCredits(30),
      getTopazCredits(null),
    ]);

    // Cost corrections from environment
    const costMultiplier = getCostMultiplier();
    const monthlyBaseCost = getMonthlyBaseCost();

    return NextResponse.json({
      dailyStats: dailyStats.map(row => ({
        date: row.date,
        tokensInput: Number(row.tokens_input),
        tokensOutput: Number(row.tokens_output),
        totalTokens: Number(row.tokens_input) + Number(row.tokens_output),
        estimatedCost: Number(row.estimated_cost) * costMultiplier,
        imageCount: Number(row.image_count),
        videoCount: Number(row.video_count),
        messageCount: Number(row.message_count),
      })),
      modelBreakdown: modelBreakdown.map(row => ({
        modelId: row.model_id,
        modelName: row.model_name,
        tokensInput: Number(row.tokens_input),
        tokensOutput: Number(row.tokens_output),
        estimatedCost: Number(row.estimated_cost) * costMultiplier,
        imageCount: Number(row.image_count),
        videoCount: Number(row.video_count),
        messageCount: Number(row.message_count),
      })),
      userBreakdown: userBreakdown.map(row => ({
        userId: row.user_id,
        userName: row.user_name || row.user_email,
        tokensInput: Number(row.tokens_input),
        tokensOutput: Number(row.tokens_output),
        estimatedCost: Number(row.estimated_cost) * costMultiplier,
        imageCount: Number(row.image_count),
        videoCount: Number(row.video_count),
        conversationCount: Number(row.conversation_count),
      })),
      projectBreakdown: projectBreakdown.map(row => ({
        projectId: row.project_id,
        projectName: row.project_name || "Sin proyecto",
        tokensInput: Number(row.tokens_input),
        tokensOutput: Number(row.tokens_output),
        estimatedCost: Number(row.estimated_cost) * costMultiplier,
        imageCount: Number(row.image_count),
        videoCount: Number(row.video_count),
        conversationCount: Number(row.conversation_count),
      })),
      summaries: {
        "7d": {
          tokensInput: Number(summary7d.tokens_input),
          tokensOutput: Number(summary7d.tokens_output),
          totalTokens: Number(summary7d.tokens_input) + Number(summary7d.tokens_output),
          estimatedCost: (Number(summary7d.estimated_cost) * costMultiplier) + monthlyBaseCost,
          imageCount: Number(summary7d.image_count),
          videoCount: Number(summary7d.video_count),
          messageCount: Number(summary7d.message_count),
          conversationCount: Number(summary7d.conversation_count),
          topazImageCredits: topaz7d.imageCredits,
          topazVideoCredits: topaz7d.videoCredits,
        },
        "30d": {
          tokensInput: Number(summary30d.tokens_input),
          tokensOutput: Number(summary30d.tokens_output),
          totalTokens: Number(summary30d.tokens_input) + Number(summary30d.tokens_output),
          estimatedCost: (Number(summary30d.estimated_cost) * costMultiplier) + monthlyBaseCost,
          imageCount: Number(summary30d.image_count),
          videoCount: Number(summary30d.video_count),
          messageCount: Number(summary30d.message_count),
          conversationCount: Number(summary30d.conversation_count),
          topazImageCredits: topaz30d.imageCredits,
          topazVideoCredits: topaz30d.videoCredits,
        },
        "all": {
          tokensInput: Number(summaryAll.tokens_input),
          tokensOutput: Number(summaryAll.tokens_output),
          totalTokens: Number(summaryAll.tokens_input) + Number(summaryAll.tokens_output),
          estimatedCost: (Number(summaryAll.estimated_cost) * costMultiplier) + monthlyBaseCost,
          imageCount: Number(summaryAll.image_count),
          videoCount: Number(summaryAll.video_count),
          messageCount: Number(summaryAll.message_count),
          conversationCount: Number(summaryAll.conversation_count),
          topazImageCredits: topazAll.imageCredits,
          topazVideoCredits: topazAll.videoCredits,
        },
      },
      hourlyDistribution: hourlyDistribution.map(row => ({
        hour: row.hour,
        dayOfWeek: row.day_of_week,
        count: Number(row.count),
      })),
      generationTypes: generationTypes.map(row => ({
        type: row.type,
        count: Number(row.count),
        cost: Number(row.cost) * costMultiplier,
      })),
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
