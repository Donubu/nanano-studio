import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";

interface BrandKitRow extends RowDataPacket {
  id: number;
  client_id: number;
  production_project_id: number | null;
  name: string;
  colors_json: unknown;
  typography_json: unknown;
  logos_json: unknown;
  spacing_json: unknown;
  rules_text: string | null;
  is_default: number;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

// GET - List brand kits.
// Query params:
//   - client_id (required): the owning client.
//   - production_project_id (optional): cuando se pasa, además incluye los
//     kits project-scoped del proyecto. Sin él, solo cliente-wide.
//   - include_deleted (optional, "true"/"1"): incluye los soft-deleted. Por
//     default los filtramos para que el editor de producción no los liste.
//     El dashboard del cliente lo pasa para mostrar la sección "Eliminados".
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("client_id");
    const projectId = searchParams.get("production_project_id");
    const includeDeletedRaw = searchParams.get("include_deleted");
    const includeDeleted =
      includeDeletedRaw === "true" || includeDeletedRaw === "1";
    if (!clientId) {
      return NextResponse.json({ error: "client_id es requerido" }, { status: 400 });
    }

    let sql = `SELECT id, client_id, production_project_id, name, colors_json,
                      typography_json, logos_json, spacing_json, rules_text,
                      is_default, created_by, created_at, updated_at, deleted_at
                 FROM production_brand_kits
                WHERE client_id = ?`;
    const values: (string | number)[] = [clientId];
    if (projectId) {
      sql += ` AND (production_project_id IS NULL OR production_project_id = ?)`;
      values.push(Number(projectId));
    } else {
      sql += ` AND production_project_id IS NULL`;
    }
    if (!includeDeleted) {
      sql += ` AND deleted_at IS NULL`;
    }
    sql += ` ORDER BY deleted_at IS NULL DESC, production_project_id IS NULL DESC, is_default DESC, name ASC`;

    const [rows] = await pool.execute<BrandKitRow[]>(sql, values);
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error listando brand_kits:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const schema = z.object({
      client_id: z.number().int().positive(),
      production_project_id: z.number().int().positive().nullable().optional(),
      name: z.string().min(1).max(150),
      colors_json: z.unknown().optional(),
      typography_json: z.unknown().optional(),
      logos_json: z.unknown().optional(),
      spacing_json: z.unknown().optional(),
      rules_text: z.string().max(20000).optional().nullable(),
      is_default: z.boolean().optional(),
    });
    const parsed = await parseBody(request, schema);
    if (parsed.error) return parsed.error;
    const d = parsed.data;

    if (d.is_default) {
      // Default applies per scope: only one client-wide default and one
      // per-project default at a time.
      if (d.production_project_id) {
        await pool.execute<ResultSetHeader>(
          `UPDATE production_brand_kits SET is_default = 0
             WHERE client_id = ? AND production_project_id = ? AND is_default = 1`,
          [d.client_id, d.production_project_id]
        );
      } else {
        await pool.execute<ResultSetHeader>(
          `UPDATE production_brand_kits SET is_default = 0
             WHERE client_id = ? AND production_project_id IS NULL AND is_default = 1`,
          [d.client_id]
        );
      }
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_brand_kits
         (client_id, production_project_id, name, colors_json, typography_json,
          logos_json, spacing_json, rules_text, is_default, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.client_id,
        d.production_project_id ?? null,
        d.name,
        d.colors_json !== undefined ? JSON.stringify(d.colors_json) : null,
        d.typography_json !== undefined ? JSON.stringify(d.typography_json) : null,
        d.logos_json !== undefined ? JSON.stringify(d.logos_json) : null,
        d.spacing_json !== undefined ? JSON.stringify(d.spacing_json) : null,
        d.rules_text ?? null,
        d.is_default ? 1 : 0,
        Number(session.user.id),
      ]
    );

    return NextResponse.json({ id: result.insertId, ...d }, { status: 201 });
  } catch (error) {
    console.error("Error creando brand_kit:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
