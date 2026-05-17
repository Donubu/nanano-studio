// Datasets persistidos por template para CSV merge.
// MVP: un dataset activo por template (la subida nueva reemplaza al
// anterior). El schema soporta varios; lo limitamos en la API para
// mantener UX simple. Si el productor necesita varios datasets en el
// futuro, basta con remover el DELETE previo en el POST.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface TemplateRow extends RowDataPacket {
  id: number;
  production_project_id: number;
}

interface DatasetRow extends RowDataPacket {
  id: number;
  production_project_id: number;
  template_id: number | null;
  name: string;
  source_filename: string | null;
  columns_json: string | null;
  rows_json: string | null;
  row_count: number;
  created_at: string;
  updated_at: string;
}

// GET - Returns the most recent dataset for this template, or null.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id: rawTemplateId } = await params;
    const templateId = Number(rawTemplateId);
    if (!Number.isFinite(templateId)) {
      return NextResponse.json({ error: "Template inválido" }, { status: 400 });
    }
    const [rows] = await pool.execute<DatasetRow[]>(
      `SELECT id, production_project_id, template_id, name, source_filename,
              columns_json, rows_json, row_count, created_at, updated_at
         FROM production_datasets
        WHERE template_id = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 1`,
      [templateId]
    );
    if (rows.length === 0) {
      return NextResponse.json(null);
    }
    const r = rows[0];
    // Parseamos JSON server-side para que el cliente reciba arrays listos.
    const columns = safeParseArray<string>(r.columns_json);
    const rowsParsed = safeParseArray<Record<string, string | number | null>>(r.rows_json);
    return NextResponse.json({
      id: r.id,
      template_id: r.template_id,
      name: r.name,
      source_filename: r.source_filename,
      columns,
      rows: rowsParsed,
      row_count: r.row_count,
      created_at: r.created_at,
      updated_at: r.updated_at,
    });
  } catch (error) {
    console.error("Error listando dataset:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Upload a dataset for this template (replaces any existing one).
// Body: { name, source_filename, columns: string[], rows: Record<string,...>[] }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id: rawTemplateId } = await params;
    const templateId = Number(rawTemplateId);
    if (!Number.isFinite(templateId)) {
      return NextResponse.json({ error: "Template inválido" }, { status: 400 });
    }

    const [tpl] = await pool.execute<TemplateRow[]>(
      "SELECT id, production_project_id FROM production_templates WHERE id = ? AND deleted_at IS NULL",
      [templateId]
    );
    if (tpl.length === 0) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }
    const projectId = tpl[0].production_project_id;

    const body = await request.json();
    const name = typeof body.name === "string" && body.name.trim() !== ""
      ? body.name.trim()
      : "Dataset";
    const sourceFilename = typeof body.source_filename === "string"
      ? body.source_filename.slice(0, 250)
      : null;
    const columns = Array.isArray(body.columns)
      ? body.columns.filter((c: unknown) => typeof c === "string")
      : [];
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (columns.length === 0 || rows.length === 0) {
      return NextResponse.json(
        { error: "Faltan columnas o filas" },
        { status: 400 }
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // Replace policy: borramos datasets previos del template para mantener
      // un dataset activo. Si más adelante hace falta historizar, podemos
      // agregar un flag is_active en vez de borrar.
      await conn.execute(
        "DELETE FROM production_datasets WHERE template_id = ?",
        [templateId]
      );
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO production_datasets
           (production_project_id, template_id, name, source_filename,
            columns_json, rows_json, row_count, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          projectId,
          templateId,
          name,
          sourceFilename,
          JSON.stringify(columns),
          JSON.stringify(rows),
          rows.length,
          Number(session.user.id),
        ]
      );
      await conn.commit();
      return NextResponse.json({ id: result.insertId, row_count: rows.length }, { status: 201 });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error("Error guardando dataset:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE - Remove the dataset(s) of this template.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id: rawTemplateId } = await params;
    const templateId = Number(rawTemplateId);
    if (!Number.isFinite(templateId)) {
      return NextResponse.json({ error: "Template inválido" }, { status: 400 });
    }
    await pool.execute(
      "DELETE FROM production_datasets WHERE template_id = ?",
      [templateId]
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando dataset:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

function safeParseArray<T>(v: string | null): T[] {
  if (v == null) return [];
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
