import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface DesignRow extends RowDataPacket {
  id: number;
  production_project_id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  template_count: number;
}

// GET - List designs for a production project (admin only).
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

    const [rows] = await pool.execute<DesignRow[]>(
      `SELECT d.id, d.production_project_id, d.name, d.description,
              d.created_at, d.updated_at,
              (SELECT COUNT(*) FROM production_templates t
                 WHERE t.design_id = d.id AND t.deleted_at IS NULL) AS template_count
         FROM production_designs d
        WHERE d.production_project_id = ? AND d.deleted_at IS NULL
        ORDER BY d.created_at DESC`,
      [projectId]
    );
    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error listando designs:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Create a design (admin only). Body: { production_project_id, name, description? }.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const projectId = Number(body.production_project_id);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : null;

    if (!Number.isFinite(projectId) || projectId <= 0) {
      return NextResponse.json(
        { error: "production_project_id inválido" },
        { status: 400 }
      );
    }
    if (!name) {
      return NextResponse.json({ error: "name es requerido" }, { status: 400 });
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_designs (production_project_id, name, description, created_by)
       VALUES (?, ?, ?, ?)`,
      [projectId, name, description, Number(session.user.id)]
    );

    return NextResponse.json({ id: result.insertId }, { status: 201 });
  } catch (error) {
    console.error("Error creando design:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
