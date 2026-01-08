import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface ProjectUserRow extends RowDataPacket {
  id: number;
  user_id: number;
  user_email: string;
  user_name: string | null;
  user_image: string | null;
  role: string;
  // Límites legacy (mantener por retrocompatibilidad)
  max_monthly_image_generations: number;
  max_monthly_video_generations: number;
  // Nuevos límites por calidad
  max_monthly_image_normal: number;
  max_monthly_image_hq: number;
  max_monthly_video_normal: number;
  max_monthly_video_hq: number;
  max_monthly_audio_normal: number;
  max_monthly_audio_hq: number;
  max_monthly_text_normal: number;
  max_monthly_text_hq: number;
  created_at: Date;
}

// GET - Listar usuarios de un proyecto
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const [rows] = await pool.execute<ProjectUserRow[]>(`
      SELECT
        pu.id, pu.user_id, pu.role,
        COALESCE(pu.max_monthly_image_generations, 0) as max_monthly_image_generations,
        COALESCE(pu.max_monthly_video_generations, 0) as max_monthly_video_generations,
        COALESCE(pu.max_monthly_image_normal, 0) as max_monthly_image_normal,
        COALESCE(pu.max_monthly_image_hq, 0) as max_monthly_image_hq,
        COALESCE(pu.max_monthly_video_normal, 0) as max_monthly_video_normal,
        COALESCE(pu.max_monthly_video_hq, 0) as max_monthly_video_hq,
        COALESCE(pu.max_monthly_audio_normal, 0) as max_monthly_audio_normal,
        COALESCE(pu.max_monthly_audio_hq, 0) as max_monthly_audio_hq,
        COALESCE(pu.max_monthly_text_normal, 0) as max_monthly_text_normal,
        COALESCE(pu.max_monthly_text_hq, 0) as max_monthly_text_hq,
        pu.created_at,
        u.email as user_email, u.name as user_name, u.image as user_image
      FROM project_users pu
      JOIN users u ON pu.user_id = u.id
      WHERE pu.project_id = ? AND u.deleted_at IS NULL
      ORDER BY pu.created_at DESC
    `, [id]);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error obteniendo usuarios del proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// POST - Agregar usuario a proyecto
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const {
      user_id,
      role = "member",
      // Legacy fields
      max_monthly_image_generations = 0,
      max_monthly_video_generations = 0,
      // New quality-based limits
      max_monthly_image_normal = 0,
      max_monthly_image_hq = 0,
      max_monthly_video_normal = 0,
      max_monthly_video_hq = 0,
      max_monthly_audio_normal = 0,
      max_monthly_audio_hq = 0,
      max_monthly_text_normal = 0,
      max_monthly_text_hq = 0,
    } = body;

    if (!user_id) {
      return NextResponse.json(
        { error: "El user_id es requerido" },
        { status: 400 }
      );
    }

    // Verificar si ya existe la asociación
    const [existing] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM project_users WHERE project_id = ? AND user_id = ?",
      [id, user_id]
    );

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "El usuario ya está asignado al proyecto" },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO project_users (
        project_id, user_id, role,
        max_monthly_image_generations, max_monthly_video_generations,
        max_monthly_image_normal, max_monthly_image_hq,
        max_monthly_video_normal, max_monthly_video_hq,
        max_monthly_audio_normal, max_monthly_audio_hq,
        max_monthly_text_normal, max_monthly_text_hq
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, user_id, role,
        max_monthly_image_generations, max_monthly_video_generations,
        max_monthly_image_normal, max_monthly_image_hq,
        max_monthly_video_normal, max_monthly_video_hq,
        max_monthly_audio_normal, max_monthly_audio_hq,
        max_monthly_text_normal, max_monthly_text_hq,
      ]
    );

    return NextResponse.json(
      {
        id: result.insertId,
        project_id: Number(id),
        user_id,
        role,
        max_monthly_image_generations,
        max_monthly_video_generations,
        max_monthly_image_normal,
        max_monthly_image_hq,
        max_monthly_video_normal,
        max_monthly_video_hq,
        max_monthly_audio_normal,
        max_monthly_audio_hq,
        max_monthly_text_normal,
        max_monthly_text_hq,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error agregando usuario al proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PUT - Actualizar límites de generaciones del usuario en proyecto
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const {
      user_id,
      // Legacy fields
      max_monthly_image_generations,
      max_monthly_video_generations,
      // New quality-based limits
      max_monthly_image_normal,
      max_monthly_image_hq,
      max_monthly_video_normal,
      max_monthly_video_hq,
      max_monthly_audio_normal,
      max_monthly_audio_hq,
      max_monthly_text_normal,
      max_monthly_text_hq,
      role,
    } = body;

    if (!user_id) {
      return NextResponse.json(
        { error: "El user_id es requerido" },
        { status: 400 }
      );
    }

    // Verificar que existe la asociación
    const [existing] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM project_users WHERE project_id = ? AND user_id = ?",
      [id, user_id]
    );

    if (existing.length === 0) {
      return NextResponse.json(
        { error: "El usuario no está asignado al proyecto" },
        { status: 404 }
      );
    }

    // Construir query dinámicamente
    const updates: string[] = [];
    const values: (string | number)[] = [];

    // Legacy fields
    if (max_monthly_image_generations !== undefined) {
      updates.push("max_monthly_image_generations = ?");
      values.push(max_monthly_image_generations);
    }
    if (max_monthly_video_generations !== undefined) {
      updates.push("max_monthly_video_generations = ?");
      values.push(max_monthly_video_generations);
    }

    // New quality-based limits
    if (max_monthly_image_normal !== undefined) {
      updates.push("max_monthly_image_normal = ?");
      values.push(max_monthly_image_normal);
    }
    if (max_monthly_image_hq !== undefined) {
      updates.push("max_monthly_image_hq = ?");
      values.push(max_monthly_image_hq);
    }
    if (max_monthly_video_normal !== undefined) {
      updates.push("max_monthly_video_normal = ?");
      values.push(max_monthly_video_normal);
    }
    if (max_monthly_video_hq !== undefined) {
      updates.push("max_monthly_video_hq = ?");
      values.push(max_monthly_video_hq);
    }
    if (max_monthly_audio_normal !== undefined) {
      updates.push("max_monthly_audio_normal = ?");
      values.push(max_monthly_audio_normal);
    }
    if (max_monthly_audio_hq !== undefined) {
      updates.push("max_monthly_audio_hq = ?");
      values.push(max_monthly_audio_hq);
    }
    if (max_monthly_text_normal !== undefined) {
      updates.push("max_monthly_text_normal = ?");
      values.push(max_monthly_text_normal);
    }
    if (max_monthly_text_hq !== undefined) {
      updates.push("max_monthly_text_hq = ?");
      values.push(max_monthly_text_hq);
    }

    if (role !== undefined) {
      updates.push("role = ?");
      values.push(role);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No hay campos para actualizar" },
        { status: 400 }
      );
    }

    values.push(Number(id), user_id);

    await pool.execute<ResultSetHeader>(
      `UPDATE project_users SET ${updates.join(", ")} WHERE project_id = ? AND user_id = ?`,
      values
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando usuario del proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// DELETE - Remover usuario de proyecto
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");

    if (!userId) {
      return NextResponse.json(
        { error: "El user_id es requerido" },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "DELETE FROM project_users WHERE project_id = ? AND user_id = ?",
      [id, userId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { error: "Asociación no encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removiendo usuario del proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
