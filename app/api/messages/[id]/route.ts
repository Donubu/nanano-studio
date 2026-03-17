import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface MessageRow extends RowDataPacket {
  id: number;
  conversation_id: number;
  project_id: number | null;
  user_id: number;
  deleted_at: string | null;
}

// GET - Get a single message
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

    const [messages] = await pool.execute<MessageRow[]>(`
      SELECT m.*, c.project_id, c.user_id
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id = ?
    `, [id]);

    if (messages.length === 0) {
      return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
    }

    const message = messages[0];

    return NextResponse.json(message);
  } catch (error) {
    console.error("Error fetching message:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// DELETE - Soft delete a message
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

    // Verify user has access to message
    const [messages] = await pool.execute<MessageRow[]>(`
      SELECT m.id, m.conversation_id, c.project_id, c.user_id, m.deleted_at
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id = ?
    `, [id]);

    if (messages.length === 0) {
      return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
    }

    const message = messages[0];

    // Check if already deleted
    if (message.deleted_at) {
      return NextResponse.json({ error: "El mensaje ya está eliminado" }, { status: 400 });
    }

    // Soft delete
    await pool.execute<ResultSetHeader>(
      "UPDATE messages SET deleted_at = NOW() WHERE id = ?",
      [id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting message:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PATCH - Restore a soft-deleted message
export async function PATCH(
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
    const { action } = body;

    if (action !== "restore") {
      return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
    }

    // Verify user has access to message
    const [messages] = await pool.execute<MessageRow[]>(`
      SELECT m.id, m.conversation_id, c.project_id, c.user_id, m.deleted_at
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id = ?
    `, [id]);

    if (messages.length === 0) {
      return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
    }

    const message = messages[0];

    // Check if not deleted
    if (!message.deleted_at) {
      return NextResponse.json({ error: "El mensaje no está eliminado" }, { status: 400 });
    }

    // Restore
    await pool.execute<ResultSetHeader>(
      "UPDATE messages SET deleted_at = NULL WHERE id = ?",
      [id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error restoring message:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
