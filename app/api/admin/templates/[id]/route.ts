import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

// PUT - Update a template
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
    const { name, description, config } = body;

    const [existing] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM project_templates WHERE id = ?",
      [id]
    );
    if (existing.length === 0) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }

    const updates: string[] = [];
    const values: (string | null)[] = [];

    if (name !== undefined) {
      updates.push("name = ?");
      values.push(name);
    }
    if (description !== undefined) {
      updates.push("description = ?");
      values.push(description);
    }
    if (config !== undefined) {
      updates.push("config = ?");
      values.push(JSON.stringify(config));
    }

    if (updates.length > 0) {
      values.push(id);
      await pool.execute<ResultSetHeader>(
        `UPDATE project_templates SET ${updates.join(", ")} WHERE id = ?`,
        values
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE - Delete a template
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
      "DELETE FROM project_templates WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
