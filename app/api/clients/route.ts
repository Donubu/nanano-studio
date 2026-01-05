import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface ClientRow extends RowDataPacket {
  id: number;
  name: string;
  logo: string | null;
  created_at: Date;
}

// GET - Listar clientes
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const [rows] = await pool.execute<ClientRow[]>(
      "SELECT id, name, logo, created_at FROM clients ORDER BY name ASC"
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

    const body = await request.json();
    const { name, logo } = body;

    if (!name) {
      return NextResponse.json(
        { error: "El nombre es requerido" },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO clients (name, logo) VALUES (?, ?)",
      [name, logo || null]
    );

    return NextResponse.json(
      { id: result.insertId, name, logo },
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
