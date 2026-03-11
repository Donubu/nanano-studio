import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

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

    const types = ["text", "image", "video", "audio", "music"] as const;

    for (const type of types) {
      const typeConfig = config[type];
      if (!typeConfig) continue;

      // Upsert enabled status
      await pool.execute<ResultSetHeader>(
        `INSERT INTO project_generation_config (project_id, generation_type, is_enabled)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), updated_at = CURRENT_TIMESTAMP`,
        [project_id, type, typeConfig.enabled ? 1 : 0]
      );

      // Clear existing models for this type (replace with template)
      await pool.execute<ResultSetHeader>(
        "DELETE FROM project_generation_models WHERE project_id = ? AND generation_type = ?",
        [project_id, type]
      );

      // Insert template models
      if (typeConfig.models && typeConfig.models.length > 0) {
        for (let i = 0; i < typeConfig.models.length; i++) {
          const m = typeConfig.models[i];

          // Verify model still exists and is active
          const [modelCheck] = await pool.execute<RowDataPacket[]>(
            "SELECT id FROM models WHERE id = ? AND is_active = 1",
            [m.model_id]
          );
          if (modelCheck.length === 0) continue;

          await pool.execute<ResultSetHeader>(
            `INSERT INTO project_generation_models (project_id, generation_type, model_id, label, sort_order, is_default)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [project_id, type, m.model_id, m.label || "", m.sort_order ?? i, m.is_default ? 1 : 0]
          );
        }
      }
    }

    return NextResponse.json({ success: true, project_id });
  } catch (error) {
    console.error("Error applying template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
