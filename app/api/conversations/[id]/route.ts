import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number | null;
  model_id: number;
  model_model_id: string;
  model_display_name: string;
  model_supports_image_generation: boolean;
  model_supports_video_generation: boolean;
  model_supports_audio_generation: boolean;
  project_title: string | null;
  title: string;
  system_instruction: string | null;
  temperature: number;
  top_p: number;
  top_k: number;
  max_output_tokens: number;
  image_aspect_ratio: string;
  image_size: string;
  // Video settings
  video_duration: number;
  video_resolution: string;
  video_aspect_ratio: string;
  video_audio_enabled: boolean;
  video_negative_prompt: string | null;
  // Audio settings
  audio_voice_id: string;
  audio_style_prompt: string | null;
  audio_multi_speaker: boolean;
  audio_speaker_config: string | null;
  audio_output_format: string;
  audio_tts_engine: string;
  audio_speaking_rate: number;
  audio_locale: string;
  created_at: Date;
  updated_at: Date;
}

// GET - Obtener conversación con mensajes
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
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get("archived") === "true";
    const isAdmin = session.user.role === "admin";

    // Obtener conversación (incluir archivadas si se solicita)
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT
        c.*,
        m.model_id as model_model_id,
        m.display_name as model_display_name,
        m.supports_image_generation as model_supports_image_generation,
        m.supports_video_generation as model_supports_video_generation,
        m.supports_audio_generation as model_supports_audio_generation,
        p.title as project_title,
        u.name as owner_name,
        u.image as owner_image
      FROM conversations c
      JOIN models m ON c.model_id = m.id
      LEFT JOIN projects p ON c.project_id = p.id
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = ? ${isAdmin ? "" : "AND c.user_id = ?"} ${includeArchived ? "" : "AND c.deleted_at IS NULL"}`,
      isAdmin ? [id] : [id, session.user.id]
    );

    if (conversations.length === 0) {
      return NextResponse.json(
        { error: "Conversación no encontrada" },
        { status: 404 }
      );
    }

    // Obtener mensajes
    const [messages] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
      [id]
    );

    // Obtener todas las imágenes de referencia de message_images para esta conversación
    const messageIds = messages.map(m => m.id);
    let messageImagesMap: Record<number, { url: string; mime_type: string | null }[]> = {};
    if (messageIds.length > 0) {
      const [messageImages] = await pool.execute<RowDataPacket[]>(
        `SELECT message_id, image_url, mime_type FROM message_images WHERE message_id IN (${messageIds.map(() => '?').join(',')}) ORDER BY sort_order ASC`,
        messageIds
      );
      for (const img of messageImages) {
        if (!messageImagesMap[img.message_id]) {
          messageImagesMap[img.message_id] = [];
        }
        messageImagesMap[img.message_id].push({ url: img.image_url, mime_type: img.mime_type });
      }
    }

    // Convert MySQL TINYINT to boolean for video_has_audio, is_favorite, and ignore_in_context in messages
    const messagesWithBooleans = messages.map(msg => {
      // Determinar images: usar message_images si hay, sino fallback a image_url
      const images = messageImagesMap[msg.id] || (msg.image_url ? [{ url: msg.image_url, mime_type: msg.image_mime_type }] : []);
      return {
        ...msg,
        video_has_audio: Boolean(msg.video_has_audio),
        is_favorite: Boolean(msg.is_favorite),
        ignore_in_context: Boolean(msg.ignore_in_context),
        images: msg.role === "user" ? images : undefined,
      };
    });

    const conv = conversations[0];
    return NextResponse.json({
      ...conv,
      // Convert MySQL TINYINT to proper booleans
      video_audio_enabled: Boolean(conv.video_audio_enabled),
      model_supports_image_generation: Boolean(conv.model_supports_image_generation),
      model_supports_video_generation: Boolean(conv.model_supports_video_generation),
      model_supports_audio_generation: Boolean(conv.model_supports_audio_generation),
      audio_multi_speaker: Boolean(conv.audio_multi_speaker),
      audio_speaker_config: conv.audio_speaker_config ? JSON.parse(conv.audio_speaker_config) : null,
      messages: messagesWithBooleans,
    });
  } catch (error) {
    console.error("Error obteniendo conversación:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PUT - Actualizar conversación (título, configuración)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const {
      title,
      system_instruction,
      temperature,
      top_p,
      top_k,
      max_output_tokens,
      model_id,
      image_aspect_ratio,
      image_size,
      // Video settings
      video_duration,
      video_resolution,
      video_aspect_ratio,
      video_audio_enabled,
      video_negative_prompt,
      // Audio settings
      audio_voice_id,
      audio_style_prompt,
      audio_multi_speaker,
      audio_speaker_config,
      audio_output_format,
      audio_tts_engine,
      audio_speaking_rate,
      audio_locale,
    } = body;

    // Verificar que la conversación pertenece al usuario y no está eliminada
    const isAdmin = session.user.role === "admin";
    const [existing] = await pool.execute<ConversationRow[]>(
      `SELECT id FROM conversations WHERE id = ? ${isAdmin ? "" : "AND user_id = ?"} AND deleted_at IS NULL`,
      isAdmin ? [id] : [id, session.user.id]
    );

    if (existing.length === 0) {
      return NextResponse.json(
        { error: "Conversación no encontrada" },
        { status: 404 }
      );
    }

    await pool.execute<ResultSetHeader>(
      `UPDATE conversations SET
        title = COALESCE(?, title),
        system_instruction = COALESCE(?, system_instruction),
        temperature = COALESCE(?, temperature),
        top_p = COALESCE(?, top_p),
        top_k = COALESCE(?, top_k),
        max_output_tokens = COALESCE(?, max_output_tokens),
        model_id = COALESCE(?, model_id),
        image_aspect_ratio = COALESCE(?, image_aspect_ratio),
        image_size = COALESCE(?, image_size),
        video_duration = COALESCE(?, video_duration),
        video_resolution = COALESCE(?, video_resolution),
        video_aspect_ratio = COALESCE(?, video_aspect_ratio),
        video_audio_enabled = COALESCE(?, video_audio_enabled),
        video_negative_prompt = COALESCE(?, video_negative_prompt),
        audio_voice_id = COALESCE(?, audio_voice_id),
        audio_style_prompt = COALESCE(?, audio_style_prompt),
        audio_multi_speaker = COALESCE(?, audio_multi_speaker),
        audio_speaker_config = COALESCE(?, audio_speaker_config),
        audio_output_format = COALESCE(?, audio_output_format),
        audio_tts_engine = COALESCE(?, audio_tts_engine),
        audio_speaking_rate = COALESCE(?, audio_speaking_rate),
        audio_locale = COALESCE(?, audio_locale)
       WHERE id = ?`,
      [
        title ?? null,
        system_instruction ?? null,
        temperature ?? null,
        top_p ?? null,
        top_k ?? null,
        max_output_tokens ?? null,
        model_id ?? null,
        image_aspect_ratio ?? null,
        image_size ?? null,
        video_duration ?? null,
        video_resolution ?? null,
        video_aspect_ratio ?? null,
        video_audio_enabled !== undefined ? (video_audio_enabled ? 1 : 0) : null,
        video_negative_prompt ?? null,
        audio_voice_id ?? null,
        audio_style_prompt ?? null,
        audio_multi_speaker !== undefined ? (audio_multi_speaker ? 1 : 0) : null,
        audio_speaker_config !== undefined ? (audio_speaker_config ? JSON.stringify(audio_speaker_config) : null) : null,
        audio_output_format ?? null,
        audio_tts_engine ?? null,
        audio_speaking_rate ?? null,
        audio_locale ?? null,
        id,
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando conversación:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// DELETE - Eliminar conversación (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    // Soft delete: marcar como eliminada en lugar de borrar
    const isAdmin = session.user.role === "admin";
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE conversations SET deleted_at = NOW() WHERE id = ? ${isAdmin ? "" : "AND user_id = ?"} AND deleted_at IS NULL`,
      isAdmin ? [id] : [id, session.user.id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { error: "Conversación no encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando conversación:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
