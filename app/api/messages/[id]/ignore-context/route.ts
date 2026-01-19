import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface MessageRow extends RowDataPacket {
  id: number;
  conversation_id: number;
  project_id: number | null;
  user_id: number;
  ignore_in_context: number;
}

// POST - Toggle ignore_in_context status
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
      SELECT m.id, m.conversation_id, c.project_id, c.user_id, m.ignore_in_context
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id = ? AND m.deleted_at IS NULL
    `, [id]);

    if (messages.length === 0) {
      return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
    }

    const message = messages[0];

    // Check access (admin, owner, or project member)
    if (session.user.role !== "admin" && message.user_id !== session.user.id) {
      if (message.project_id) {
        const [access] = await pool.execute<RowDataPacket[]>(
          "SELECT id FROM project_users WHERE project_id = ? AND user_id = ?",
          [message.project_id, session.user.id]
        );
        if (access.length === 0) {
          return NextResponse.json({ error: "No autorizado" }, { status: 403 });
        }
      } else {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
    }

    // Toggle ignore_in_context status
    const newIgnoreStatus = message.ignore_in_context ? 0 : 1;

    await pool.execute<ResultSetHeader>(
      "UPDATE messages SET ignore_in_context = ? WHERE id = ?",
      [newIgnoreStatus, id]
    );

    return NextResponse.json({
      id: Number(id),
      ignore_in_context: Boolean(newIgnoreStatus),
    });
  } catch (error) {
    console.error("Error toggling ignore_in_context:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
