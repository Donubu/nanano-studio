import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { reflowForPreview } from "@/lib/production/reflow";
import { TemplateDefinition } from "@/lib/production/types";

interface TemplateRow extends RowDataPacket {
  id: number;
  production_project_id: number;
  design_id: number | null;
  linked_to_template_id: number | null;
  name: string;
  description: string | null;
  base_width: number;
  base_height: number;
  definition_json: string;
  thumbnail_url: string | null;
  brand_kit_id: number | null;
  status: "draft" | "published" | "archived";
  version: number;
  created_by: number;
  created_at: Date;
  updated_at: Date;
}

interface LinkedRow extends RowDataPacket {
  id: number;
  base_width: number;
  base_height: number;
}

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
    const [rows] = await pool.execute<TemplateRow[]>(
      `SELECT id, production_project_id, design_id, linked_to_template_id,
              name, description, base_width, base_height, definition_json,
              thumbnail_url, brand_kit_id, status, version,
              created_by, created_at, updated_at
         FROM production_templates
        WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }
    const row = rows[0];
    // Parse definition_json server-side so client gets an object
    let definition: unknown = null;
    try {
      definition = JSON.parse(row.definition_json);
    } catch {
      definition = null;
    }
    return NextResponse.json({ ...row, definition });
  } catch (error) {
    console.error("Error obteniendo template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

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
      name: z.string().min(1).max(255).optional(),
      description: z.string().max(5000).nullable().optional(),
      base_width: z.number().int().positive().max(10000).optional(),
      base_height: z.number().int().positive().max(10000).optional(),
      brand_kit_id: z.number().int().positive().nullable().optional(),
      design_id: z.number().int().positive().nullable().optional(),
      linked_to_template_id: z.number().int().positive().nullable().optional(),
      status: z.enum(["draft", "published", "archived"]).optional(),
      thumbnail_url: z.string().url().max(1000).nullable().optional(),
      definition: z.unknown().optional(),
    });
    const parsed = await parseBody(request, schema);
    if (parsed.error) return parsed.error;

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    for (const key of [
      "name",
      "description",
      "base_width",
      "base_height",
      "brand_kit_id",
      "design_id",
      "linked_to_template_id",
      "status",
      "thumbnail_url",
    ] as const) {
      const v = parsed.data[key];
      if (v === undefined) continue;
      updates.push(`${key} = ?`);
      values.push(v as string | number | null);
    }
    const definitionChanged = parsed.data.definition !== undefined;
    if (definitionChanged) {
      updates.push("definition_json = ?");
      values.push(JSON.stringify(parsed.data.definition));
      updates.push("version = version + 1");
    }
    if (updates.length === 0) {
      return NextResponse.json({ success: true });
    }
    values.push(id);

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE production_templates SET ${updates.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
      values
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }

    // Si cambió la definition de este template, propagamos a todas las
    // variantes linked (linked_to_template_id = this.id). Cada una recibe un
    // definition_json reflowed a su propio base_width/base_height. Distinct
    // variants no se tocan.
    if (definitionChanged) {
      const newDef = parsed.data.definition as TemplateDefinition;
      const [linked] = await pool.execute<LinkedRow[]>(
        `SELECT id, base_width, base_height
           FROM production_templates
          WHERE linked_to_template_id = ? AND deleted_at IS NULL`,
        [id]
      );
      for (const v of linked) {
        const reflowed = reflowForPreview(newDef, {
          w: v.base_width,
          h: v.base_height,
        });
        await pool.execute<ResultSetHeader>(
          `UPDATE production_templates
              SET definition_json = ?, version = version + 1
            WHERE id = ?`,
          [JSON.stringify(reflowed), v.id]
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

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
      `UPDATE production_templates SET deleted_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
