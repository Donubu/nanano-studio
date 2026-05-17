import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import {
  DEFAULT_TEMPLATE_DEFINITION,
  DEFAULT_TEMPLATE_HEIGHT,
  DEFAULT_TEMPLATE_WIDTH,
} from "@/lib/production/defaults";

interface TemplateRow extends RowDataPacket {
  id: number;
  production_project_id: number;
  design_id: number | null;
  design_name: string | null;
  name: string;
  description: string | null;
  base_width: number;
  base_height: number;
  thumbnail_url: string | null;
  brand_kit_id: number | null;
  status: "draft" | "published" | "archived";
  version: number;
  created_by: number;
  created_at: Date;
  updated_at: Date;
  adaptation_count?: number;
}

// GET - List templates for a production project
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("production_project_id");
    if (!projectId) {
      return NextResponse.json(
        { error: "production_project_id es requerido" },
        { status: 400 }
      );
    }

    const [rows] = await pool.execute<TemplateRow[]>(
      `SELECT pt.id, pt.production_project_id, pt.design_id, pt.name, pt.description,
              pt.base_width, pt.base_height, pt.thumbnail_url, pt.brand_kit_id,
              pt.status, pt.version, pt.created_by, pt.created_at, pt.updated_at,
              d.name AS design_name,
              (SELECT COUNT(*) FROM production_template_adaptations a
                 WHERE a.template_id = pt.id) AS adaptation_count
         FROM production_templates pt
         LEFT JOIN production_designs d
                ON d.id = pt.design_id AND d.deleted_at IS NULL
        WHERE pt.production_project_id = ? AND pt.deleted_at IS NULL
        ORDER BY pt.design_id IS NULL ASC, pt.design_id ASC, pt.updated_at DESC`,
      [projectId]
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error listando production_templates:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Create template (with default empty definition_json)
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const schema = z.object({
      production_project_id: z.number().int().positive(),
      name: z.string().min(1).max(255),
      description: z.string().max(5000).optional().nullable(),
      base_width: z.number().int().positive().max(10000).optional(),
      base_height: z.number().int().positive().max(10000).optional(),
      brand_kit_id: z.number().int().positive().optional().nullable(),
    });
    const parsed = await parseBody(request, schema);
    if (parsed.error) return parsed.error;
    const {
      production_project_id,
      name,
      description,
      base_width = DEFAULT_TEMPLATE_WIDTH,
      base_height = DEFAULT_TEMPLATE_HEIGHT,
      brand_kit_id,
    } = parsed.data;

    const definition = {
      ...DEFAULT_TEMPLATE_DEFINITION,
      size: { w: base_width, h: base_height },
    };

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_templates
         (production_project_id, name, description, base_width, base_height,
          definition_json, brand_kit_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        production_project_id,
        name,
        description ?? null,
        base_width,
        base_height,
        JSON.stringify(definition),
        brand_kit_id ?? null,
        Number(session.user.id),
      ]
    );

    return NextResponse.json(
      { id: result.insertId, production_project_id, name, base_width, base_height },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creando production_template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
