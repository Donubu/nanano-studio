import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";

interface ModelRow extends RowDataPacket {
  id: number;
  model_id: string;
  display_name: string;
  description: string | null;
  is_active: boolean;
  supports_images: boolean;
  supports_audio: boolean;
  supports_video: boolean;
  supports_image_generation: boolean;
  supports_video_generation: boolean;
  supports_audio_generation: boolean;
  supports_reference_images: boolean;
  max_tokens: number;
  cost_input_per_million: number;
  cost_output_per_million: number;
  cost_image_1k: number;
  cost_image_2k: number;
  cost_image_4k: number;
  cost_video_per_second: number;
  cost_audio_per_minute: number;
  api_backend: string | null;
  is_obsolete: boolean;
  replaced_by_model_id: number | null;
  project_count: number;
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

    let query = `
      SELECT m.*,
        (SELECT COUNT(*) FROM project_generation_models pgm WHERE pgm.model_id = m.id) as project_count
      FROM models m`;
    if (activeOnly) {
      query += " WHERE m.is_active = TRUE";
    }
    query += " ORDER BY m.is_obsolete ASC, m.display_name ASC";

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

    const createModelSchema = z.object({
      model_id: z.string().min(1, "model_id es requerido").max(255),
      display_name: z.string().min(1, "display_name es requerido").max(255),
      description: z.string().max(1000).nullable().optional(),
      is_active: z.boolean().default(true),
      supports_images: z.boolean().default(false),
      supports_audio: z.boolean().default(false),
      supports_video: z.boolean().default(false),
      supports_image_generation: z.boolean().default(false),
      supports_video_generation: z.boolean().default(false),
      supports_audio_generation: z.boolean().default(false),
      supports_reference_images: z.boolean().default(false),
      max_tokens: z.number().int().min(1).max(1000000).default(8192),
      cost_input_per_million: z.number().min(0).default(0),
      cost_output_per_million: z.number().min(0).default(0),
      cost_image_1k: z.number().min(0).default(0),
      cost_image_2k: z.number().min(0).default(0),
      cost_image_4k: z.number().min(0).default(0),
      cost_video_per_second: z.number().min(0).default(0),
      cost_audio_per_minute: z.number().min(0).default(0),
      api_backend: z.string().max(50).nullable().default(null),
    });

    const parsed = await parseBody(request, createModelSchema);
    if (parsed.error) return parsed.error;
    const {
      model_id, display_name, description, is_active,
      supports_images, supports_audio, supports_video,
      supports_image_generation, supports_video_generation, supports_audio_generation,
      supports_reference_images, max_tokens,
      cost_input_per_million, cost_output_per_million,
      cost_image_1k, cost_image_2k, cost_image_4k, cost_video_per_second, cost_audio_per_minute,
      api_backend,
    } = parsed.data;

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
      `INSERT INTO models (
        model_id, display_name, description, is_active,
        supports_images, supports_audio, supports_video,
        supports_image_generation, supports_video_generation, supports_audio_generation,
        supports_reference_images, max_tokens,
        cost_input_per_million, cost_output_per_million,
        cost_image_1k, cost_image_2k, cost_image_4k, cost_video_per_second, cost_audio_per_minute,
        api_backend
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        model_id, display_name, description || null, is_active,
        supports_images, supports_audio, supports_video,
        supports_image_generation, supports_video_generation, supports_audio_generation,
        supports_reference_images, max_tokens,
        cost_input_per_million, cost_output_per_million,
        cost_image_1k, cost_image_2k, cost_image_4k, cost_video_per_second, cost_audio_per_minute,
        api_backend
      ]
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
