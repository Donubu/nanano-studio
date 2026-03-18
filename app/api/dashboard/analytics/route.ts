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
  music_count: number;
  audio_count: number;
  audio_hd_count: number;
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
  music_count: number;
  audio_count: number;
  audio_hd_count: number;
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
  music_count: number;
  audio_count: number;
  audio_hd_count: number;
  message_count: number;
  conversation_count: number;
}

interface ProjectBreakdownRow extends RowDataPacket {
  project_id: number;
  project_name: string;
  client_name: string | null;
  tokens_input: number;
  tokens_output: number;
  estimated_cost: number;
  image_count: number;
  video_count: number;
  music_count: number;
  audio_count: number;
  audio_hd_count: number;
  conversation_count: number;
}

interface PeriodSummaryRow extends RowDataPacket {
  tokens_input: number;
  tokens_output: number;
  estimated_cost: number;
  image_count: number;
  video_count: number;
  music_count: number;
  audio_count: number;
  audio_hd_count: number;
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
    const period = searchParams.get("period") || "30"; // 1, 7, 30, 90, all, custom
    const dateFrom = searchParams.get("date_from"); // YYYY-MM-DD (for custom period)
    const dateTo = searchParams.get("date_to"); // YYYY-MM-DD (for custom period)
    const projectId = searchParams.get("project_id");

    // Build date filter
    let dateFilter = "";
    let dateFilterConv = "";
    if (dateFrom && dateTo) {
      dateFilter = `AND m.created_at >= '${dateFrom} 00:00:00' AND m.created_at <= '${dateTo} 23:59:59'`;
      dateFilterConv = `AND c.created_at >= '${dateFrom} 00:00:00' AND c.created_at <= '${dateTo} 23:59:59'`;
    } else if (period === "1") {
      dateFilter = `AND m.created_at >= CURDATE()`;
      dateFilterConv = `AND c.created_at >= CURDATE()`;
    } else if (period === "1") {
      dateFilter = `AND m.created_at >= CURDATE()`;
      dateFilterConv = `AND c.created_at >= CURDATE()`;
    } else if (period !== "all") {
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
        SUM(CASE WHEN m.music_url IS NOT NULL AND m.music_url != '' THEN 1 ELSE 0 END) as music_count,
        SUM(CASE WHEN m.audio_url IS NOT NULL AND m.audio_url != '' AND m.quality_tier != 'chirp' THEN 1 ELSE 0 END) as audio_count,
        SUM(CASE WHEN m.quality_tier = 'chirp' THEN 1 ELSE 0 END) as audio_hd_count,
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
        SUM(CASE WHEN m.music_url IS NOT NULL AND m.music_url != '' THEN 1 ELSE 0 END) as music_count,
        SUM(CASE WHEN m.audio_url IS NOT NULL AND m.audio_url != '' AND m.quality_tier != 'chirp' THEN 1 ELSE 0 END) as audio_count,
        SUM(CASE WHEN m.quality_tier = 'chirp' THEN 1 ELSE 0 END) as audio_hd_count,
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
        SUM(CASE WHEN m.music_url IS NOT NULL AND m.music_url != '' THEN 1 ELSE 0 END) as music_count,
        SUM(CASE WHEN m.audio_url IS NOT NULL AND m.audio_url != '' AND m.quality_tier != 'chirp' THEN 1 ELSE 0 END) as audio_count,
        SUM(CASE WHEN m.quality_tier = 'chirp' THEN 1 ELSE 0 END) as audio_hd_count,
        COUNT(*) as message_count,
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
        cl.name as client_name,
        COALESCE(SUM(m.tokens_input), 0) as tokens_input,
        COALESCE(SUM(m.tokens_output), 0) as tokens_output,
        COALESCE(SUM(m.estimated_cost), 0) as estimated_cost,
        SUM(CASE WHEN m.image_url IS NOT NULL AND m.image_url != '' THEN 1 ELSE 0 END) as image_count,
        SUM(CASE WHEN m.video_url IS NOT NULL AND m.video_url != '' THEN 1 ELSE 0 END) as video_count,
        SUM(CASE WHEN m.music_url IS NOT NULL AND m.music_url != '' THEN 1 ELSE 0 END) as music_count,
        SUM(CASE WHEN m.audio_url IS NOT NULL AND m.audio_url != '' AND m.quality_tier != 'chirp' THEN 1 ELSE 0 END) as audio_count,
        SUM(CASE WHEN m.quality_tier = 'chirp' THEN 1 ELSE 0 END) as audio_hd_count,
        COUNT(DISTINCT c.id) as conversation_count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN clients cl ON p.client_id = cl.id
      WHERE m.role = 'model'
        ${dateFilter}
        ${projectFilter}
      GROUP BY p.id, p.title, cl.name
      ORDER BY estimated_cost DESC
    `);

    // 5. Period summary — uses the same dateFilter as the rest of the page
    const [summaryRows] = await pool.execute<PeriodSummaryRow[]>(`
      SELECT
        COALESCE(SUM(m.tokens_input), 0) as tokens_input,
        COALESCE(SUM(m.tokens_output), 0) as tokens_output,
        COALESCE(SUM(m.estimated_cost), 0) as estimated_cost,
        SUM(CASE WHEN m.image_url IS NOT NULL AND m.image_url != '' THEN 1 ELSE 0 END) as image_count,
        SUM(CASE WHEN m.video_url IS NOT NULL AND m.video_url != '' THEN 1 ELSE 0 END) as video_count,
        SUM(CASE WHEN m.music_url IS NOT NULL AND m.music_url != '' THEN 1 ELSE 0 END) as music_count,
        SUM(CASE WHEN m.audio_url IS NOT NULL AND m.audio_url != '' AND m.quality_tier != 'chirp' THEN 1 ELSE 0 END) as audio_count,
        SUM(CASE WHEN m.quality_tier = 'chirp' THEN 1 ELSE 0 END) as audio_hd_count,
        COUNT(*) as message_count,
        COUNT(DISTINCT c.id) as conversation_count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.role = 'model'
        ${dateFilter}
        ${projectFilter}
    `);
    const currentSummary = summaryRows[0];

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
          WHEN m.music_url IS NOT NULL AND m.music_url != '' THEN 'music'
          WHEN m.video_url IS NOT NULL AND m.video_url != '' THEN 'video'
          WHEN m.image_url IS NOT NULL AND m.image_url != '' THEN 'image'
          WHEN m.quality_tier = 'chirp' THEN 'audio_hd'
          WHEN m.audio_url IS NOT NULL AND m.audio_url != '' THEN 'audio'
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

    // 8. Topaz credits for current period
    let topazDateFilter = "";
    let topazVideoDateFilter = "";
    if (dateFrom && dateTo) {
      topazDateFilter = `WHERE created_at >= '${dateFrom} 00:00:00' AND created_at <= '${dateTo} 23:59:59'`;
      topazVideoDateFilter = `AND created_at >= '${dateFrom} 00:00:00' AND created_at <= '${dateTo} 23:59:59'`;
    } else if (period === "1") {
      topazDateFilter = `WHERE created_at >= CURDATE()`;
      topazVideoDateFilter = `AND created_at >= CURDATE()`;
    } else if (period !== "all") {
      const days = parseInt(period);
      topazDateFilter = `WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`;
      topazVideoDateFilter = `AND created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`;
    }

    const [[topazImageRows], [topazVideoRows]] = await Promise.all([
      pool.execute<TopazCreditsRow[]>(`
        SELECT COALESCE(SUM(credits_consumed), 0) as topaz_image_credits
        FROM topaz_edits
        ${topazDateFilter}
      `),
      pool.execute<TopazCreditsRow[]>(`
        SELECT COALESCE(SUM(credits_consumed), 0) as topaz_video_credits
        FROM topaz_video_edits
        WHERE status = 'completed' ${topazVideoDateFilter}
      `),
    ]);
    const topazCredits = {
      imageCredits: Number((topazImageRows as TopazCreditsRow[])[0]?.topaz_image_credits || 0),
      videoCredits: Number((topazVideoRows as TopazCreditsRow[])[0]?.topaz_video_credits || 0),
    };

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
        musicCount: Number(row.music_count),
        audioCount: Number(row.audio_count),
        audioHdCount: Number(row.audio_hd_count),
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
        musicCount: Number(row.music_count),
        audioCount: Number(row.audio_count),
        audioHdCount: Number(row.audio_hd_count),
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
        musicCount: Number(row.music_count),
        audioCount: Number(row.audio_count),
        audioHdCount: Number(row.audio_hd_count),
        messageCount: Number(row.message_count),
        conversationCount: Number(row.conversation_count),
      })),
      projectBreakdown: projectBreakdown.map(row => ({
        projectId: row.project_id,
        projectName: row.project_name || "Sin proyecto",
        clientName: row.client_name || null,
        tokensInput: Number(row.tokens_input),
        tokensOutput: Number(row.tokens_output),
        estimatedCost: Number(row.estimated_cost) * costMultiplier,
        imageCount: Number(row.image_count),
        videoCount: Number(row.video_count),
        musicCount: Number(row.music_count),
        audioCount: Number(row.audio_count),
        audioHdCount: Number(row.audio_hd_count),
        conversationCount: Number(row.conversation_count),
      })),
      summary: {
        tokensInput: Number(currentSummary.tokens_input),
        tokensOutput: Number(currentSummary.tokens_output),
        totalTokens: Number(currentSummary.tokens_input) + Number(currentSummary.tokens_output),
        estimatedCost: (Number(currentSummary.estimated_cost) * costMultiplier) + monthlyBaseCost,
        imageCount: Number(currentSummary.image_count),
        videoCount: Number(currentSummary.video_count),
        musicCount: Number(currentSummary.music_count),
        audioCount: Number(currentSummary.audio_count),
        audioHdCount: Number(currentSummary.audio_hd_count),
        messageCount: Number(currentSummary.message_count),
        conversationCount: Number(currentSummary.conversation_count),
        topazImageCredits: topazCredits.imageCredits,
        topazVideoCredits: topazCredits.videoCredits,
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
      budgetStats: await (async () => {
        const [rows] = await pool.execute<RowDataPacket[]>(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
            SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
            COALESCE(SUM(total), 0) as total_amount,
            COALESCE(SUM(CASE WHEN status = 'accepted' THEN total ELSE 0 END), 0) as accepted_amount
          FROM budgets
          WHERE deleted_at IS NULL
            ${period !== "all" ? `AND created_at >= DATE_SUB(NOW(), INTERVAL ${parseInt(period)} DAY)` : ""}
        `);
        const r = rows[0];
        return {
          total: Number(r.total),
          draft: Number(r.draft),
          accepted: Number(r.accepted),
          rejected: Number(r.rejected),
          totalAmount: Number(r.total_amount),
          acceptedAmount: Number(r.accepted_amount),
        };
      })(),
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
