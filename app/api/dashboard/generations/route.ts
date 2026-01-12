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

interface TopazImageEditRow extends RowDataPacket {
  id: number;
  message_id: number;
  original_url: string;
  result_url: string;
  model: string;
  scale_factor: number;
  input_width: number;
  input_height: number;
  output_width: number;
  output_height: number;
  credits_consumed: number;
  output_file_size: number | null;
  created_at: string;
  // Joined fields
  conversation_id: number;
  conversation_title: string;
  project_id: number | null;
  project_name: string | null;
  client_id: number | null;
  client_name: string | null;
  user_id: number;
  user_name: string;
  user_email: string;
}

interface TopazVideoEditRow extends RowDataPacket {
  id: number;
  message_id: number;
  original_url: string;
  result_url: string | null;
  model: string;
  model_name: string;
  input_duration: number;
  input_width: number | null;
  input_height: number | null;
  output_width: number | null;
  output_height: number | null;
  output_file_size: number | null;
  credits_consumed: number | null;
  status: string;
  created_at: string;
  // Joined fields
  conversation_id: number;
  conversation_title: string;
  project_id: number | null;
  project_name: string | null;
  client_id: number | null;
  client_name: string | null;
  user_id: number;
  user_name: string;
  user_email: string;
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
    const type = searchParams.get("type"); // "image", "video", "audio", "text", "topaz_image", "topaz_video", or null for all
    const projectId = searchParams.get("project_id");
    const clientId = searchParams.get("client_id");
    const userId = searchParams.get("user_id");
    const search = searchParams.get("search")?.trim() || "";
    const dateFrom = searchParams.get("from");
    const dateTo = searchParams.get("to");
    const includeDeleted = searchParams.get("include_deleted") === "true";
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
    const offset = Number(searchParams.get("offset")) || 0;

    // Handle Topaz types separately
    if (type === "topaz_image" || type === "topaz_video") {
      return await handleTopazGenerations(type, projectId, clientId, search, dateFrom, dateTo, limit, offset);
    }

    // For "all" type, include Topaz generations
    if (!type || type === "all") {
      return await handleAllGenerations(projectId, clientId, userId, search, dateFrom, dateTo, includeDeleted, limit, offset);
    }

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

    // Get Topaz totals
    const [topazImageTotals] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) as count, COALESCE(SUM(credits_consumed), 0) as credits FROM topaz_edits"
    );
    const [topazVideoTotals] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) as count, COALESCE(SUM(credits_consumed), 0) as credits FROM topaz_video_edits WHERE status = 'completed'"
    );

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
        topaz_image_count: Number(topazImageTotals[0]?.count) || 0,
        topaz_video_count: Number(topazVideoTotals[0]?.count) || 0,
        topaz_image_credits: Number(topazImageTotals[0]?.credits) || 0,
        topaz_video_credits: Number(topazVideoTotals[0]?.credits) || 0,
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

// Handle Topaz generations separately
async function handleTopazGenerations(
  type: "topaz_image" | "topaz_video",
  projectId: string | null,
  clientId: string | null,
  search: string,
  dateFrom: string | null,
  dateTo: string | null,
  limit: number,
  offset: number
) {
  if (type === "topaz_image") {
    // Build conditions for topaz_edits
    const conditions: string[] = [];
    const queryParams: (string | number)[] = [];

    if (projectId) {
      conditions.push("p.id = ?");
      queryParams.push(projectId);
    }
    if (clientId) {
      conditions.push("cl.id = ?");
      queryParams.push(clientId);
    }
    if (search) {
      conditions.push("(c.title LIKE ? OR u.name LIKE ? OR te.model LIKE ?)");
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (dateFrom) {
      conditions.push("te.created_at >= ?");
      queryParams.push(dateFrom);
    }
    if (dateTo) {
      conditions.push("te.created_at <= ?");
      queryParams.push(dateTo + " 23:59:59");
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count query
    const [countResult] = await pool.execute<RowDataPacket[]>(`
      SELECT COUNT(*) as total
      FROM topaz_edits te
      JOIN messages m ON te.message_id = m.id
      JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN clients cl ON p.client_id = cl.id
      LEFT JOIN users u ON c.user_id = u.id
      ${whereClause}
    `, queryParams);

    const total = countResult[0]?.total || 0;

    // Main query
    const [rows] = await pool.execute<TopazImageEditRow[]>(`
      SELECT
        te.id,
        te.message_id,
        te.original_url,
        te.result_url,
        te.model,
        te.scale_factor,
        te.input_width,
        te.input_height,
        te.output_width,
        te.output_height,
        te.credits_consumed,
        te.output_file_size,
        te.created_at,
        c.id as conversation_id,
        c.title as conversation_title,
        p.id as project_id,
        p.title as project_name,
        cl.id as client_id,
        cl.name as client_name,
        u.id as user_id,
        u.name as user_name,
        u.email as user_email
      FROM topaz_edits te
      JOIN messages m ON te.message_id = m.id
      JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN clients cl ON p.client_id = cl.id
      LEFT JOIN users u ON c.user_id = u.id
      ${whereClause}
      ORDER BY te.created_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, limit, offset]);

    // Get totals
    const [totalsResult] = await pool.execute<RowDataPacket[]>(`
      SELECT COUNT(*) as count, COALESCE(SUM(te.credits_consumed), 0) as credits
      FROM topaz_edits te
      JOIN messages m ON te.message_id = m.id
      JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN clients cl ON p.client_id = cl.id
      ${whereClause}
    `, queryParams);

    // Get filters
    const [projects] = await pool.execute<ProjectRow[]>(
      "SELECT id, title FROM projects WHERE status = 'active' ORDER BY title"
    );
    const [clients] = await pool.execute<ClientRow[]>(
      "SELECT id, name FROM clients ORDER BY name"
    );

    return NextResponse.json({
      data: rows.map(row => ({
        id: row.id,
        type: "topaz_image" as const,
        conversation_id: row.conversation_id,
        conversation_title: row.conversation_title,
        project_id: row.project_id,
        project_name: row.project_name,
        client_id: row.client_id,
        client_name: row.client_name,
        user_id: row.user_id,
        user_name: row.user_name,
        user_email: row.user_email,
        model_name: `Topaz ${row.model}`,
        original_url: row.original_url,
        result_url: row.result_url,
        input_width: row.input_width,
        input_height: row.input_height,
        output_width: row.output_width,
        output_height: row.output_height,
        scale_factor: row.scale_factor,
        credits_consumed: row.credits_consumed,
        output_file_size: row.output_file_size,
        created_at: row.created_at,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      },
      totals: {
        topaz_image_count: Number(totalsResult[0]?.count) || 0,
        topaz_image_credits: Number(totalsResult[0]?.credits) || 0,
      },
      filters: {
        projects: projects.map(p => ({ id: p.id, name: p.title })),
        clients,
      },
    });
  } else {
    // topaz_video
    const conditions: string[] = ["tve.status = 'completed'"];
    const queryParams: (string | number)[] = [];

    if (projectId) {
      conditions.push("p.id = ?");
      queryParams.push(projectId);
    }
    if (clientId) {
      conditions.push("cl.id = ?");
      queryParams.push(clientId);
    }
    if (search) {
      conditions.push("(c.title LIKE ? OR u.name LIKE ? OR tve.model_name LIKE ?)");
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (dateFrom) {
      conditions.push("tve.created_at >= ?");
      queryParams.push(dateFrom);
    }
    if (dateTo) {
      conditions.push("tve.created_at <= ?");
      queryParams.push(dateTo + " 23:59:59");
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    // Count query
    const [countResult] = await pool.execute<RowDataPacket[]>(`
      SELECT COUNT(*) as total
      FROM topaz_video_edits tve
      JOIN messages m ON tve.message_id = m.id
      JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN clients cl ON p.client_id = cl.id
      LEFT JOIN users u ON c.user_id = u.id
      ${whereClause}
    `, queryParams);

    const total = countResult[0]?.total || 0;

    // Main query
    const [rows] = await pool.execute<TopazVideoEditRow[]>(`
      SELECT
        tve.id,
        tve.message_id,
        tve.original_url,
        tve.result_url,
        tve.model,
        tve.model_name,
        tve.input_duration,
        tve.input_width,
        tve.input_height,
        tve.output_width,
        tve.output_height,
        tve.output_file_size,
        tve.credits_consumed,
        tve.status,
        tve.created_at,
        c.id as conversation_id,
        c.title as conversation_title,
        p.id as project_id,
        p.title as project_name,
        cl.id as client_id,
        cl.name as client_name,
        u.id as user_id,
        u.name as user_name,
        u.email as user_email
      FROM topaz_video_edits tve
      JOIN messages m ON tve.message_id = m.id
      JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN clients cl ON p.client_id = cl.id
      LEFT JOIN users u ON c.user_id = u.id
      ${whereClause}
      ORDER BY tve.created_at DESC
      LIMIT ? OFFSET ?
    `, [...queryParams, limit, offset]);

    // Get totals
    const [totalsResult] = await pool.execute<RowDataPacket[]>(`
      SELECT COUNT(*) as count, COALESCE(SUM(tve.credits_consumed), 0) as credits
      FROM topaz_video_edits tve
      JOIN messages m ON tve.message_id = m.id
      JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN clients cl ON p.client_id = cl.id
      ${whereClause}
    `, queryParams);

    // Get filters
    const [projects] = await pool.execute<ProjectRow[]>(
      "SELECT id, title FROM projects WHERE status = 'active' ORDER BY title"
    );
    const [clients] = await pool.execute<ClientRow[]>(
      "SELECT id, name FROM clients ORDER BY name"
    );

    return NextResponse.json({
      data: rows.map(row => ({
        id: row.id,
        type: "topaz_video" as const,
        conversation_id: row.conversation_id,
        conversation_title: row.conversation_title,
        project_id: row.project_id,
        project_name: row.project_name,
        client_id: row.client_id,
        client_name: row.client_name,
        user_id: row.user_id,
        user_name: row.user_name,
        user_email: row.user_email,
        model_name: `Topaz ${row.model_name}`,
        original_url: row.original_url,
        result_url: row.result_url,
        input_width: row.input_width,
        input_height: row.input_height,
        output_width: row.output_width,
        output_height: row.output_height,
        input_duration: row.input_duration,
        credits_consumed: row.credits_consumed,
        output_file_size: row.output_file_size,
        created_at: row.created_at,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      },
      totals: {
        topaz_video_count: Number(totalsResult[0]?.count) || 0,
        topaz_video_credits: Number(totalsResult[0]?.credits) || 0,
      },
      filters: {
        projects: projects.map(p => ({ id: p.id, name: p.title })),
        clients,
      },
    });
  }
}

// Handle all generations including Topaz
async function handleAllGenerations(
  projectId: string | null,
  clientId: string | null,
  userId: string | null,
  search: string,
  dateFrom: string | null,
  dateTo: string | null,
  includeDeleted: boolean,
  limit: number,
  offset: number
) {
  const costMultiplier = getCostMultiplier();
  const monthlyBaseCost = getMonthlyBaseCost();

  // Build conditions for messages
  const msgConditions: string[] = ["m.role = 'model'"];
  const msgParams: (string | number)[] = [];

  if (projectId) {
    msgConditions.push("c.project_id = ?");
    msgParams.push(projectId);
  }
  if (clientId) {
    msgConditions.push("p.client_id = ?");
    msgParams.push(clientId);
  }
  if (userId) {
    msgConditions.push("c.user_id = ?");
    msgParams.push(userId);
  }
  if (!includeDeleted) {
    msgConditions.push("m.deleted_at IS NULL");
  }
  if (search) {
    msgConditions.push("(c.title LIKE ? OR m.content LIKE ? OR u.name LIKE ?)");
    msgParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (dateFrom) {
    msgConditions.push("m.created_at >= ?");
    msgParams.push(dateFrom);
  }
  if (dateTo) {
    msgConditions.push("m.created_at <= ?");
    msgParams.push(dateTo + " 23:59:59");
  }

  // Build conditions for Topaz
  const topazConditions: string[] = [];
  const topazParams: (string | number)[] = [];

  if (projectId) {
    topazConditions.push("p.id = ?");
    topazParams.push(projectId);
  }
  if (clientId) {
    topazConditions.push("cl.id = ?");
    topazParams.push(clientId);
  }
  if (search) {
    topazConditions.push("(c.title LIKE ? OR u.name LIKE ?)");
    topazParams.push(`%${search}%`, `%${search}%`);
  }

  const topazWhereClause = topazConditions.length > 0 ? `AND ${topazConditions.join(" AND ")}` : "";

  // Get counts for pagination
  const [msgCountResult] = await pool.execute<RowDataPacket[]>(`
    SELECT COUNT(*) as total
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN clients cl ON p.client_id = cl.id
    LEFT JOIN users u ON c.user_id = u.id
    WHERE ${msgConditions.join(" AND ")}
  `, msgParams);

  const [topazImgCountResult] = await pool.execute<RowDataPacket[]>(`
    SELECT COUNT(*) as total
    FROM topaz_edits te
    JOIN messages m ON te.message_id = m.id
    JOIN conversations c ON m.conversation_id = c.id
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN clients cl ON p.client_id = cl.id
    LEFT JOIN users u ON c.user_id = u.id
    WHERE 1=1 ${topazWhereClause}
  `, topazParams);

  const [topazVidCountResult] = await pool.execute<RowDataPacket[]>(`
    SELECT COUNT(*) as total
    FROM topaz_video_edits tve
    JOIN messages m ON tve.message_id = m.id
    JOIN conversations c ON m.conversation_id = c.id
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN clients cl ON p.client_id = cl.id
    LEFT JOIN users u ON c.user_id = u.id
    WHERE tve.status = 'completed' ${topazWhereClause}
  `, topazParams);

  const totalMessages = Number(msgCountResult[0]?.total) || 0;
  const totalTopazImg = Number(topazImgCountResult[0]?.total) || 0;
  const totalTopazVid = Number(topazVidCountResult[0]?.total) || 0;
  const grandTotal = totalMessages + totalTopazImg + totalTopazVid;

  // Fetch all data and combine (limited to reasonable amount for sorting)
  const fetchLimit = Math.min(offset + limit + 100, 500); // Fetch enough for offset + limit

  // Fetch messages
  const [messages] = await pool.execute<GenerationRow[]>(`
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
    WHERE ${msgConditions.join(" AND ")}
    ORDER BY m.created_at DESC
    LIMIT ?
  `, [...msgParams, fetchLimit]);

  // Fetch Topaz image edits
  const [topazImages] = await pool.execute<TopazImageEditRow[]>(`
    SELECT
      te.id,
      te.message_id,
      te.original_url,
      te.result_url,
      te.model,
      te.scale_factor,
      te.input_width,
      te.input_height,
      te.output_width,
      te.output_height,
      te.credits_consumed,
      te.output_file_size,
      te.created_at,
      c.id as conversation_id,
      c.title as conversation_title,
      p.id as project_id,
      p.title as project_name,
      cl.id as client_id,
      cl.name as client_name,
      u.id as user_id,
      u.name as user_name,
      u.email as user_email
    FROM topaz_edits te
    JOIN messages m ON te.message_id = m.id
    JOIN conversations c ON m.conversation_id = c.id
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN clients cl ON p.client_id = cl.id
    LEFT JOIN users u ON c.user_id = u.id
    WHERE 1=1 ${topazWhereClause}
    ORDER BY te.created_at DESC
    LIMIT ?
  `, [...topazParams, fetchLimit]);

  // Fetch Topaz video edits
  const [topazVideos] = await pool.execute<TopazVideoEditRow[]>(`
    SELECT
      tve.id,
      tve.message_id,
      tve.original_url,
      tve.result_url,
      tve.model,
      tve.model_name,
      tve.input_duration,
      tve.input_width,
      tve.input_height,
      tve.output_width,
      tve.output_height,
      tve.output_file_size,
      tve.credits_consumed,
      tve.status,
      tve.created_at,
      c.id as conversation_id,
      c.title as conversation_title,
      p.id as project_id,
      p.title as project_name,
      cl.id as client_id,
      cl.name as client_name,
      u.id as user_id,
      u.name as user_name,
      u.email as user_email
    FROM topaz_video_edits tve
    JOIN messages m ON tve.message_id = m.id
    JOIN conversations c ON m.conversation_id = c.id
    LEFT JOIN projects p ON c.project_id = p.id
    LEFT JOIN clients cl ON p.client_id = cl.id
    LEFT JOIN users u ON c.user_id = u.id
    WHERE tve.status = 'completed' ${topazWhereClause}
    ORDER BY tve.created_at DESC
    LIMIT ?
  `, [...topazParams, fetchLimit]);

  // Transform and combine all results
  type CombinedGeneration = {
    id: number;
    type: "image" | "video" | "audio" | "text" | "topaz_image" | "topaz_video";
    conversation_id: number;
    conversation_title: string;
    project_id: number | null;
    project_name: string | null;
    client_id: number | null;
    client_name: string | null;
    user_id: number;
    user_name: string;
    user_email: string;
    model_name: string | null;
    tokens_input: number;
    tokens_output: number;
    estimated_cost: number;
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
    // Topaz fields
    original_url?: string;
    result_url?: string;
    input_width?: number;
    input_height?: number;
    output_width?: number;
    output_height?: number;
    scale_factor?: number;
    input_duration?: number;
    credits_consumed?: number;
    output_file_size?: number;
    quality_tier?: "normal" | "hq" | null;
  };

  const combined: CombinedGeneration[] = [];

  // Add messages
  for (const msg of messages) {
    let generationType: "image" | "video" | "audio" | "text" = "text";
    if (msg.video_url) generationType = "video";
    else if (msg.audio_url) generationType = "audio";
    else if (msg.image_url) generationType = "image";

    combined.push({
      id: msg.id,
      type: generationType,
      conversation_id: msg.conversation_id,
      conversation_title: msg.conversation_title,
      project_id: msg.project_id,
      project_name: msg.project_name,
      client_id: msg.client_id,
      client_name: msg.client_name,
      user_id: msg.user_id,
      user_name: msg.user_name,
      user_email: msg.user_email,
      model_name: msg.model_name,
      tokens_input: msg.tokens_input || 0,
      tokens_output: msg.tokens_output || 0,
      estimated_cost: (msg.estimated_cost || 0) * costMultiplier,
      image_url: msg.image_url,
      image_file_size: msg.image_file_size,
      image_aspect_ratio: msg.image_aspect_ratio,
      video_url: msg.video_url,
      video_file_size: msg.video_file_size,
      video_duration: msg.video_duration,
      audio_url: msg.audio_url,
      audio_file_size: msg.audio_file_size,
      audio_duration: msg.audio_duration,
      created_at: msg.created_at,
      deleted_at: msg.deleted_at,
      quality_tier: msg.quality_tier,
    });
  }

  // Add Topaz images
  for (const ti of topazImages) {
    combined.push({
      id: ti.id,
      type: "topaz_image",
      conversation_id: ti.conversation_id,
      conversation_title: ti.conversation_title,
      project_id: ti.project_id,
      project_name: ti.project_name,
      client_id: ti.client_id,
      client_name: ti.client_name,
      user_id: ti.user_id,
      user_name: ti.user_name,
      user_email: ti.user_email,
      model_name: `Topaz ${ti.model}`,
      tokens_input: 0,
      tokens_output: 0,
      estimated_cost: 0,
      image_url: null,
      image_file_size: null,
      image_aspect_ratio: null,
      video_url: null,
      video_file_size: null,
      video_duration: null,
      audio_url: null,
      audio_file_size: null,
      audio_duration: null,
      created_at: ti.created_at,
      deleted_at: null,
      original_url: ti.original_url,
      result_url: ti.result_url,
      input_width: ti.input_width,
      input_height: ti.input_height,
      output_width: ti.output_width,
      output_height: ti.output_height,
      scale_factor: ti.scale_factor,
      credits_consumed: ti.credits_consumed,
      output_file_size: ti.output_file_size || undefined,
    });
  }

  // Add Topaz videos
  for (const tv of topazVideos) {
    combined.push({
      id: tv.id,
      type: "topaz_video",
      conversation_id: tv.conversation_id,
      conversation_title: tv.conversation_title,
      project_id: tv.project_id,
      project_name: tv.project_name,
      client_id: tv.client_id,
      client_name: tv.client_name,
      user_id: tv.user_id,
      user_name: tv.user_name,
      user_email: tv.user_email,
      model_name: `Topaz ${tv.model_name}`,
      tokens_input: 0,
      tokens_output: 0,
      estimated_cost: 0,
      image_url: null,
      image_file_size: null,
      image_aspect_ratio: null,
      video_url: null,
      video_file_size: null,
      video_duration: null,
      audio_url: null,
      audio_file_size: null,
      audio_duration: null,
      created_at: tv.created_at,
      deleted_at: null,
      original_url: tv.original_url,
      result_url: tv.result_url || undefined,
      input_width: tv.input_width || undefined,
      input_height: tv.input_height || undefined,
      output_width: tv.output_width || undefined,
      output_height: tv.output_height || undefined,
      input_duration: tv.input_duration,
      credits_consumed: tv.credits_consumed || undefined,
      output_file_size: tv.output_file_size || undefined,
    });
  }

  // Sort by created_at DESC
  combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Apply pagination
  const paginatedData = combined.slice(offset, offset + limit);

  // Get totals
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
    WHERE ${msgConditions.join(" AND ")}
  `, msgParams);

  const [topazImageTotals] = await pool.execute<RowDataPacket[]>(
    "SELECT COUNT(*) as count, COALESCE(SUM(credits_consumed), 0) as credits FROM topaz_edits"
  );
  const [topazVideoTotals] = await pool.execute<RowDataPacket[]>(
    "SELECT COUNT(*) as count, COALESCE(SUM(credits_consumed), 0) as credits FROM topaz_video_edits WHERE status = 'completed'"
  );

  const totals = totalsResult[0] || {};

  // Get filters
  const [projects] = await pool.execute<ProjectRow[]>(
    "SELECT id, title FROM projects WHERE status = 'active' ORDER BY title"
  );
  const [clients] = await pool.execute<ClientRow[]>(
    "SELECT id, name FROM clients ORDER BY name"
  );

  return NextResponse.json({
    data: paginatedData,
    pagination: {
      total: grandTotal,
      limit,
      offset,
      hasMore: offset + paginatedData.length < grandTotal,
    },
    totals: {
      tokens_input: Number(totals.total_tokens_input) || 0,
      tokens_output: Number(totals.total_tokens_output) || 0,
      estimated_cost: ((Number(totals.total_cost) || 0) * costMultiplier) + monthlyBaseCost,
      image_count: Number(totals.image_count) || 0,
      video_count: Number(totals.video_count) || 0,
      audio_count: Number(totals.audio_count) || 0,
      topaz_image_count: Number(topazImageTotals[0]?.count) || 0,
      topaz_video_count: Number(topazVideoTotals[0]?.count) || 0,
      topaz_image_credits: Number(topazImageTotals[0]?.credits) || 0,
      topaz_video_credits: Number(topazVideoTotals[0]?.credits) || 0,
    },
    filters: {
      projects: projects.map(p => ({ id: p.id, name: p.title })),
      clients,
    },
  });
}
