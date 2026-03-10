import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface TemplateRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  config: string;
  created_at: string;
  updated_at: string;
}

// GET - List all templates
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const [rows] = await pool.execute<TemplateRow[]>(
      "SELECT * FROM project_templates ORDER BY name ASC"
    );

    const templates = rows.map((row) => ({
      ...row,
      config: typeof row.config === "string" ? JSON.parse(row.config) : row.config,
    }));

    return NextResponse.json(templates);
  } catch (error) {
    console.error("Error fetching templates:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Create a template (manually or from an existing project)
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, config, from_project_id } = body;

    if (!name) {
      return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 });
    }

    let templateConfig = config;

    // If creating from an existing project, extract its config
    if (from_project_id) {
      templateConfig = await extractProjectConfig(from_project_id);
    }

    if (!templateConfig) {
      return NextResponse.json({ error: "Se requiere config o from_project_id" }, { status: 400 });
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO project_templates (name, description, config) VALUES (?, ?, ?)",
      [name, description || null, JSON.stringify(templateConfig)]
    );

    return NextResponse.json(
      { id: result.insertId, name, description, config: templateConfig },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// Extract generation config from an existing project
async function extractProjectConfig(projectId: number) {
  // Get enabled status
  const [enabledRows] = await pool.execute<RowDataPacket[]>(
    "SELECT generation_type, is_enabled FROM project_generation_config WHERE project_id = ?",
    [projectId]
  );

  // Get models
  const [modelRows] = await pool.execute<RowDataPacket[]>(
    `SELECT pgm.generation_type, pgm.model_id, pgm.label, pgm.sort_order, pgm.is_default
     FROM project_generation_models pgm
     WHERE pgm.project_id = ?
     ORDER BY pgm.generation_type, pgm.sort_order ASC`,
    [projectId]
  );

  const enabledMap: Record<string, boolean> = {};
  for (const row of enabledRows) {
    enabledMap[row.generation_type] = Boolean(row.is_enabled);
  }

  const types = ["text", "image", "video", "audio", "music"] as const;
  const config: Record<string, { enabled: boolean; models: Array<{ model_id: number; label: string; sort_order: number; is_default: boolean }> }> = {};

  for (const type of types) {
    config[type] = {
      enabled: enabledMap[type] ?? false,
      models: modelRows
        .filter((r) => r.generation_type === type)
        .map((r) => ({
          model_id: r.model_id,
          label: r.label,
          sort_order: r.sort_order,
          is_default: Boolean(r.is_default),
        })),
    };
  }

  return config;
}
