import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface CollectionRow extends RowDataPacket {
  id: number;
  conversation_id: number;
  name: string;
  item_count: number;
  thumbnail_image_url: string | null;
  thumbnail_video_url: string | null;
  created_at: string;
  search_text: string | null;
}

// GET - List all collections for a conversation
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
    // Verify conversation access
    const [convRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM conversations WHERE id = ?`,
      [conversationId]
    );
    if (convRows.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const [rows] = await pool.execute<CollectionRow[]>(
      `SELECT c.id, c.conversation_id, c.name, c.created_at,
        COUNT(ci.id) as item_count,
        (SELECT m.image_url FROM collection_items ci2
         JOIN messages m ON ci2.message_id = m.id
         WHERE ci2.collection_id = c.id
         ORDER BY ci2.sort_order ASC, ci2.added_at ASC LIMIT 1) as thumbnail_image_url,
        (SELECT m.video_url FROM collection_items ci2
         JOIN messages m ON ci2.message_id = m.id
         WHERE ci2.collection_id = c.id
         ORDER BY ci2.sort_order ASC, ci2.added_at ASC LIMIT 1) as thumbnail_video_url,
        (SELECT GROUP_CONCAT(COALESCE(
           (SELECT um.content FROM messages um WHERE um.conversation_id = m2.conversation_id AND um.role = 'user' AND um.id < m2.id ORDER BY um.id DESC LIMIT 1),
           m2.content
         ) SEPARATOR ' ')
         FROM collection_items ci3
         JOIN messages m2 ON ci3.message_id = m2.id
         WHERE ci3.collection_id = c.id) as search_text
      FROM collections c
      LEFT JOIN collection_items ci ON ci.collection_id = c.id
      WHERE c.conversation_id = ?
      GROUP BY c.id
      ORDER BY c.created_at DESC`,
      [conversationId]
    );

    return NextResponse.json({ collections: rows });
  } catch (error) {
    console.error("[Collections] Error listing:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// POST - Create a new collection
export async function POST(
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
    const [convRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM conversations WHERE id = ?`,
      [conversationId]
    );
    if (convRows.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const body = await request.json();
    const name = body.name?.trim() || "Sin nombre";

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO collections (conversation_id, name) VALUES (?, ?)`,
      [conversationId, name]
    );

    return NextResponse.json({
      id: result.insertId,
      conversation_id: conversationId,
      name,
      item_count: 0,
      thumbnail_image_url: null,
      thumbnail_video_url: null,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Collections] Error creating:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
