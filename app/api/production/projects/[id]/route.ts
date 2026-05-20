import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";

interface ProductionProjectRow extends RowDataPacket {
  id: number;
  client_id: number;
  client_name?: string;
  client_logo?: string | null;
  title: string;
  description: string | null;
  status: "active" | "paused" | "completed" | "archived";
  hidden: number;
  created_by: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

// GET - Get single production project
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const [rows] = await pool.execute<ProductionProjectRow[]>(
      `SELECT pp.id, pp.client_id, pp.title, pp.description, pp.status, pp.hidden,
              pp.created_by, pp.created_at, pp.updated_at,
              c.name AS client_name, c.logo AS client_logo
         FROM production_projects pp
         JOIN clients c ON c.id = pp.client_id
        WHERE pp.id = ? AND pp.deleted_at IS NULL`,
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (error) {
    console.error("Error obteniendo production_project:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// PUT - Update production project
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
    const schema = z.object({
      title: z.string().min(1).max(255).optional(),
      description: z.string().max(5000).nullable().optional(),
      status: z.enum(["active", "paused", "completed", "archived"]).optional(),
      hidden: z.boolean().optional(),
    });
    const parsed = await parseBody(request, schema);
    if (parsed.error) return parsed.error;

    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value === undefined) continue;
      updates.push(`${key} = ?`);
      values.push(key === "hidden" ? (value ? 1 : 0) : (value as string | number | null));
    }
    if (updates.length === 0) {
      return NextResponse.json({ success: true });
    }
    values.push(id);

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE production_projects SET ${updates.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
      values
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando production_project:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE - Soft delete
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE production_projects SET deleted_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando production_project:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
