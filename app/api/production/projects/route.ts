import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";

interface ProductionProjectRow extends RowDataPacket {
  id: number;
  client_id: number;
  title: string;
  description: string | null;
  status: "active" | "paused" | "completed" | "archived";
  hidden: number;
  created_by: number;
  created_at: Date;
  updated_at: Date;
  template_count?: number;
}

// GET - List production projects (optionally filtered by client_id)
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("client_id");

    const where: string[] = ["pp.deleted_at IS NULL"];
    const values: (string | number)[] = [];
    if (clientId) {
      where.push("pp.client_id = ?");
      values.push(Number(clientId));
    }

    const [rows] = await pool.execute<ProductionProjectRow[]>(
      `SELECT pp.id, pp.client_id, pp.title, pp.description, pp.status, pp.hidden,
              pp.created_by, pp.created_at, pp.updated_at,
              (SELECT COUNT(*) FROM production_templates pt
                 WHERE pt.production_project_id = pp.id AND pt.deleted_at IS NULL) AS template_count
         FROM production_projects pp
        WHERE ${where.join(" AND ")}
        ORDER BY pp.updated_at DESC`,
      values
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error listando production_projects:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Create production project
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const schema = z.object({
      client_id: z.number().int().positive(),
      title: z.string().min(1).max(255),
      description: z.string().max(5000).optional().nullable(),
      status: z.enum(["active", "paused", "completed", "archived"]).default("active"),
    });
    const parsed = await parseBody(request, schema);
    if (parsed.error) return parsed.error;
    const { client_id, title, description, status } = parsed.data;

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_projects (client_id, title, description, status, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [client_id, title, description ?? null, status, Number(session.user.id)]
    );

    return NextResponse.json(
      { id: result.insertId, client_id, title, description, status },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creando production_project:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
