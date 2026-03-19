import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface ProjectRow extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  client_id: number | null;
  client_name: string | null;
  client_logo: string | null;
  status: string;
  hidden: boolean;
  created_at: Date;
  generation_count: number;
  user_count: number;
  estimated_cost: number;
  last_message_at: Date | null;
}

// GET - Listar proyectos
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("client_id");

    const clientFilter = clientId ? "AND p.client_id = ?" : "";
    const clientParams = clientId ? [clientId] : [];

    // Admin ve todos los proyectos, usuarios normales solo los asignados
    // Use conversation-level aggregates instead of scanning all messages
    const genSubquery = `
      SELECT
        conv.project_id,
        SUM(conv.total_estimated_cost) as estimated_cost,
        MAX(conv.updated_at) as last_message_at
      FROM conversations conv
      WHERE conv.deleted_at IS NULL
      GROUP BY conv.project_id
    `;
    const ucSubquery = `
      SELECT project_id, COUNT(*) as user_count
      FROM project_users
      GROUP BY project_id
    `;

    const hiddenFilter = session.user.role === "admin" ? "" : "AND p.hidden = 0";

    const [rows] = await pool.execute<ProjectRow[]>(`
      SELECT
        p.id, p.title, p.description, p.client_id, p.status, p.hidden, p.created_at,
        c.name as client_name, c.logo as client_logo,
        0 as generation_count,
        COALESCE(gen.estimated_cost, 0) as estimated_cost,
        COALESCE(uc.user_count, 0) as user_count,
        gen.last_message_at
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN (${genSubquery}) gen ON p.id = gen.project_id
      LEFT JOIN (${ucSubquery}) uc ON p.id = uc.project_id
      WHERE 1=1 ${hiddenFilter} ${clientFilter}
      ORDER BY gen.last_message_at DESC, p.created_at DESC
    `, [...clientParams]);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error obteniendo proyectos:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// POST - Crear proyecto
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const isAdmin = session.user.role === "admin";
    const canCreate = isAdmin || session.user.canCreateProjects;

    if (!canCreate) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const body = await request.json();
    const { title, description, client_id, status = "active", hidden = false } = body;

    if (!title) {
      return NextResponse.json(
        { error: "El título es requerido" },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO projects (title, description, client_id, status, hidden) VALUES (?, ?, ?, ?, ?)",
      [title, description || null, client_id || null, status, hidden ? 1 : 0]
    );

    return NextResponse.json(
      { id: result.insertId, title, description, client_id, status, hidden },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creando proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
