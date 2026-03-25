import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody, getPagination, paginationMeta } from "@/lib/api-utils";
import { createPersonalSpace } from "@/lib/personal-space";

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

    const { limit, offset } = getPagination(searchParams);

    const whereClause = includeDeleted ? "" : "WHERE deleted_at IS NULL";

    if (limit !== null) {
      const [[{ total }]] = await pool.execute<(RowDataPacket & { total: number })[]>(
        `SELECT COUNT(*) as total FROM users ${whereClause}`
      );
      const [rows] = await pool.execute<UserRow[]>(
        `SELECT id, email, name, image, role, cargo, ai_calculator_access, can_create_projects, has_personal_space, blocked_at, deleted_at, created_at FROM users ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      return NextResponse.json({ data: rows, pagination: paginationMeta(total, limit, offset) });
    }

    const [rows] = await pool.execute<UserRow[]>(
      `SELECT id, email, name, image, role, cargo, ai_calculator_access, can_create_projects, has_personal_space, blocked_at, deleted_at, created_at FROM users ${whereClause} ORDER BY created_at DESC`
    );
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

    const createUserSchema = z.object({
      email: z.string().email("Email inválido"),
      name: z.string().max(255).nullable().optional(),
      role: z.enum(["admin", "user"]).default("user"),
      cargo: z.string().max(255).default("Sin definir"),
      ai_calculator_access: z.boolean().default(false),
      can_create_projects: z.boolean().default(false),
      has_personal_space: z.boolean().default(false),
    });

    const parsed = await parseBody(request, createUserSchema);
    if (parsed.error) return parsed.error;
    const { email, name, role, cargo, ai_calculator_access, can_create_projects, has_personal_space } = parsed.data;

    // Verificar si el email ya existe (incluyendo soft deleted)
    const [existing] = await pool.execute<UserRow[]>(
      "SELECT id, deleted_at FROM users WHERE email = ?",
      [email]
    );

    if (existing.length > 0) {
      if (existing[0].deleted_at) {
        // Restaurar usuario eliminado
        await pool.execute<ResultSetHeader>(
          "UPDATE users SET name = ?, role = ?, cargo = ?, ai_calculator_access = ?, can_create_projects = ?, has_personal_space = ?, deleted_at = NULL, blocked_at = NULL WHERE id = ?",
          [name || null, role, cargo, ai_calculator_access ? 1 : 0, can_create_projects ? 1 : 0, has_personal_space ? 1 : 0, existing[0].id]
        );

        // Crear espacio personal si se activa
        if (has_personal_space) {
          try {
            await createPersonalSpace(existing[0].id, name || email);
          } catch (e) {
            // No bloquear la creación del usuario si falla el espacio personal
            console.error("Error creando espacio personal:", e);
          }
        }

        return NextResponse.json(
          { id: existing[0].id, email, name, role, cargo, ai_calculator_access, has_personal_space, restored: true },
          { status: 200 }
        );
      }
      return NextResponse.json(
        { error: "El email ya está registrado" },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO users (email, name, role, cargo, ai_calculator_access, can_create_projects, has_personal_space) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [email, name || null, role, cargo, ai_calculator_access ? 1 : 0, can_create_projects ? 1 : 0, has_personal_space ? 1 : 0]
    );

    // Crear espacio personal si se activa
    if (has_personal_space) {
      try {
        await createPersonalSpace(result.insertId, name || email);
      } catch (e) {
        console.error("Error creando espacio personal:", e);
      }
    }

    return NextResponse.json(
      { id: result.insertId, email, name, role, cargo, ai_calculator_access, has_personal_space },
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
