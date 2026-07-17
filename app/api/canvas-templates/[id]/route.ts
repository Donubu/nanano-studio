import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface TemplateRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  nodes_json: string;
  edges_json: string;
  node_count: number;
  edge_count: number;
  node_types_json: string | null;
  created_by: number | null;
  created_at: string;
}

async function getTemplate(id: string) {
  const [rows] = await pool.execute<TemplateRow[]>(
    `SELECT * FROM canvas_templates WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  return rows.length > 0 ? rows[0] : null;
}

function canManage(template: TemplateRow, session: { user: { id: number; role: string } }) {
  return session.user.role === "admin" || template.created_by === session.user.id;
}

// GET - Snapshot completo del template (para preview e instanciación).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const template = await getTemplate(id);
    if (!template) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }

    return NextResponse.json({
      id: template.id,
      name: template.name,
      description: template.description,
      nodes: JSON.parse(template.nodes_json),
      edges: JSON.parse(template.edges_json),
      nodeCount: template.node_count,
      edgeCount: template.edge_count,
      nodeTypes: template.node_types_json ? JSON.parse(template.node_types_json) : {},
      createdBy: template.created_by,
      createdAt: template.created_at,
      canManage: canManage(template, session),
    });
  } catch (error) {
    console.error("Error loading canvas template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// PATCH - Renombrar / editar descripción. Solo creador o admin.
// Body: { name?: string, description?: string }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const template = await getTemplate(id);
    if (!template) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }
    if (!canManage(template, session)) {
      return NextResponse.json({ error: "Sin permisos sobre este template" }, { status: 403 });
    }

    const body = await request.json();
    const set: string[] = [];
    const values: unknown[] = [];

    if (typeof body?.name === "string" && body.name.trim()) {
      set.push("name = ?");
      values.push(body.name.trim());
    }
    if (typeof body?.description === "string") {
      set.push("description = ?");
      values.push(body.description.trim() || null);
    }

    if (set.length === 0) {
      return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
    }

    values.push(id);
    await pool.execute(
      `UPDATE canvas_templates SET ${set.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
      values
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating canvas template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE - Soft delete. Solo creador o admin.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const template = await getTemplate(id);
    if (!template) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }
    if (!canManage(template, session)) {
      return NextResponse.json({ error: "Sin permisos sobre este template" }, { status: 403 });
    }

    await pool.execute(
      `UPDATE canvas_templates SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting canvas template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
