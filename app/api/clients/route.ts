import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";

interface ClientRow extends RowDataPacket {
  id: number;
  name: string;
  logo: string | null;
  hidden: boolean;
  created_at: Date;
}

// GET - Listar clientes
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const isAdmin = session.user.role === "admin";

    if (isAdmin) {
      // Admin ve todos los clientes incluyendo hidden
      const [rows] = await pool.execute<ClientRow[]>(
        `SELECT c.id, c.name, c.logo, c.hidden, c.default_project_id, c.created_at,
          (SELECT COUNT(*) FROM projects WHERE client_id = c.id) as project_count
         FROM clients c
         ORDER BY c.name ASC`
      );
      return NextResponse.json(rows);
    }

    // Usuario normal: ve todos los clientes no-hidden
    const [rows] = await pool.execute<ClientRow[]>(
      `SELECT c.id, c.name, c.logo, c.hidden, c.default_project_id, c.created_at,
        (SELECT COUNT(*) FROM projects WHERE client_id = c.id AND hidden = 0) as project_count
       FROM clients c
       WHERE c.hidden = 0
       ORDER BY c.name ASC`
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error obteniendo clientes:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// POST - Crear cliente
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const createClientSchema = z.object({
      name: z.string().min(1, "El nombre es requerido").max(255),
      logo: z.string().url().nullable().optional(),
      hidden: z.boolean().default(false),
    });

    const parsed = await parseBody(request, createClientSchema);
    if (parsed.error) return parsed.error;
    const { name, logo, hidden } = parsed.data;

    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO clients (name, logo, hidden) VALUES (?, ?, ?)",
      [name, logo || null, hidden ? 1 : 0]
    );

    return NextResponse.json(
      { id: result.insertId, name, logo, hidden },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creando cliente:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
