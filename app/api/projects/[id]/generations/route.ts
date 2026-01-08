import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface GenerationRow extends RowDataPacket {
  id: number;
  conversation_id: number;
  conversation_user_id: number;
  conversation_title: string;
  content: string | null;
  image_url: string | null;
  image_mime_type: string | null;
  image_file_size: number | null;
  image_aspect_ratio: string | null;
  image_size: string | null;
  video_url: string | null;
  video_mime_type: string | null;
  video_file_size: number | null;
  video_duration: number | null;
  video_has_audio: boolean | null;
  video_aspect_ratio: string | null;
  audio_url: string | null;
  audio_mime_type: string | null;
  audio_file_size: number | null;
  audio_duration: number | null;
  audio_voice_config: string | null;
  created_at: string;
  deleted_at: string | null;
  tags: string | null; // JSON string of tags
}

interface TagInfo {
  id: number;
  name: string;
  color: string;
}

// GET - Obtener todas las generaciones (imágenes, videos y audios) del proyecto con filtros
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const { searchParams } = new URL(request.url);

    // Filter parameters
    const type = searchParams.get("type"); // "images", "videos", "audios", or null for all
    const tagIds = searchParams.get("tags")?.split(",").filter(Boolean).map(Number) || [];
    const search = searchParams.get("search")?.trim() || "";
    const dateFrom = searchParams.get("from");
    const dateTo = searchParams.get("to");
    const includeDeleted = searchParams.get("include_deleted") === "true";
    const limit = Math.min(Number(searchParams.get("limit")) || 100, 500);
    const offset = Number(searchParams.get("offset")) || 0;

    // Verificar que el usuario tiene acceso al proyecto (admin o asignado)
    const isAdmin = session.user.role === "admin";

    if (!isAdmin) {
      const [projectAccess] = await pool.execute<RowDataPacket[]>(
        `SELECT pu.id FROM project_users pu
         WHERE pu.project_id = ? AND pu.user_id = ?`,
        [projectId, session.user.id]
      );

      if (projectAccess.length === 0) {
        return NextResponse.json(
          { error: "Proyecto no encontrado o sin acceso" },
          { status: 404 }
        );
      }
    }

    // Build WHERE conditions
    const conditions: string[] = [
      "c.project_id = ?",
      "m.role = 'model'",
    ];
    const queryParams: (string | number)[] = [projectId];

    // Type filter
    if (type === "images") {
      conditions.push("m.image_url IS NOT NULL AND m.image_url != ''");
    } else if (type === "videos") {
      conditions.push("m.video_url IS NOT NULL AND m.video_url != ''");
    } else if (type === "audios") {
      conditions.push("m.audio_url IS NOT NULL AND m.audio_url != ''");
    } else {
      // All generations (images OR videos OR audios)
      conditions.push("((m.image_url IS NOT NULL AND m.image_url != '') OR (m.video_url IS NOT NULL AND m.video_url != '') OR (m.audio_url IS NOT NULL AND m.audio_url != ''))");
    }

    // Soft delete filter
    if (!includeDeleted) {
      conditions.push("m.deleted_at IS NULL");
    }

    // Search filter (in conversation title or message content)
    if (search) {
      conditions.push("(c.title LIKE ? OR m.content LIKE ?)");
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    // Date range filter
    if (dateFrom) {
      conditions.push("m.created_at >= ?");
      queryParams.push(dateFrom);
    }
    if (dateTo) {
      conditions.push("m.created_at <= ?");
      queryParams.push(dateTo + " 23:59:59");
    }

    // Tag filter - if tags specified, only include messages that have ALL specified tags
    let tagJoin = "";
    const tagParams: (string | number)[] = [];
    if (tagIds.length > 0) {
      tagJoin = `
        INNER JOIN (
          SELECT message_id
          FROM message_tags
          WHERE tag_id IN (${tagIds.map(() => "?").join(",")})
          GROUP BY message_id
          HAVING COUNT(DISTINCT tag_id) = ?
        ) tag_filter ON m.id = tag_filter.message_id
      `;
      tagParams.push(...tagIds, tagIds.length);
    }

    // Build final params array: tag params first (for JOIN), then condition params (for WHERE)
    const finalQueryParams = [...tagParams, ...queryParams];

    // Get total count first
    const countQuery = `
      SELECT COUNT(DISTINCT m.id) as total
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      ${tagJoin}
      WHERE ${conditions.join(" AND ")}
    `;

    const [countResult] = await pool.execute<RowDataPacket[]>(countQuery, finalQueryParams);
    const total = countResult[0]?.total || 0;

    // Main query with tags aggregation
    const mainQuery = `
      SELECT
        m.id,
        c.id as conversation_id,
        c.user_id as conversation_user_id,
        c.title as conversation_title,
        m.content,
        m.image_url,
        m.image_mime_type,
        m.image_file_size,
        COALESCE(m.image_aspect_ratio, c.image_aspect_ratio) as image_aspect_ratio,
        COALESCE(m.image_size, c.image_size) as image_size,
        m.video_url,
        m.video_mime_type,
        m.video_file_size,
        m.video_duration,
        m.video_has_audio,
        COALESCE(m.video_aspect_ratio, c.video_aspect_ratio, '16:9') as video_aspect_ratio,
        m.audio_url,
        m.audio_mime_type,
        m.audio_file_size,
        m.audio_duration,
        m.audio_voice_config,
        m.created_at,
        m.deleted_at,
        (
          SELECT JSON_ARRAYAGG(JSON_OBJECT('id', t.id, 'name', t.name, 'color', t.color))
          FROM message_tags mt
          JOIN tags t ON mt.tag_id = t.id
          WHERE mt.message_id = m.id
        ) as tags
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      ${tagJoin}
      WHERE ${conditions.join(" AND ")}
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `;

    // Add limit and offset to params (use finalQueryParams for correct order)
    const mainQueryParams = [...finalQueryParams, limit, offset];

    const [generations] = await pool.execute<GenerationRow[]>(mainQuery, mainQueryParams);

    // Parse tags JSON and transform response
    const result = generations.map(gen => {
      // Determine type: video > audio > image (priority order)
      let type: "video" | "audio" | "image" = "image";
      if (gen.video_url) {
        type = "video";
      } else if (gen.audio_url) {
        type = "audio";
      }

      return {
        ...gen,
        tags: gen.tags ? JSON.parse(gen.tags) as TagInfo[] : [],
        audio_voice_config: gen.audio_voice_config ? JSON.parse(gen.audio_voice_config) : null,
        type,
      };
    });

    return NextResponse.json({
      data: result,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + result.length < total,
      },
    });
  } catch (error) {
    console.error("Error obteniendo generaciones:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
