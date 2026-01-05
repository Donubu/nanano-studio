import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  name: string | null;
  image: string | null;
  role: string;
  blocked_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
}

interface ProjectAssignment extends RowDataPacket {
  id: number;
  project_id: number;
  project_title: string;
  client_name: string | null;
  role: string;
  max_monthly_generations: number;
}

// GET - Obtener usuario por ID con proyectos asociados
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

    const [rows] = await pool.execute<UserRow[]>(
      "SELECT id, email, name, image, role, blocked_at, deleted_at, created_at FROM users WHERE id = ?",
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    // Obtener proyectos asociados
    const [projects] = await pool.execute<ProjectAssignment[]>(`
      SELECT
        pu.id, pu.project_id, pu.role, pu.max_monthly_generations,
        p.title as project_title,
        c.name as client_name
      FROM project_users pu
      JOIN projects p ON pu.project_id = p.id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE pu.user_id = ?
      ORDER BY p.title ASC
    `, [id]);

    return NextResponse.json({
      ...rows[0],
      projects,
    });
  } catch (error) {
    console.error("Error obteniendo usuario:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PUT - Actualizar usuario
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
    const { email, name, role } = body;

    // Verificar que el usuario existe
    const [existing] = await pool.execute<UserRow[]>(
      "SELECT id, deleted_at FROM users WHERE id = ?",
      [id]
    );

    if (existing.length === 0 || existing[0].deleted_at) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    // Verificar si el nuevo email ya está en uso por otro usuario
    if (email) {
      const [emailCheck] = await pool.execute<UserRow[]>(
        "SELECT id FROM users WHERE email = ? AND id != ? AND deleted_at IS NULL",
        [email, id]
      );

      if (emailCheck.length > 0) {
        return NextResponse.json(
          { error: "El email ya está en uso" },
          { status: 400 }
        );
      }
    }

    await pool.execute<ResultSetHeader>(
      "UPDATE users SET email = COALESCE(?, email), name = COALESCE(?, name), role = COALESCE(?, role) WHERE id = ?",
      [email || null, name || null, role || null, id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando usuario:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PATCH - Bloquear/Desbloquear usuario
export async function PATCH(
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
    const { action } = body; // 'block' | 'unblock' | 'restore'

    // No permitir bloquearse a sí mismo
    if (session.user.id === Number(id)) {
      return NextResponse.json(
        { error: "No puedes bloquearte a ti mismo" },
        { status: 400 }
      );
    }

    const [existing] = await pool.execute<UserRow[]>(
      "SELECT id, role, blocked_at, deleted_at FROM users WHERE id = ?",
      [id]
    );

    if (existing.length === 0) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    if (action === "block") {
      await pool.execute<ResultSetHeader>(
        "UPDATE users SET blocked_at = NOW() WHERE id = ?",
        [id]
      );
      return NextResponse.json({ success: true, action: "blocked" });
    }

    if (action === "unblock") {
      await pool.execute<ResultSetHeader>(
        "UPDATE users SET blocked_at = NULL WHERE id = ?",
        [id]
      );
      return NextResponse.json({ success: true, action: "unblocked" });
    }

    if (action === "restore") {
      await pool.execute<ResultSetHeader>(
        "UPDATE users SET deleted_at = NULL, blocked_at = NULL WHERE id = ?",
        [id]
      );
      return NextResponse.json({ success: true, action: "restored" });
    }

    return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  } catch (error) {
    console.error("Error actualizando estado del usuario:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// DELETE - Eliminar usuario (soft delete para users, bloqueo para admins)
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

    // No permitir eliminarse a sí mismo
    if (session.user.id === Number(id)) {
      return NextResponse.json(
        { error: "No puedes eliminarte a ti mismo" },
        { status: 400 }
      );
    }

    // Verificar el usuario
    const [existing] = await pool.execute<UserRow[]>(
      "SELECT id, role, deleted_at FROM users WHERE id = ?",
      [id]
    );

    if (existing.length === 0 || existing[0].deleted_at) {
      return NextResponse.json(
        { error: "Usuario no encontrado" },
        { status: 404 }
      );
    }

    // Si es admin, solo bloquear (no se puede eliminar)
    if (existing[0].role === "admin") {
      await pool.execute<ResultSetHeader>(
        "UPDATE users SET blocked_at = NOW() WHERE id = ?",
        [id]
      );
      return NextResponse.json({
        success: true,
        action: "blocked",
        message: "Los administradores no se pueden eliminar, solo bloquear",
      });
    }

    // Si es usuario normal, soft delete
    await pool.execute<ResultSetHeader>(
      "UPDATE users SET deleted_at = NOW() WHERE id = ?",
      [id]
    );

    return NextResponse.json({ success: true, action: "deleted" });
  } catch (error) {
    console.error("Error eliminando usuario:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
