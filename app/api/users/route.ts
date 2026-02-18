import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  name: string | null;
  image: string | null;
  role: string;
  cargo: string;
  ai_calculator_access: number;
  blocked_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
}

// GET - Listar usuarios (excluye soft deleted)
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const includeDeleted = searchParams.get("includeDeleted") === "true";

    let query = "SELECT id, email, name, image, role, cargo, ai_calculator_access, blocked_at, deleted_at, created_at FROM users";
    if (!includeDeleted) {
      query += " WHERE deleted_at IS NULL";
    }
    query += " ORDER BY created_at DESC";

    const [rows] = await pool.execute<UserRow[]>(query);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error obteniendo usuarios:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// POST - Crear usuario
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const { email, name, role = "user", cargo = "Sin definir", ai_calculator_access = false } = body;

    if (!email) {
      return NextResponse.json(
        { error: "El email es requerido" },
        { status: 400 }
      );
    }

    // Verificar si el email ya existe (incluyendo soft deleted)
    const [existing] = await pool.execute<UserRow[]>(
      "SELECT id, deleted_at FROM users WHERE email = ?",
      [email]
    );

    if (existing.length > 0) {
      if (existing[0].deleted_at) {
        // Restaurar usuario eliminado
        await pool.execute<ResultSetHeader>(
          "UPDATE users SET name = ?, role = ?, cargo = ?, ai_calculator_access = ?, deleted_at = NULL, blocked_at = NULL WHERE id = ?",
          [name || null, role, cargo, ai_calculator_access ? 1 : 0, existing[0].id]
        );
        return NextResponse.json(
          { id: existing[0].id, email, name, role, cargo, ai_calculator_access, restored: true },
          { status: 200 }
        );
      }
      return NextResponse.json(
        { error: "El email ya está registrado" },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO users (email, name, role, cargo, ai_calculator_access) VALUES (?, ?, ?, ?, ?)",
      [email, name || null, role, cargo, ai_calculator_access ? 1 : 0]
    );

    return NextResponse.json(
      { id: result.insertId, email, name, role, cargo, ai_calculator_access },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creando usuario:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
