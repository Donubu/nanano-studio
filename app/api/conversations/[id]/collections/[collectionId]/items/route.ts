import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

// POST - Add items to collection
export async function POST(
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
    // Verify collection + conversation access
    const [colRows] = await pool.execute<RowDataPacket[]>(
      `SELECT c.id FROM collections c
       JOIN conversations conv ON c.conversation_id = conv.id
       WHERE c.id = ? AND c.conversation_id = ?`,
      [colId, conversationId]
    );
    if (colRows.length === 0) {
      return NextResponse.json({ error: "Colección no encontrada" }, { status: 404 });
    }

    const body = await request.json();
    const messageIds: number[] = body.messageIds;
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return NextResponse.json({ error: "messageIds requeridos" }, { status: 400 });
    }

    // Get current max sort_order
    const [maxRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COALESCE(MAX(sort_order), -1) as max_order FROM collection_items WHERE collection_id = ?`,
      [colId]
    );
    let sortOrder = (maxRows[0]?.max_order ?? -1) + 1;

    // Insert items (ignore duplicates)
    for (const msgId of messageIds) {
      try {
        await pool.execute<ResultSetHeader>(
          `INSERT IGNORE INTO collection_items (collection_id, message_id, sort_order) VALUES (?, ?, ?)`,
          [colId, msgId, sortOrder++]
        );
      } catch {
        // Skip duplicates
      }
    }

    // Return updated count and thumbnail
    const [countRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) as item_count FROM collection_items WHERE collection_id = ?`,
      [colId]
    );
    const [thumbRows] = await pool.execute<RowDataPacket[]>(
      `SELECT m.image_url as thumbnail_image_url, m.video_url as thumbnail_video_url
       FROM collection_items ci JOIN messages m ON ci.message_id = m.id
       WHERE ci.collection_id = ?
       ORDER BY ci.sort_order ASC LIMIT 1`,
      [colId]
    );

    return NextResponse.json({
      item_count: countRows[0]?.item_count || 0,
      thumbnail_image_url: thumbRows[0]?.thumbnail_image_url || null,
      thumbnail_video_url: thumbRows[0]?.thumbnail_video_url || null,
    });
  } catch (error) {
    console.error("[Collections] Error adding items:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// DELETE - Remove items from collection
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

    const [colRows] = await pool.execute<RowDataPacket[]>(
      `SELECT c.id FROM collections c
       JOIN conversations conv ON c.conversation_id = conv.id
       WHERE c.id = ? AND c.conversation_id = ?`,
      [colId, conversationId]
    );
    if (colRows.length === 0) {
      return NextResponse.json({ error: "Colección no encontrada" }, { status: 404 });
    }

    const body = await request.json();
    const messageIds: number[] = body.messageIds;
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return NextResponse.json({ error: "messageIds requeridos" }, { status: 400 });
    }

    await pool.execute(
      `DELETE FROM collection_items WHERE collection_id = ? AND message_id IN (${messageIds.map(() => "?").join(",")})`,
      [colId, ...messageIds]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Collections] Error removing items:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
