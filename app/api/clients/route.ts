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
  monthly_image_limit: number | null;
  monthly_video_limit: number | null;
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
        `SELECT c.id, c.name, c.logo, c.hidden, c.is_internal, c.default_project_id,
          c.monthly_image_limit, c.monthly_video_limit, c.created_at,
          (SELECT COUNT(*) FROM projects WHERE client_id = c.id) as project_count
         FROM clients c
         ORDER BY c.name ASC`
      );
      return NextResponse.json(rows);
    }

    // Usuario normal: ve clientes no-hidden + cliente interno si tiene espacio personal
    const userId = session.user.id;
    const [rows] = await pool.execute<ClientRow[]>(
      `SELECT c.id, c.name, c.logo, c.hidden, c.is_internal, c.default_project_id,
        c.monthly_image_limit, c.monthly_video_limit, c.created_at,
        (SELECT COUNT(*) FROM projects WHERE client_id = c.id AND (hidden = 0 OR (is_personal = 1 AND owner_user_id = ?))) as project_count
       FROM clients c
       WHERE c.hidden = 0
         OR (c.is_internal = 1 AND EXISTS(
           SELECT 1 FROM projects p
           WHERE p.client_id = c.id AND p.is_personal = 1 AND p.owner_user_id = ?
         ))
       ORDER BY c.name ASC`,
      [userId, userId]
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
      is_internal: z.boolean().default(false),
    });

    const parsed = await parseBody(request, createClientSchema);
    if (parsed.error) return parsed.error;
    const { name, logo, hidden, is_internal } = parsed.data;

    // Solo 1 cliente puede ser interno
    if (is_internal) {
      await pool.execute<ResultSetHeader>(
        "UPDATE clients SET is_internal = 0 WHERE is_internal = 1"
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO clients (name, logo, hidden, is_internal) VALUES (?, ?, ?, ?)",
      [name, logo || null, hidden ? 1 : 0, is_internal ? 1 : 0]
    );

    return NextResponse.json(
      { id: result.insertId, name, logo, hidden, is_internal },
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
