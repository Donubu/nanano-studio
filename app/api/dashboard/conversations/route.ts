import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface ConversationRow extends RowDataPacket {
  id: number;
  title: string;
  generation_type: string;
  project_id: number | null;
  project_title: string | null;
  client_id: number | null;
  client_name: string | null;
  user_id: number;
  user_name: string;
  user_email: string;
  model_display_name: string | null;
  message_count: number;
  asset_count: number;
  estimated_cost: number;
  created_at: string;
  updated_at: string;
}

interface FilterOption extends RowDataPacket {
  id: number;
  name: string;
}

interface CountRow extends RowDataPacket {
  total: number;
}

// GET - List all conversations for admin dashboard with pagination, filters, and stats
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const projectFilter = searchParams.get("project_id") || "";
    const clientFilter = searchParams.get("client_id") || "";
    const typeFilter = searchParams.get("type") || "";
    const userFilter = searchParams.get("user_id") || "";
    const includeDeleted = searchParams.get("include_deleted") === "true";
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Build WHERE conditions
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (!includeDeleted) {
      conditions.push("c.deleted_at IS NULL");
    }

    if (search) {
      conditions.push("(c.title LIKE ? OR u.name LIKE ? OR u.email LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (projectFilter) {
      conditions.push("c.project_id = ?");
      params.push(parseInt(projectFilter));
    }

    if (clientFilter) {
      conditions.push("p.client_id = ?");
      params.push(parseInt(clientFilter));
    }

    if (typeFilter) {
      conditions.push("c.generation_type = ?");
      params.push(typeFilter);
    }

    if (userFilter) {
      conditions.push("c.user_id = ?");
      params.push(parseInt(userFilter));
    }

    const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    // Get conversations with stats
    const query = `
      SELECT
        c.id,
        c.title,
        c.generation_type,
        c.project_id,
        p.title as project_title,
        p.client_id,
        cl.name as client_name,
        c.user_id,
        u.name as user_name,
        u.email as user_email,
        m.display_name as model_display_name,
        c.created_at,
        c.updated_at,
        c.deleted_at,
        (SELECT COUNT(*) FROM messages msg WHERE msg.conversation_id = c.id AND msg.deleted_at IS NULL) as message_count,
        (SELECT COUNT(*) FROM messages msg WHERE msg.conversation_id = c.id AND msg.deleted_at IS NULL AND (msg.image_url IS NOT NULL OR msg.video_url IS NOT NULL OR msg.audio_url IS NOT NULL OR msg.music_url IS NOT NULL)) as asset_count,
        (SELECT COALESCE(SUM(msg.estimated_cost), 0) FROM messages msg WHERE msg.conversation_id = c.id) as estimated_cost
      FROM conversations c
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN clients cl ON p.client_id = cl.id
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN models m ON c.model_id = m.id
      ${whereClause}
      ORDER BY c.updated_at DESC
      LIMIT ? OFFSET ?
    `;

    const queryParams = [...params, Number(limit), Number(offset)];
    const [rows] = await pool.query<ConversationRow[]>(query, queryParams);

    // Count total
    const countQuery = `
      SELECT COUNT(*) as total
      FROM conversations c
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN clients cl ON p.client_id = cl.id
      LEFT JOIN users u ON c.user_id = u.id
      ${whereClause}
    `;
    const [countRows] = await pool.query<CountRow[]>(countQuery, params);
    const total = countRows[0].total;

    // Get filter options
    const [projects] = await pool.execute<FilterOption[]>(
      "SELECT id, title as name FROM projects ORDER BY title"
    );

    const [clients] = await pool.execute<FilterOption[]>(
      "SELECT id, name FROM clients ORDER BY name"
    );

    const [users] = await pool.execute<FilterOption[]>(
      "SELECT id, name FROM users WHERE name IS NOT NULL ORDER BY name"
    );

    return NextResponse.json({
      data: rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
      filters: {
        projects,
        clients,
        users,
      },
    });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
