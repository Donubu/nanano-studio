import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

// GET - Get collection details with all its generation items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; collectionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id, collectionId } = await params;
    const conversationId = parseInt(id);
    const colId = parseInt(collectionId);
    const isAdmin = session.user.role === "admin";

    // Verify conversation + collection access
    const [colRows] = await pool.execute<RowDataPacket[]>(
      `SELECT c.id, c.name, c.created_at
       FROM collections c
       JOIN conversations conv ON c.conversation_id = conv.id
       WHERE c.id = ? AND c.conversation_id = ? ${isAdmin ? "" : "AND conv.user_id = ?"}`,
      isAdmin ? [colId, conversationId] : [colId, conversationId, session.user.id]
    );
    if (colRows.length === 0) {
      return NextResponse.json({ error: "Colección no encontrada" }, { status: 404 });
    }

    const collection = colRows[0];

    // Fetch items with full generation data (same fields as generations endpoint)
    const [items] = await pool.execute<RowDataPacket[]>(
      `SELECT
        m.id,
        m.conversation_id,
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
        m.audio_url, m.audio_mime_type, m.audio_file_size, m.audio_duration,
        m.created_at,
        m.deleted_at,
        ci.sort_order
      FROM collection_items ci
      JOIN messages m ON ci.message_id = m.id
      LEFT JOIN models mo ON m.model_id = mo.id
      WHERE ci.collection_id = ?
      ORDER BY ci.sort_order ASC, ci.added_at ASC`,
      [colId]
    );

    // Fetch tags for items
    const messageIds = items.map((r: RowDataPacket) => r.id);
    let tagMap: Record<number, { id: number; name: string; color: string }[]> = {};
    if (messageIds.length > 0) {
      const [tagRows] = await pool.execute<RowDataPacket[]>(
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

    // Fetch reference images
    const userMessageIds = [...new Set(items.map((r: RowDataPacket) => r.user_message_id).filter(Boolean) as number[])];
    let refImageMap: Record<number, { url: string; mime_type: string | null }[]> = {};
    if (userMessageIds.length > 0) {
      const [imgRows] = await pool.execute<RowDataPacket[]>(
        `SELECT message_id, image_url, mime_type FROM message_images WHERE message_id IN (${userMessageIds.map(() => "?").join(",")}) ORDER BY sort_order ASC`,
        userMessageIds
      );
      for (const ir of imgRows) {
        if (!refImageMap[ir.message_id]) refImageMap[ir.message_id] = [];
        refImageMap[ir.message_id].push({ url: ir.image_url, mime_type: ir.mime_type });
      }
    }

    const generations = items.map((row: RowDataPacket) => ({
      type: row.video_url ? "video" : "image",
      id: row.id,
      conversation_id: row.conversation_id,
      conversation_user_id: 0,
      conversation_title: "",
      user_name: null,
      user_image: null,
      content: row.content,
      quality_tier: row.quality_tier,
      model_name: row.model_name,
      model_id: row.model_id_value,
      generation_seed: row.generation_seed,
      is_favorite: !!row.is_favorite,
      reference_images: row.user_message_id ? (refImageMap[row.user_message_id] || []) : [],
      image_url: row.image_url,
      image_mime_type: row.image_mime_type,
      image_file_size: row.image_file_size,
      image_aspect_ratio: row.image_aspect_ratio,
      image_size: row.image_size,
      has_2x: !!row.has_2x,
      video_url: row.video_url,
      video_mime_type: row.video_mime_type,
      video_file_size: row.video_file_size,
      video_duration: row.video_duration,
      video_has_audio: row.video_has_audio != null ? !!row.video_has_audio : null,
      video_aspect_ratio: row.video_aspect_ratio,
      audio_url: row.audio_url,
      audio_mime_type: row.audio_mime_type,
      audio_file_size: row.audio_file_size,
      audio_duration: row.audio_duration,
      audio_voice_config: null,
      music_url: null, music_mime_type: null, music_file_size: null, music_duration: null, music_config: null,
      created_at: row.created_at,
      deleted_at: row.deleted_at,
      tags: tagMap[row.id] || [],
    }));

    return NextResponse.json({
      collection: { id: collection.id, name: collection.name, created_at: collection.created_at },
      generations,
    });
  } catch (error) {
    console.error("[Collections] Error getting:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// PATCH - Rename collection
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; collectionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id, collectionId } = await params;
    const conversationId = parseInt(id);
    const colId = parseInt(collectionId);
    const isAdmin = session.user.role === "admin";

    const [convRows] = await pool.execute<RowDataPacket[]>(
      `SELECT c.id FROM collections c
       JOIN conversations conv ON c.conversation_id = conv.id
       WHERE c.id = ? AND c.conversation_id = ? ${isAdmin ? "" : "AND conv.user_id = ?"}`,
      isAdmin ? [colId, conversationId] : [colId, conversationId, session.user.id]
    );
    if (convRows.length === 0) {
      return NextResponse.json({ error: "Colección no encontrada" }, { status: 404 });
    }

    const body = await request.json();
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
    }

    await pool.execute(`UPDATE collections SET name = ? WHERE id = ?`, [name, colId]);

    return NextResponse.json({ id: colId, name });
  } catch (error) {
    console.error("[Collections] Error renaming:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// DELETE - Delete collection (items return to main grid)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; collectionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id, collectionId } = await params;
    const conversationId = parseInt(id);
    const colId = parseInt(collectionId);
    const isAdmin = session.user.role === "admin";

    const [convRows] = await pool.execute<RowDataPacket[]>(
      `SELECT c.id FROM collections c
       JOIN conversations conv ON c.conversation_id = conv.id
       WHERE c.id = ? AND c.conversation_id = ? ${isAdmin ? "" : "AND conv.user_id = ?"}`,
      isAdmin ? [colId, conversationId] : [colId, conversationId, session.user.id]
    );
    if (convRows.length === 0) {
      return NextResponse.json({ error: "Colección no encontrada" }, { status: 404 });
    }

    await pool.execute(`DELETE FROM collections WHERE id = ?`, [colId]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Collections] Error deleting:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
