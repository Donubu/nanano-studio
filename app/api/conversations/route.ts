import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

type GenerationType = "text" | "image" | "video" | "audio";
type QualityTier = "normal" | "hq";

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number | null;
  model_id: number;
  generation_type: GenerationType;
  model_display_name: string;
  project_title: string | null;
  title: string;
  system_instruction: string | null;
  temperature: number;
  top_p: number;
  top_k: number;
  max_output_tokens: number;
  created_at: Date;
  updated_at: Date;
  last_message: string | null;
  message_count: number;
}

interface GenerationConfigRow extends RowDataPacket {
  model_normal_id: number | null;
  model_hq_id: number | null;
  is_enabled: number;
}

// GET - Listar conversaciones del usuario
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("project_id");
    const archived = searchParams.get("archived") === "true";

    const isAdmin = session.user.role === "admin";

    let query = `
      SELECT
        c.*,
        m.display_name as model_display_name,
        p.title as project_title,
        ${isAdmin ? "u.name as user_name, u.email as user_email," : ""}
        (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
      FROM conversations c
      JOIN models m ON c.model_id = m.id
      LEFT JOIN projects p ON c.project_id = p.id
      ${isAdmin ? "LEFT JOIN users u ON c.user_id = u.id" : ""}
      WHERE ${isAdmin ? "1=1" : "c.user_id = ?"} AND ${archived ? "c.deleted_at IS NOT NULL" : "c.deleted_at IS NULL"}
    `;

    const params: (number | string)[] = isAdmin ? [] : [session.user.id];

    if (projectId) {
      query += " AND c.project_id = ?";
      params.push(projectId);
    }

    query += archived ? " ORDER BY c.deleted_at DESC" : " ORDER BY c.updated_at DESC";

    const [rows] = await pool.execute<ConversationRow[]>(query, params);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error obteniendo conversaciones:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// POST - Crear nueva conversación
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const {
      project_id,
      model_id: providedModelId,
      generation_type = "text" as GenerationType,
      quality_tier = "normal" as QualityTier,
      title = "Nueva conversación",
      system_instruction,
      temperature = 1.0,
      top_p = 0.95,
      top_k = 40,
      max_output_tokens = 8192,
      image_aspect_ratio = "16:9",
      image_size = "1K",
      // Video settings
      video_duration = 8,
      video_resolution = "720p",
      video_aspect_ratio = "16:9",
      video_audio_enabled = true,
      video_negative_prompt = null,
      // Audio settings
      audio_voice_id = "Kore",
      audio_style_prompt = null,
      audio_multi_speaker = false,
      audio_speaker_config = null,
      audio_output_format = "mp3",
    } = body;

    // Validar generation_type
    if (!["text", "image", "video", "audio"].includes(generation_type)) {
      return NextResponse.json(
        { error: "generation_type invalido. Debe ser: text, image, video o audio" },
        { status: 400 }
      );
    }

    // Validar quality_tier
    if (!["normal", "hq"].includes(quality_tier)) {
      return NextResponse.json(
        { error: "quality_tier invalido. Debe ser: normal o hq" },
        { status: 400 }
      );
    }

    let model_id = providedModelId;

    // Si hay proyecto, obtener modelo desde la configuracion del proyecto
    if (project_id) {
      // Verificar que el tipo esta habilitado para el proyecto
      const [genConfig] = await pool.execute<GenerationConfigRow[]>(
        `SELECT model_normal_id, model_hq_id, is_enabled
         FROM project_generation_config
         WHERE project_id = ? AND generation_type = ?`,
        [project_id, generation_type]
      );

      if (genConfig.length === 0 || !genConfig[0].is_enabled) {
        return NextResponse.json(
          { error: `El tipo de generacion '${generation_type}' no esta habilitado para este proyecto` },
          { status: 400 }
        );
      }

      // Obtener el modelo segun la calidad
      const configRow = genConfig[0];
      const selectedModelId = quality_tier === "hq"
        ? configRow.model_hq_id
        : configRow.model_normal_id;

      if (!selectedModelId) {
        return NextResponse.json(
          { error: `No hay modelo ${quality_tier === 'hq' ? 'HQ' : 'normal'} configurado para '${generation_type}' en este proyecto` },
          { status: 400 }
        );
      }

      model_id = selectedModelId;
    } else if (!model_id) {
      // Si no hay proyecto ni model_id, es error
      return NextResponse.json(
        { error: "Se requiere project_id o model_id" },
        { status: 400 }
      );
    }

    // Verificar que el modelo existe y está activo
    const [model] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM models WHERE id = ? AND is_active = TRUE",
      [model_id]
    );

    if (model.length === 0) {
      return NextResponse.json(
        { error: "Modelo no encontrado o inactivo" },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO conversations (user_id, project_id, model_id, generation_type, title, system_instruction, temperature, top_p, top_k, max_output_tokens, image_aspect_ratio, image_size, video_duration, video_resolution, video_aspect_ratio, video_audio_enabled, video_negative_prompt, audio_voice_id, audio_style_prompt, audio_multi_speaker, audio_speaker_config, audio_output_format)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.user.id,
        project_id || null,
        model_id,
        generation_type,
        title,
        system_instruction || null,
        temperature,
        top_p,
        top_k,
        max_output_tokens,
        image_aspect_ratio,
        image_size,
        video_duration,
        video_resolution,
        video_aspect_ratio,
        video_audio_enabled ? 1 : 0,
        video_negative_prompt,
        audio_voice_id,
        audio_style_prompt,
        audio_multi_speaker ? 1 : 0,
        audio_speaker_config ? JSON.stringify(audio_speaker_config) : null,
        audio_output_format,
      ]
    );

    return NextResponse.json(
      { id: result.insertId, title, model_id, generation_type },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creando conversación:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
