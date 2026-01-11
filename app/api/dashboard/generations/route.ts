import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { getCostMultiplier, getMonthlyBaseCost } from "@/lib/cost-calculator";

interface GenerationRow extends RowDataPacket {
  id: number;
  conversation_id: number;
  conversation_title: string;
  project_id: number | null;
  project_name: string | null;
  client_id: number | null;
  client_name: string | null;
  user_id: number;
  user_name: string;
  user_email: string;
  model_id: number | null;
  model_name: string | null;
  content: string | null;
  content_type: string;
  quality_tier: "normal" | "hq" | null;
  generation_seed: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  estimated_cost: number | null;
  image_url: string | null;
  image_file_size: number | null;
  image_aspect_ratio: string | null;
  video_url: string | null;
  video_file_size: number | null;
  video_duration: number | null;
  audio_url: string | null;
  audio_file_size: number | null;
  audio_duration: number | null;
  created_at: string;
  deleted_at: string | null;
}

interface ProjectRow extends RowDataPacket {
  id: number;
  title: string;
}

interface ClientRow extends RowDataPacket {
  id: number;
  name: string;
}

// GET - Get all generations across all projects (admin only)
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Only admins can access this endpoint
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);

    // Filter parameters
    const type = searchParams.get("type"); // "image", "video", "audio", "text", or null for all
    const projectId = searchParams.get("project_id");
    const clientId = searchParams.get("client_id");
    const userId = searchParams.get("user_id");
    const search = searchParams.get("search")?.trim() || "";
    const dateFrom = searchParams.get("from");
    const dateTo = searchParams.get("to");
    const includeDeleted = searchParams.get("include_deleted") === "true";
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
    const offset = Number(searchParams.get("offset")) || 0;

    // Build WHERE conditions
    const conditions: string[] = ["m.role = 'model'"];
    const queryParams: (string | number)[] = [];

    // Type filter
    if (type === "image") {
      conditions.push("m.image_url IS NOT NULL AND m.image_url != ''");
    } else if (type === "video") {
      conditions.push("m.video_url IS NOT NULL AND m.video_url != ''");
    } else if (type === "audio") {
      conditions.push("m.audio_url IS NOT NULL AND m.audio_url != ''");
    } else if (type === "text") {
      conditions.push("m.image_url IS NULL AND m.video_url IS NULL AND m.audio_url IS NULL");
    }

    // Project filter
    if (projectId) {
      conditions.push("c.project_id = ?");
      queryParams.push(projectId);
    }

    // Client filter
    if (clientId) {
      conditions.push("p.client_id = ?");
      queryParams.push(clientId);
    }

    // User filter
    if (userId) {
      conditions.push("c.user_id = ?");
      queryParams.push(userId);
    }

    // Soft delete filter
    if (!includeDeleted) {
      conditions.push("m.deleted_at IS NULL");
    }

    // Search filter
    if (search) {
      conditions.push("(c.title LIKE ? OR m.content LIKE ? OR u.name LIKE ?)");
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    // Date range filter
    if (dateFrom) {
      conditions.push("m.created_at >= ?");
      queryParams.push(dateFrom);
    }
    if (dateTo) {
      conditions.push("m.created_at <= ?");
      queryParams.push(dateTo + " 23:59:59");
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN clients cl ON p.client_id = cl.id
      LEFT JOIN users u ON c.user_id = u.id
      WHERE ${conditions.join(" AND ")}
    `;

    const [countResult] = await pool.execute<RowDataPacket[]>(countQuery, queryParams);
    const total = countResult[0]?.total || 0;

    // Main query
    const mainQuery = `
      SELECT
        m.id,
        c.id as conversation_id,
        c.title as conversation_title,
        p.id as project_id,
        p.title as project_name,
        cl.id as client_id,
        cl.name as client_name,
        u.id as user_id,
        u.name as user_name,
        u.email as user_email,
        c.model_id,
        mo.display_name as model_name,
        m.content,
        m.content_type,
        m.quality_tier,
        m.generation_seed,
        m.tokens_input,
        m.tokens_output,
        m.estimated_cost,
        m.image_url,
        m.image_file_size,
        COALESCE(m.image_aspect_ratio, c.image_aspect_ratio) as image_aspect_ratio,
        m.video_url,
        m.video_file_size,
        m.video_duration,
        m.audio_url,
        m.audio_file_size,
        m.audio_duration,
        m.created_at,
        m.deleted_at
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN clients cl ON p.client_id = cl.id
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN models mo ON c.model_id = mo.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const mainQueryParams = [...queryParams, limit, offset];
    const [generations] = await pool.execute<GenerationRow[]>(mainQuery, mainQueryParams);

    // Apply cost corrections
    const costMultiplier = getCostMultiplier();
    const monthlyBaseCost = getMonthlyBaseCost();

    // Determine type for each generation
    const result = generations.map(gen => {
      let generationType: "image" | "video" | "audio" | "text" = "text";
      if (gen.video_url) {
        generationType = "video";
      } else if (gen.audio_url) {
        generationType = "audio";
      } else if (gen.image_url) {
        generationType = "image";
      }

      return {
        ...gen,
        type: generationType,
        tokens_input: gen.tokens_input || 0,
        tokens_output: gen.tokens_output || 0,
        estimated_cost: (gen.estimated_cost || 0) * costMultiplier,
      };
    });

    // Get totals for filters
    const [totalsResult] = await pool.execute<RowDataPacket[]>(`
      SELECT
        SUM(COALESCE(m.tokens_input, 0)) as total_tokens_input,
        SUM(COALESCE(m.tokens_output, 0)) as total_tokens_output,
        SUM(COALESCE(m.estimated_cost, 0)) as total_cost,
        COUNT(CASE WHEN m.image_url IS NOT NULL AND m.image_url != '' THEN 1 END) as image_count,
        COUNT(CASE WHEN m.video_url IS NOT NULL AND m.video_url != '' THEN 1 END) as video_count,
        COUNT(CASE WHEN m.audio_url IS NOT NULL AND m.audio_url != '' THEN 1 END) as audio_count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN clients cl ON p.client_id = cl.id
      LEFT JOIN users u ON c.user_id = u.id
      WHERE ${conditions.join(" AND ")}
    `, queryParams);

    const totals = totalsResult[0] || {};

    // Get available projects for filter dropdown
    const [projects] = await pool.execute<ProjectRow[]>(
      "SELECT id, title FROM projects WHERE status = 'active' ORDER BY title"
    );

    // Get available clients for filter dropdown
    const [clients] = await pool.execute<ClientRow[]>(
      "SELECT id, name FROM clients ORDER BY name"
    );

    return NextResponse.json({
      data: result,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + result.length < total,
      },
      totals: {
        tokens_input: Number(totals.total_tokens_input) || 0,
        tokens_output: Number(totals.total_tokens_output) || 0,
        estimated_cost: ((Number(totals.total_cost) || 0) * costMultiplier) + monthlyBaseCost,
        image_count: Number(totals.image_count) || 0,
        video_count: Number(totals.video_count) || 0,
        audio_count: Number(totals.audio_count) || 0,
      },
      filters: {
        projects: projects.map(p => ({ id: p.id, name: p.title })),
        clients,
      },
    });
  } catch (error) {
    console.error("Error fetching generations:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
