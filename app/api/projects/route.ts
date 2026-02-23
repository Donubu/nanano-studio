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
  has_access?: number;
}

// GET - Listar proyectos
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Admin ve todos los proyectos, usuarios normales solo los asignados
    if (session.user.role === "admin") {
      const [rows] = await pool.execute<ProjectRow[]>(`
        SELECT
          p.id, p.title, p.description, p.client_id, p.status, p.hidden, p.created_at,
          c.name as client_name, c.logo as client_logo,
          COALESCE(gen.generation_count, 0) as generation_count,
          COALESCE(gen.estimated_cost, 0) as estimated_cost,
          COALESCE(uc.user_count, 0) as user_count,
          gen.last_message_at
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        LEFT JOIN (
          SELECT
            conv.project_id,
            COUNT(msg.id) as generation_count,
            SUM(msg.estimated_cost) as estimated_cost,
            MAX(msg.created_at) as last_message_at
          FROM conversations conv
          JOIN messages msg ON conv.id = msg.conversation_id
          WHERE msg.role = 'model'
            AND (msg.image_url IS NOT NULL OR msg.video_url IS NOT NULL OR msg.audio_url IS NOT NULL)
            AND msg.deleted_at IS NULL
          GROUP BY conv.project_id
        ) gen ON p.id = gen.project_id
        LEFT JOIN (
          SELECT project_id, COUNT(*) as user_count
          FROM project_users
          GROUP BY project_id
        ) uc ON p.id = uc.project_id
        ORDER BY gen.last_message_at DESC, p.created_at DESC
      `);
      return NextResponse.json(rows);
    }

    // Usuario normal: todos los proyectos visibles, con indicador de acceso
    const [rows] = await pool.execute<ProjectRow[]>(`
      SELECT
        p.id, p.title, p.description, p.client_id, p.status, p.hidden, p.created_at,
        c.name as client_name, c.logo as client_logo,
        COALESCE(gen.generation_count, 0) as generation_count,
        COALESCE(gen.estimated_cost, 0) as estimated_cost,
        COALESCE(uc.user_count, 0) as user_count,
        gen.last_message_at,
        CASE WHEN pu.user_id IS NOT NULL THEN 1 ELSE 0 END as has_access
      FROM projects p
      LEFT JOIN project_users pu ON p.id = pu.project_id AND pu.user_id = ?
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN (
        SELECT
          conv.project_id,
          COUNT(msg.id) as generation_count,
          SUM(msg.estimated_cost) as estimated_cost,
          MAX(msg.created_at) as last_message_at
        FROM conversations conv
        JOIN messages msg ON conv.id = msg.conversation_id
        WHERE msg.role = 'model'
          AND (msg.image_url IS NOT NULL OR msg.video_url IS NOT NULL OR msg.audio_url IS NOT NULL)
          AND msg.deleted_at IS NULL
        GROUP BY conv.project_id
      ) gen ON p.id = gen.project_id
      LEFT JOIN (
        SELECT project_id, COUNT(*) as user_count
        FROM project_users
        GROUP BY project_id
      ) uc ON p.id = uc.project_id
      WHERE (p.hidden = 0 OR pu.user_id IS NOT NULL)
      ORDER BY has_access DESC, gen.last_message_at DESC, p.created_at DESC
    `, [session.user.id]);

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

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
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
