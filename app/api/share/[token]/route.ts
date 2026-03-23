import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface GenerationRow extends RowDataPacket {
  id: number;
  content: string | null;
  is_favorite: boolean;
  image_url: string | null;
  image_mime_type: string | null;
  image_aspect_ratio: string | null;
  image_size: string | null;
  has_2x: boolean;
  video_url: string | null;
  video_mime_type: string | null;
  video_duration: number | null;
  video_has_audio: boolean | null;
  video_aspect_ratio: string | null;
  status: string | null;
  content_type: string | null;
  model_content: string | null;
  model_thought: string | null;
  created_at: string;
}

interface TagRow extends RowDataPacket {
  message_id: number;
  tag_id: number;
  tag_name: string;
  tag_color: string;
}

// GET - Public endpoint for viewing shared conversation generations
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Validate token format (base64url, ~43 chars)
    if (!token || token.length < 20 || token.length > 100) {
      return notFoundResponse();
    }

    // Find conversation by share_token
    const [convRows] = await pool.execute<RowDataPacket[]>(
      `SELECT c.id, c.title, c.created_at,
        (SELECT COUNT(*) FROM share_visits sv WHERE sv.conversation_id = c.id) as visit_count
       FROM conversations c
       WHERE c.share_token = ? AND c.deleted_at IS NULL`,
      [token]
    );

    if (convRows.length === 0) {
      return notFoundResponse();
    }

    const conv = convRows[0];
    const conversationId = conv.id;

    // Log visit (dedup: max 1 per IP per conversation per hour)
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown";
    const userAgent = request.headers.get("user-agent") || null;
    const referer = request.headers.get("referer") || null;

    try {
      await pool.execute(
        `INSERT INTO share_visits (conversation_id, ip_address, user_agent, referer)
         SELECT ?, ?, ?, ?
         FROM DUAL
         WHERE NOT EXISTS (
           SELECT 1 FROM share_visits
           WHERE conversation_id = ? AND ip_address = ?
             AND visited_at > NOW() - INTERVAL 1 HOUR
         )`,
        [conversationId, ip, userAgent, referer, conversationId, ip]
      );
    } catch {
      // Non-critical: don't fail the request if visit logging fails
    }

    // Support incremental polling: ?after=<ISO timestamp>
    const { searchParams } = new URL(request.url);
    const after = searchParams.get("after");
    const typeFilter = searchParams.get("type");
    const collectionId = searchParams.get("collection");

    // Fetch collections for this conversation
    const [collectionRows] = await pool.execute<RowDataPacket[]>(
      `SELECT c.id, c.name, c.created_at,
        COUNT(ci.id) as item_count,
        (SELECT m.image_url FROM collection_items ci2
         JOIN messages m ON ci2.message_id = m.id
         WHERE ci2.collection_id = c.id
         ORDER BY ci2.sort_order ASC, ci2.added_at ASC LIMIT 1) as thumbnail_image_url,
        (SELECT m.video_url FROM collection_items ci2
         JOIN messages m ON ci2.message_id = m.id
         WHERE ci2.collection_id = c.id
         ORDER BY ci2.sort_order ASC, ci2.added_at ASC LIMIT 1) as thumbnail_video_url
      FROM collections c
      LEFT JOIN collection_items ci ON ci.collection_id = c.id
      WHERE c.conversation_id = ?
      GROUP BY c.id
      ORDER BY c.created_at DESC`,
      [conversationId]
    );

    // Build WHERE conditions
    const conditions: string[] = [
      "m.conversation_id = ?",
      "m.role = 'model'",
      "m.deleted_at IS NULL",
    ];
    const queryParams: (string | number)[] = [conversationId];

    // If viewing a collection, filter to its items; otherwise exclude collection items
    if (collectionId) {
      conditions.push("EXISTS (SELECT 1 FROM collection_items ci WHERE ci.message_id = m.id AND ci.collection_id = ?)");
      queryParams.push(parseInt(collectionId));
    } else {
      conditions.push("NOT EXISTS (SELECT 1 FROM collection_items ci WHERE ci.message_id = m.id)");
    }

    // Media type filter
    if (typeFilter === "images") {
      conditions.push("(m.image_url IS NOT NULL OR (m.status = 'generating' AND m.content_type = 'image'))");
    } else if (typeFilter === "videos") {
      conditions.push("(m.video_url IS NOT NULL OR (m.status = 'generating' AND m.content_type = 'video'))");
    } else if (typeFilter === "texts") {
      conditions.push(`(m.content_type = 'text' AND m.ignore_in_context = 2 AND m.content IS NOT NULL AND m.content != ''
        AND m.image_url IS NULL AND m.video_url IS NULL)`);
    } else {
      conditions.push(`(m.image_url IS NOT NULL OR m.video_url IS NOT NULL OR m.status = 'generating'
        OR (m.content_type = 'text' AND m.ignore_in_context = 2 AND m.content IS NOT NULL AND m.content != ''
          AND m.image_url IS NULL AND m.video_url IS NULL))`);
    }

    // Incremental polling
    if (after) {
      conditions.push("m.created_at > ?");
      queryParams.push(after);
    }

    const whereClause = conditions.join(" AND ");

    // Fetch user messages for prompt resolution
    const [userMessages] = await pool.execute<RowDataPacket[]>(
      `SELECT id, content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY id ASC`,
      [conversationId]
    );

    // Fetch generations — sanitized: no user info, no costs, no model details
    const [rows] = await pool.execute<GenerationRow[]>(
      `SELECT
        m.id,
        m.content,
        m.is_favorite,
        m.image_url,
        m.image_mime_type,
        m.image_aspect_ratio,
        m.image_size,
        m.has_2x,
        m.video_url,
        m.video_mime_type,
        m.video_duration,
        m.video_has_audio,
        m.video_aspect_ratio,
        m.status,
        m.content_type,
        m.content as model_content,
        m.thought as model_thought,
        m.created_at
      FROM messages m
      WHERE ${whereClause}
      ORDER BY m.created_at DESC`,
      queryParams
    );

    // Resolve user message prompts
    const resolvePrompt = (modelMessageId: number, modelContent: string | null) => {
      if (modelContent && modelContent.startsWith("Archivo subido:")) {
        return modelContent;
      }
      for (let i = userMessages.length - 1; i >= 0; i--) {
        if (userMessages[i].id < modelMessageId) {
          return userMessages[i].content || null;
        }
      }
      return null;
    };

    // Fetch tags
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

    const generations = rows.map(row => ({
      type: row.video_url ? "video" as const
        : row.content_type === "video" ? "video" as const
        : (row.content_type === "text" && !row.image_url && !row.video_url) ? "text" as const
        : "image" as const,
      status: row.status || "completed",
      id: row.id,
      content: resolvePrompt(row.id, row.content),
      is_favorite: Boolean(row.is_favorite),
      image_url: row.image_url,
      image_mime_type: row.image_mime_type,
      image_aspect_ratio: row.image_aspect_ratio,
      image_size: row.image_size,
      has_2x: Boolean(row.has_2x),
      video_url: row.video_url,
      video_mime_type: row.video_mime_type,
      video_duration: row.video_duration,
      video_has_audio: row.video_has_audio != null ? Boolean(row.video_has_audio) : null,
      video_aspect_ratio: row.video_aspect_ratio,
      text_content: row.model_content || null,
      thought: row.model_thought || null,
      created_at: row.created_at,
      tags: tagMap[row.id] || [],
    }));

    const collections = collectionRows.map(c => ({
      id: c.id,
      name: c.name,
      item_count: c.item_count || 0,
      thumbnail_url: c.thumbnail_image_url || c.thumbnail_video_url || null,
      created_at: c.created_at,
    }));

    const response = NextResponse.json({
      title: conv.title,
      created_at: conv.created_at,
      generations,
      collections,
      total_count: generations.length,
      visit_count: conv.visit_count || 0,
    });

    // SEO protection headers
    response.headers.set("X-Robots-Tag", "noindex, nofollow");

    return response;
  } catch (error) {
    console.error("Error fetching shared conversation:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

function notFoundResponse() {
  return NextResponse.json(
    { error: "Estudio no encontrado" },
    { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow" } }
  );
}
