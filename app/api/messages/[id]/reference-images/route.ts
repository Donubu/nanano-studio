import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

// GET - Get reference images for a model message (finds the previous user message's images)
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

    // Find the model message
    const [modelMessages] = await pool.execute<RowDataPacket[]>(
      `SELECT m.id, m.conversation_id, m.role
       FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE m.id = ?`,
      [id]
    );

    if (modelMessages.length === 0) {
      return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
    }

    const modelMsg = modelMessages[0];

    // Find the previous user message in the same conversation
    const [userMessages] = await pool.execute<RowDataPacket[]>(
      `SELECT id, image_url, image_mime_type
       FROM messages
       WHERE conversation_id = ? AND id < ? AND role = 'user'
       ORDER BY id DESC
       LIMIT 1`,
      [modelMsg.conversation_id, modelMsg.id]
    );

    if (userMessages.length === 0) {
      return NextResponse.json({ images: [] });
    }

    const userMsg = userMessages[0];

    // Try message_images table first
    const [messageImages] = await pool.execute<RowDataPacket[]>(
      `SELECT image_url, mime_type FROM message_images WHERE message_id = ? ORDER BY sort_order ASC`,
      [userMsg.id]
    );

    if (messageImages.length > 0) {
      return NextResponse.json({
        images: messageImages.map((img: RowDataPacket) => ({
          url: img.image_url,
          mime_type: img.mime_type,
        })),
      });
    }

    // Fallback: use image_url from messages table (legacy data)
    if (userMsg.image_url) {
      return NextResponse.json({
        images: [{ url: userMsg.image_url, mime_type: userMsg.image_mime_type }],
      });
    }

    return NextResponse.json({ images: [] });
  } catch (error) {
    console.error("Error fetching reference images:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
