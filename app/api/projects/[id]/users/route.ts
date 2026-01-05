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
  max_monthly_generations: number;
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
        pu.id, pu.user_id, pu.role, pu.max_monthly_generations, pu.created_at,
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
    const { user_id, role = "member", max_monthly_generations = 0 } = body;

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
      "INSERT INTO project_users (project_id, user_id, role, max_monthly_generations) VALUES (?, ?, ?, ?)",
      [id, user_id, role, max_monthly_generations]
    );

    return NextResponse.json(
      { id: result.insertId, project_id: Number(id), user_id, role, max_monthly_generations },
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

// PUT - Actualizar límite de generaciones del usuario en proyecto
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
    const { user_id, max_monthly_generations, role } = body;

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

    if (max_monthly_generations !== undefined) {
      updates.push("max_monthly_generations = ?");
      values.push(max_monthly_generations);
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
