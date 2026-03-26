import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody, getPagination, paginationMeta } from "@/lib/api-utils";

type GenerationType = "text" | "image" | "video" | "audio" | "music" | "full" | "canvas";
// quality_tier kept in type for legacy DB column references
type QualityTier = "normal" | "hq" | "chirp";

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

interface ProjectModelRow extends RowDataPacket {
  model_id: number;
  is_default: number;
}

interface EnabledRow extends RowDataPacket {
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
    const { limit, offset } = getPagination(searchParams);

    const whereClause = archived ? "c.deleted_at IS NOT NULL" : "c.deleted_at IS NULL";
    const projectFilter = projectId ? "AND c.project_id = ?" : "";
    const params: (number | string)[] = projectId ? [projectId] : [];
    const orderBy = archived ? "ORDER BY c.deleted_at DESC" : "ORDER BY c.updated_at DESC";

    const selectFields = `
      c.*,
      m.display_name as model_display_name,
      p.title as project_title,
      u.name as user_name, u.email as user_email, u.name as owner_name, u.image as owner_image,
      (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count`;

    const fromClause = `
      FROM conversations c
      JOIN models m ON c.model_id = m.id
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN users u ON c.user_id = u.id
      WHERE ${whereClause} ${projectFilter}`;

    if (limit !== null) {
      const [[{ total }]] = await pool.execute<(RowDataPacket & { total: number })[]>(
        `SELECT COUNT(*) as total ${fromClause}`, params
      );
      const [rows] = await pool.execute<ConversationRow[]>(
        `SELECT ${selectFields} ${fromClause} ${orderBy} LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      return NextResponse.json({ data: rows, pagination: paginationMeta(total, limit, offset) });
    }

    const [rows] = await pool.execute<ConversationRow[]>(
      `SELECT ${selectFields} ${fromClause} ${orderBy}`, params
    );
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

    const createConversationSchema = z.object({
      project_id: z.number().int().positive().nullable().optional(),
      model_id: z.number().int().positive().nullable().optional(),
      generation_type: z.enum(["text", "image", "video", "audio", "music", "full", "canvas"]).default("text"),
      quality_tier: z.string().nullable().optional(),
      selected_model_id: z.number().int().positive().nullable().optional(),
      title: z.string().max(500).default("Nueva conversación"),
      system_instruction: z.string().max(50000).nullable().optional(),
      temperature: z.number().min(0).max(2).default(1.0),
      top_p: z.number().min(0).max(1).default(0.95),
      top_k: z.number().int().min(1).max(100).default(40),
      max_output_tokens: z.number().int().min(1).max(1000000).default(8192),
      image_aspect_ratio: z.string().max(20).default("16:9"),
      image_size: z.string().max(10).default("1K"),
      video_duration: z.number().int().min(1).max(600).default(8),
      video_resolution: z.string().max(20).default("720p"),
      video_aspect_ratio: z.string().max(20).default("16:9"),
      video_audio_enabled: z.boolean().default(true),
      video_negative_prompt: z.string().max(2000).nullable().default(null),
      audio_voice_id: z.string().max(100).default("Kore"),
      audio_style_prompt: z.string().max(2000).nullable().default(null),
      audio_multi_speaker: z.boolean().default(false),
      audio_speaker_config: z.any().nullable().default(null),
      audio_output_format: z.string().max(20).default("mp3"),
      audio_tts_engine: z.string().max(50).default("gemini"),
      audio_speaking_rate: z.number().min(0.25).max(4).default(1.0),
      audio_locale: z.string().max(20).default("en-US"),
      music_prompts: z.any().nullable().default(null),
      music_bpm: z.number().int().min(30).max(300).default(120),
      music_density: z.number().min(0).max(1).default(0.50),
      music_brightness: z.number().min(0).max(1).default(0.50),
      music_scale: z.string().max(50).default("UNSPECIFIED"),
      music_guidance: z.number().min(0).max(10).default(3.50),
      music_generation_mode: z.string().max(50).default("QUALITY"),
      music_duration: z.number().int().min(1).max(600).default(30),
      music_mute_bass: z.boolean().default(false),
      music_mute_drums: z.boolean().default(false),
      music_only_bass_and_drums: z.boolean().default(false),
    });

    const parsed = await parseBody(request, createConversationSchema);
    if (parsed.error) return parsed.error;
    const {
      project_id,
      model_id: providedModelId,
      generation_type,
      selected_model_id,
      title,
      system_instruction,
      temperature, top_p, top_k, max_output_tokens,
      image_aspect_ratio, image_size,
      video_duration, video_resolution, video_aspect_ratio, video_audio_enabled, video_negative_prompt,
      audio_voice_id, audio_style_prompt, audio_multi_speaker, audio_speaker_config,
      audio_output_format, audio_tts_engine, audio_speaking_rate, audio_locale,
      music_prompts, music_bpm, music_density, music_brightness, music_scale,
      music_guidance, music_generation_mode, music_duration,
      music_mute_bass, music_mute_drums, music_only_bass_and_drums,
    } = parsed.data;

    let model_id = providedModelId;

    // Si hay proyecto, obtener modelo desde la configuracion del proyecto
    if (project_id) {
      // For "full" type, check that both image AND video are enabled, use image models
      if (generation_type === "full" || generation_type === "canvas") {
        const [imgCheck] = await pool.execute<EnabledRow[]>(
          `SELECT is_enabled FROM project_generation_config WHERE project_id = ? AND generation_type = 'image'`,
          [project_id]
        );
        const [vidCheck] = await pool.execute<EnabledRow[]>(
          `SELECT is_enabled FROM project_generation_config WHERE project_id = ? AND generation_type = 'video'`,
          [project_id]
        );
        const requiredTypes = generation_type === "canvas" ? "texto, imagen y video" : "imagen y video";
        if (!imgCheck[0]?.is_enabled || !vidCheck[0]?.is_enabled) {
          return NextResponse.json(
            { error: `El tipo '${generation_type}' requiere que ${requiredTypes} estén habilitados` },
            { status: 400 }
          );
        }
        if (generation_type === "canvas") {
          const [txtCheck] = await pool.execute<EnabledRow[]>(
            `SELECT is_enabled FROM project_generation_config WHERE project_id = ? AND generation_type = 'text'`,
            [project_id]
          );
          if (!txtCheck[0]?.is_enabled) {
            return NextResponse.json(
              { error: `El tipo 'canvas' requiere que texto, imagen y video estén habilitados` },
              { status: 400 }
            );
          }
        }
        // Use text models for canvas, image models for full
        const modelType = generation_type === "canvas" ? "text" : "image";
        const [projectModels] = await pool.execute<ProjectModelRow[]>(
          `SELECT model_id, is_default FROM project_generation_models
           WHERE project_id = ? AND generation_type = ?
           ORDER BY sort_order ASC`,
          [project_id, modelType]
        );
        if (projectModels.length === 0) {
          return NextResponse.json(
            { error: `No hay modelos de ${modelType} configurados para este proyecto` },
            { status: 400 }
          );
        }
        const chosen = projectModels.find(m => selected_model_id && m.model_id === selected_model_id)
          || projectModels.find(m => m.is_default)
          || projectModels[0];
        model_id = chosen.model_id;
      } else {
      // Verificar que el tipo esta habilitado para el proyecto
      const [enabledCheck] = await pool.execute<EnabledRow[]>(
        `SELECT is_enabled FROM project_generation_config WHERE project_id = ? AND generation_type = ?`,
        [project_id, generation_type]
      );

      if (enabledCheck.length === 0 || !enabledCheck[0].is_enabled) {
        return NextResponse.json(
          { error: `El tipo de generacion '${generation_type}' no esta habilitado para este proyecto` },
          { status: 400 }
        );
      }

      // Obtener modelos asignados al proyecto para este tipo
      const [projectModels] = await pool.execute<ProjectModelRow[]>(
        `SELECT model_id, is_default FROM project_generation_models
         WHERE project_id = ? AND generation_type = ?
         ORDER BY sort_order ASC`,
        [project_id, generation_type]
      );

      if (projectModels.length === 0) {
        return NextResponse.json(
          { error: `No hay modelos configurados para '${generation_type}' en este proyecto` },
          { status: 400 }
        );
      }

      // Pick model: selected_model_id > default > first
      const chosen = projectModels.find(m => selected_model_id && m.model_id === selected_model_id)
        || projectModels.find(m => m.is_default)
        || projectModels[0];

      model_id = chosen.model_id;
      }
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
      `INSERT INTO conversations (user_id, project_id, model_id, generation_type, title, system_instruction, temperature, top_p, top_k, max_output_tokens, image_aspect_ratio, image_size, video_duration, video_resolution, video_aspect_ratio, video_audio_enabled, video_negative_prompt, audio_voice_id, audio_style_prompt, audio_multi_speaker, audio_speaker_config, audio_output_format, audio_tts_engine, audio_speaking_rate, audio_locale, music_prompts, music_bpm, music_density, music_brightness, music_scale, music_guidance, music_generation_mode, music_duration, music_mute_bass, music_mute_drums, music_only_bass_and_drums)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        audio_tts_engine,
        audio_speaking_rate,
        audio_locale,
        music_prompts ? JSON.stringify(music_prompts) : null,
        music_bpm,
        music_density,
        music_brightness,
        music_scale,
        music_guidance,
        music_generation_mode,
        music_duration,
        music_mute_bass ? 1 : 0,
        music_mute_drums ? 1 : 0,
        music_only_bass_and_drums ? 1 : 0,
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
