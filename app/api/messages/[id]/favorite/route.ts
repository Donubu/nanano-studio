import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface MessageRow extends RowDataPacket {
  id: number;
  conversation_id: number;
  project_id: number | null;
  user_id: number;
  is_favorite: number;
}

// POST - Toggle favorite status (global within project)
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

    // Verify user has access to message
    const [messages] = await pool.execute<MessageRow[]>(`
      SELECT m.id, m.conversation_id, c.project_id, c.user_id, m.is_favorite
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id = ? AND m.deleted_at IS NULL
    `, [id]);

    if (messages.length === 0) {
      return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
    }

    const message = messages[0];

    // Toggle favorite status
    const newFavoriteStatus = message.is_favorite ? 0 : 1;

    await pool.execute<ResultSetHeader>(
      "UPDATE messages SET is_favorite = ? WHERE id = ?",
      [newFavoriteStatus, id]
    );

    return NextResponse.json({
      id: Number(id),
      is_favorite: Boolean(newFavoriteStatus),
    });
  } catch (error) {
    console.error("Error toggling favorite:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// GET - Get favorite status
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

    // Verify user has access to message
    const [messages] = await pool.execute<MessageRow[]>(`
      SELECT m.id, m.conversation_id, c.project_id, c.user_id, m.is_favorite
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id = ? AND m.deleted_at IS NULL
    `, [id]);

    if (messages.length === 0) {
      return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
    }

    const message = messages[0];

    return NextResponse.json({
      id: Number(id),
      is_favorite: Boolean(message.is_favorite),
    });
  } catch (error) {
    console.error("Error getting favorite status:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
