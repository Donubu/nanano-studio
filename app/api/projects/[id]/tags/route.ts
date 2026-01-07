import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface TagRow extends RowDataPacket {
  id: number;
  project_id: number;
  name: string;
  color: string;
  created_at: string;
  usage_count: number;
}

// GET - List all tags for a project
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

    // Verify user has access to project (admin or project member)
    if (session.user.role !== "admin") {
      const [access] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM project_users WHERE project_id = ? AND user_id = ?",
        [id, session.user.id]
      );
      if (access.length === 0) {
        return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
      }
    }

    // Get tags with usage count
    const [tags] = await pool.execute<TagRow[]>(`
      SELECT
        t.id, t.project_id, t.name, t.color, t.created_at,
        COUNT(mt.id) as usage_count
      FROM tags t
      LEFT JOIN message_tags mt ON t.id = mt.tag_id
      WHERE t.project_id = ?
      GROUP BY t.id
      ORDER BY t.name ASC
    `, [id]);

    return NextResponse.json(tags);
  } catch (error) {
    console.error("Error fetching tags:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// POST - Create a new tag
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, color = "#6366f1" } = body;

    if (!name || name.trim() === "") {
      return NextResponse.json(
        { error: "El nombre de la etiqueta es requerido" },
        { status: 400 }
      );
    }

    // Validate color format
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return NextResponse.json(
        { error: "El color debe estar en formato hexadecimal (#RRGGBB)" },
        { status: 400 }
      );
    }

    // Verify user has access to project
    if (session.user.role !== "admin") {
      const [access] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM project_users WHERE project_id = ? AND user_id = ?",
        [id, session.user.id]
      );
      if (access.length === 0) {
        return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
      }
    }

    // Check if tag already exists
    const [existing] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM tags WHERE project_id = ? AND name = ?",
      [id, name.trim()]
    );

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Ya existe una etiqueta con ese nombre" },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO tags (project_id, name, color) VALUES (?, ?, ?)",
      [id, name.trim(), color]
    );

    return NextResponse.json(
      {
        id: result.insertId,
        project_id: Number(id),
        name: name.trim(),
        color,
        usage_count: 0,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating tag:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PUT - Update a tag
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { tag_id, name, color } = body;

    if (!tag_id) {
      return NextResponse.json(
        { error: "El tag_id es requerido" },
        { status: 400 }
      );
    }

    // Verify user has access to project
    if (session.user.role !== "admin") {
      const [access] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM project_users WHERE project_id = ? AND user_id = ?",
        [id, session.user.id]
      );
      if (access.length === 0) {
        return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
      }
    }

    // Verify tag belongs to project
    const [tagCheck] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM tags WHERE id = ? AND project_id = ?",
      [tag_id, id]
    );

    if (tagCheck.length === 0) {
      return NextResponse.json({ error: "Etiqueta no encontrada" }, { status: 404 });
    }

    // Build update query
    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (name !== undefined) {
      if (name.trim() === "") {
        return NextResponse.json(
          { error: "El nombre no puede estar vacío" },
          { status: 400 }
        );
      }
      // Check if name already exists for another tag
      const [nameCheck] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM tags WHERE project_id = ? AND name = ? AND id != ?",
        [id, name.trim(), tag_id]
      );
      if (nameCheck.length > 0) {
        return NextResponse.json(
          { error: "Ya existe otra etiqueta con ese nombre" },
          { status: 400 }
        );
      }
      updates.push("name = ?");
      values.push(name.trim());
    }

    if (color !== undefined) {
      if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
        return NextResponse.json(
          { error: "El color debe estar en formato hexadecimal (#RRGGBB)" },
          { status: 400 }
        );
      }
      updates.push("color = ?");
      values.push(color);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No hay campos para actualizar" },
        { status: 400 }
      );
    }

    values.push(tag_id);

    await pool.execute<ResultSetHeader>(
      `UPDATE tags SET ${updates.join(", ")} WHERE id = ?`,
      values
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating tag:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a tag
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const tagId = searchParams.get("tag_id");

    if (!tagId) {
      return NextResponse.json(
        { error: "El tag_id es requerido" },
        { status: 400 }
      );
    }

    // Verify user has access to project
    if (session.user.role !== "admin") {
      const [access] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM project_users WHERE project_id = ? AND user_id = ?",
        [id, session.user.id]
      );
      if (access.length === 0) {
        return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
      }
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "DELETE FROM tags WHERE id = ? AND project_id = ?",
      [tagId, id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Etiqueta no encontrada" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting tag:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
