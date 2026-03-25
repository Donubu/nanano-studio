import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { applyTemplateToProject } from "@/lib/personal-space";

// POST - Apply a template to a project
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "admin" && !session.user.canCreateProjects) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { project_id } = body;

    if (!project_id) {
      return NextResponse.json({ error: "Se requiere project_id" }, { status: 400 });
    }

    // Get template
    const [templates] = await pool.execute<RowDataPacket[]>(
      "SELECT config FROM project_templates WHERE id = ?",
      [id]
    );
    if (templates.length === 0) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }

    // Verify project exists
    const [projects] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM projects WHERE id = ?",
      [project_id]
    );
    if (projects.length === 0) {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }

    const config = typeof templates[0].config === "string"
      ? JSON.parse(templates[0].config)
      : templates[0].config;

    await applyTemplateToProject(project_id, config);

    return NextResponse.json({ success: true, project_id });
  } catch (error) {
    console.error("Error applying template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
