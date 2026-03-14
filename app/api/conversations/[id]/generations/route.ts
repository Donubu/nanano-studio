import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface GenerationRow extends RowDataPacket {
  id: number;
  conversation_id: number;
  conversation_user_id: number;
  conversation_title: string;
  user_name: string | null;
  user_image: string | null;
  content: string | null;
  quality_tier: string | null;
  model_name: string | null;
  model_id_value: number | null;
  generation_seed: number | null;
  user_message_id: number | null;
  is_favorite: boolean;
  image_url: string | null;
  image_mime_type: string | null;
  image_file_size: number | null;
  image_aspect_ratio: string | null;
  image_size: string | null;
  has_2x: boolean;
  video_url: string | null;
  video_mime_type: string | null;
  video_file_size: number | null;
  video_duration: number | null;
  video_has_audio: boolean | null;
  video_aspect_ratio: string | null;
  created_at: string;
  deleted_at: string | null;
}

interface TagRow extends RowDataPacket {
  message_id: number;
  tag_id: number;
  tag_name: string;
  tag_color: string;
}

// GET - Returns all image/video generations for a conversation
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
    const conversationId = parseInt(id);
    const isAdmin = session.user.role === "admin";

    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get("type"); // "images" | "videos"
    const favoritesOnly = searchParams.get("favorites") === "true";

    // Verify conversation access
    const [convRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, user_id, title FROM conversations WHERE id = ? ${isAdmin ? "" : "AND user_id = ?"}`,
      isAdmin ? [conversationId] : [conversationId, session.user.id]
    );
    if (convRows.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const conv = convRows[0];

    // Build WHERE conditions for media type
    const mediaConditions: string[] = [];
    if (typeFilter === "images") {
      mediaConditions.push("m.image_url IS NOT NULL");
    } else if (typeFilter === "videos") {
      mediaConditions.push("m.video_url IS NOT NULL");
    } else {
      mediaConditions.push("(m.image_url IS NOT NULL OR m.video_url IS NOT NULL)");
    }

    if (favoritesOnly) {
      mediaConditions.push("m.is_favorite = 1");
    }

    const whereClause = mediaConditions.join(" AND ");

    const [rows] = await pool.execute<GenerationRow[]>(
      `SELECT
        m.id,
        m.conversation_id,
        c.user_id as conversation_user_id,
        c.title as conversation_title,
        u.name as user_name,
        u.image as user_image,
        CASE
          WHEN m.content LIKE 'Archivo subido:%' THEN m.content
          ELSE (SELECT um.content FROM messages um WHERE um.conversation_id = m.conversation_id AND um.role = 'user' AND um.id < m.id ORDER BY um.id DESC LIMIT 1)
        END as content,
        m.quality_tier,
        mo.display_name as model_name,
        m.model_id as model_id_value,
        m.generation_seed,
        CASE
          WHEN m.content LIKE 'Archivo subido:%' THEN NULL
          ELSE (SELECT um.id FROM messages um WHERE um.conversation_id = m.conversation_id AND um.role = 'user' AND um.id < m.id ORDER BY um.id DESC LIMIT 1)
        END as user_message_id,
        m.is_favorite,
        m.image_url,
        m.image_mime_type,
        m.image_file_size,
        m.image_aspect_ratio,
        m.image_size,
        m.has_2x,
        m.video_url,
        m.video_mime_type,
        m.video_file_size,
        m.video_duration,
        m.video_has_audio,
        m.video_aspect_ratio,
        m.created_at,
        m.deleted_at
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN models mo ON m.model_id = mo.id
      WHERE m.conversation_id = ? AND m.role = 'model' AND ${whereClause}
      ORDER BY m.created_at DESC`,
      [conversationId]
    );

    // Fetch tags for all message IDs
    const messageIds = rows.map(r => r.id);
    let tagMap: Record<number, { id: number; name: string; color: string }[]> = {};

    if (messageIds.length > 0) {
      const [tagRows] = await pool.execute<TagRow[]>(
        `SELECT mt.message_id, t.id as tag_id, t.name as tag_name, t.color as tag_color
         FROM message_tags mt
         JOIN tags t ON mt.tag_id = t.id
         WHERE mt.message_id IN (${messageIds.map(() => "?").join(",")})`,
        messageIds
      );
      for (const tr of tagRows) {
        if (!tagMap[tr.message_id]) tagMap[tr.message_id] = [];
        tagMap[tr.message_id].push({ id: tr.tag_id, name: tr.tag_name, color: tr.tag_color });
      }
    }

    // Fetch reference images for user messages
    const userMessageIds = [...new Set(rows.map(r => r.user_message_id).filter(Boolean) as number[])];
    let refImageMap: Record<number, {url: string, mime_type: string | null}[]> = {};

    if (userMessageIds.length > 0) {
      // First try message_images table
      const [imgRows] = await pool.execute<RowDataPacket[]>(
        `SELECT message_id, image_url, mime_type FROM message_images WHERE message_id IN (${userMessageIds.map(() => "?").join(",")}) ORDER BY sort_order ASC`,
        userMessageIds
      );
      for (const ir of imgRows) {
        if (!refImageMap[ir.message_id]) refImageMap[ir.message_id] = [];
        refImageMap[ir.message_id].push({ url: ir.image_url, mime_type: ir.mime_type });
      }

      // Fallback: user messages with image_url but no message_images
      const missingIds = userMessageIds.filter(id => !refImageMap[id]);
      if (missingIds.length > 0) {
        const [fallbackRows] = await pool.execute<RowDataPacket[]>(
          `SELECT id, image_url, image_mime_type FROM messages WHERE id IN (${missingIds.map(() => "?").join(",")}) AND image_url IS NOT NULL`,
          missingIds
        );
        for (const fr of fallbackRows) {
          refImageMap[fr.id] = [{ url: fr.image_url, mime_type: fr.image_mime_type }];
        }
      }
    }

    const generations = rows.map(row => ({
      type: row.video_url ? "video" as const : "image" as const,
      id: row.id,
      conversation_id: row.conversation_id,
      conversation_user_id: row.conversation_user_id,
      conversation_title: row.conversation_title,
      user_name: row.user_name,
      user_image: row.user_image,
      content: row.content,
      quality_tier: row.quality_tier,
      model_name: row.model_name,
      model_id: row.model_id_value || null,
      generation_seed: row.generation_seed,
      reference_images: row.user_message_id ? (refImageMap[row.user_message_id] || []) : [],
      is_favorite: Boolean(row.is_favorite),
      image_url: row.image_url,
      image_mime_type: row.image_mime_type,
      image_file_size: row.image_file_size,
      image_aspect_ratio: row.image_aspect_ratio,
      image_size: row.image_size,
      has_2x: Boolean(row.has_2x),
      video_url: row.video_url,
      video_mime_type: row.video_mime_type,
      video_file_size: row.video_file_size,
      video_duration: row.video_duration,
      video_has_audio: row.video_has_audio != null ? Boolean(row.video_has_audio) : null,
      video_aspect_ratio: row.video_aspect_ratio,
      audio_url: null,
      audio_mime_type: null,
      audio_file_size: null,
      audio_duration: null,
      audio_voice_config: null,
      music_url: null,
      music_mime_type: null,
      music_file_size: null,
      music_duration: null,
      music_config: null,
      created_at: row.created_at,
      deleted_at: row.deleted_at,
      tags: tagMap[row.id] || [],
    }));

    return NextResponse.json(generations);
  } catch (error) {
    console.error("Error fetching conversation generations:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
