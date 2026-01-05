import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface ProjectRow extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  client_id: number | null;
  status: string;
}

// GET - Obtener proyecto por ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    // Admin puede ver cualquier proyecto
    if (session.user.role === "admin") {
      const [rows] = await pool.execute<ProjectRow[]>(`
        SELECT
          p.id, p.title, p.description, p.client_id, p.status, p.created_at,
          c.name as client_name, c.logo as client_logo
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        WHERE p.id = ?
      `, [id]);

      if (rows.length === 0) {
        return NextResponse.json(
          { error: "Proyecto no encontrado" },
          { status: 404 }
        );
      }

      return NextResponse.json(rows[0]);
    }

    // Usuario normal: solo si está asignado al proyecto
    const [rows] = await pool.execute<ProjectRow[]>(`
      SELECT
        p.id, p.title, p.description, p.client_id, p.status, p.created_at,
        c.name as client_name, c.logo as client_logo
      FROM projects p
      INNER JOIN project_users pu ON p.id = pu.project_id
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE p.id = ? AND pu.user_id = ?
    `, [id, session.user.id]);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Proyecto no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json(rows[0]);
  } catch (error) {
    console.error("Error obteniendo proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PUT - Actualizar proyecto
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
    const { title, description, client_id, status } = body;

    const [existing] = await pool.execute<ProjectRow[]>(
      "SELECT id FROM projects WHERE id = ?",
      [id]
    );

    if (existing.length === 0) {
      return NextResponse.json(
        { error: "Proyecto no encontrado" },
        { status: 404 }
      );
    }

    await pool.execute<ResultSetHeader>(
      `UPDATE projects SET
        title = COALESCE(?, title),
        description = ?,
        client_id = ?,
        status = COALESCE(?, status)
      WHERE id = ?`,
      [title || null, description !== undefined ? description : null, client_id !== undefined ? client_id : null, status || null, id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// DELETE - Eliminar proyecto
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

    const [result] = await pool.execute<ResultSetHeader>(
      "DELETE FROM projects WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { error: "Proyecto no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
