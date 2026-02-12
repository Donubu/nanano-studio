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
}

// GET - Obtener modelo por ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const [rows] = await pool.execute<ModelRow[]>(
      "SELECT * FROM models WHERE id = ?",
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Modelo no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json(rows[0]);
  } catch (error) {
    console.error("Error obteniendo modelo:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PUT - Actualizar modelo
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const {
      model_id,
      display_name,
      description,
      is_active,
      supports_images,
      supports_audio,
      supports_video,
      supports_image_generation,
      supports_video_generation,
      supports_audio_generation,
      supports_reference_images,
      max_tokens,
      cost_input_per_million,
      cost_output_per_million,
      cost_image_1k,
      cost_image_2k,
      cost_image_4k,
      cost_video_per_second,
      cost_audio_per_minute,
      api_backend,
    } = body;

    // Verificar que existe
    const [existing] = await pool.execute<ModelRow[]>(
      "SELECT id FROM models WHERE id = ?",
      [id]
    );

    if (existing.length === 0) {
      return NextResponse.json(
        { error: "Modelo no encontrado" },
        { status: 404 }
      );
    }

    // Si se está cambiando el model_id, verificar que no exista
    if (model_id) {
      const [duplicate] = await pool.execute<ModelRow[]>(
        "SELECT id FROM models WHERE model_id = ? AND id != ?",
        [model_id, id]
      );

      if (duplicate.length > 0) {
        return NextResponse.json(
          { error: "El model_id ya está en uso" },
          { status: 400 }
        );
      }
    }

    await pool.execute<ResultSetHeader>(
      `UPDATE models SET
        model_id = COALESCE(?, model_id),
        display_name = COALESCE(?, display_name),
        description = COALESCE(?, description),
        is_active = COALESCE(?, is_active),
        supports_images = COALESCE(?, supports_images),
        supports_audio = COALESCE(?, supports_audio),
        supports_video = COALESCE(?, supports_video),
        supports_image_generation = COALESCE(?, supports_image_generation),
        supports_video_generation = COALESCE(?, supports_video_generation),
        supports_audio_generation = COALESCE(?, supports_audio_generation),
        supports_reference_images = COALESCE(?, supports_reference_images),
        max_tokens = COALESCE(?, max_tokens),
        cost_input_per_million = COALESCE(?, cost_input_per_million),
        cost_output_per_million = COALESCE(?, cost_output_per_million),
        cost_image_1k = COALESCE(?, cost_image_1k),
        cost_image_2k = COALESCE(?, cost_image_2k),
        cost_image_4k = COALESCE(?, cost_image_4k),
        cost_video_per_second = COALESCE(?, cost_video_per_second),
        cost_audio_per_minute = COALESCE(?, cost_audio_per_minute),
        api_backend = IF(? = 'KEEP', api_backend, ?)
       WHERE id = ?`,
      [
        model_id || null,
        display_name || null,
        description,
        is_active ?? null,
        supports_images ?? null,
        supports_audio ?? null,
        supports_video ?? null,
        supports_image_generation ?? null,
        supports_video_generation ?? null,
        supports_audio_generation ?? null,
        supports_reference_images ?? null,
        max_tokens ?? null,
        cost_input_per_million ?? null,
        cost_output_per_million ?? null,
        cost_image_1k ?? null,
        cost_image_2k ?? null,
        cost_image_4k ?? null,
        cost_video_per_second ?? null,
        cost_audio_per_minute ?? null,
        api_backend === undefined ? 'KEEP' : (api_backend || null),
        api_backend === undefined ? null : (api_backend || null),
        id,
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando modelo:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// DELETE - Eliminar modelo
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    // Verificar si hay conversaciones usando este modelo
    const [conversations] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) as count FROM conversations WHERE model_id = ?",
      [id]
    );

    if (conversations[0].count > 0) {
      return NextResponse.json(
        { error: "No se puede eliminar: hay conversaciones usando este modelo" },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "DELETE FROM models WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { error: "Modelo no encontrado" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando modelo:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
