import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { normalizeClientSlug, CLIENT_SLUG_ERROR } from "@/lib/client-slug";

interface ClientRow extends RowDataPacket {
  id: number;
  name: string;
  logo: string | null;
}

// GET - Obtener cliente por ID
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

    const [rows] = await pool.execute<ClientRow[]>(
      "SELECT id, name, slug, logo, hidden, is_internal, default_project_id, created_at, brand_guide_synced_at FROM clients WHERE id = ?",
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Cliente no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json(rows[0]);
  } catch (error) {
    console.error("Error obteniendo cliente:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PUT - Actualizar cliente
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
    const { name, logo, hidden, default_project_id, is_internal } = body;
    const slug = body.slug === undefined ? undefined : normalizeClientSlug(body.slug);
    if (body.slug !== undefined && slug === undefined) {
      return NextResponse.json({ error: CLIENT_SLUG_ERROR }, { status: 400 });
    }
    if (slug) {
      const [dup] = await pool.execute<ClientRow[]>(
        "SELECT id FROM clients WHERE slug = ? AND id != ?",
        [slug, id]
      );
      if (dup.length > 0) {
        return NextResponse.json({ error: `El slug "${slug}" ya lo usa otro cliente` }, { status: 409 });
      }
    }

    const [existing] = await pool.execute<ClientRow[]>(
      "SELECT id FROM clients WHERE id = ?",
      [id]
    );

    if (existing.length === 0) {
      return NextResponse.json(
        { error: "Cliente no encontrado" },
        { status: 404 }
      );
    }

    // Solo 1 cliente puede ser interno
    if (is_internal === true) {
      await pool.execute<ResultSetHeader>(
        "UPDATE clients SET is_internal = 0 WHERE is_internal = 1 AND id != ?",
        [id]
      );
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (name !== undefined) {
      updates.push("name = ?");
      values.push(name);
    }
    if (slug !== undefined) {
      updates.push("slug = ?");
      values.push(slug);
    }
    if (logo !== undefined) {
      updates.push("logo = ?");
      values.push(logo || null);
    }
    if (hidden !== undefined) {
      updates.push("hidden = ?");
      values.push(hidden ? 1 : 0);
    }
    if (default_project_id !== undefined) {
      updates.push("default_project_id = ?");
      values.push(default_project_id || null);
    }
    if (is_internal !== undefined) {
      updates.push("is_internal = ?");
      values.push(is_internal ? 1 : 0);
    }

    if (updates.length > 0) {
      values.push(id);
      await pool.execute<ResultSetHeader>(
        `UPDATE clients SET ${updates.join(", ")} WHERE id = ?`,
        values
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando cliente:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// DELETE - Eliminar cliente
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
      "DELETE FROM clients WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { error: "Cliente no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando cliente:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
