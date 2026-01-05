import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface ModelRow extends RowDataPacket {
  id: number;
  model_id: string;
  display_name: string;
  description: string | null;
  is_active: boolean;
  supports_images: boolean;
  supports_audio: boolean;
  supports_video: boolean;
  max_tokens: number;
  created_at: Date;
}

// GET - Listar modelos
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") !== "false";

    let query = "SELECT * FROM models";
    if (activeOnly) {
      query += " WHERE is_active = TRUE";
    }
    query += " ORDER BY display_name ASC";

    const [rows] = await pool.execute<ModelRow[]>(query);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error obteniendo modelos:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// POST - Crear modelo (solo admin)
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const {
      model_id,
      display_name,
      description,
      is_active = true,
      supports_images = false,
      supports_audio = false,
      supports_video = false,
      max_tokens = 8192,
    } = body;

    if (!model_id || !display_name) {
      return NextResponse.json(
        { error: "model_id y display_name son requeridos" },
        { status: 400 }
      );
    }

    // Verificar si ya existe
    const [existing] = await pool.execute<ModelRow[]>(
      "SELECT id FROM models WHERE model_id = ?",
      [model_id]
    );

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "El model_id ya existe" },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO models (model_id, display_name, description, is_active, supports_images, supports_audio, supports_video, max_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [model_id, display_name, description || null, is_active, supports_images, supports_audio, supports_video, max_tokens]
    );

    return NextResponse.json(
      { id: result.insertId, model_id, display_name },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creando modelo:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
