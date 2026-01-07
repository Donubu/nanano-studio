import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface MessageTagRow extends RowDataPacket {
  id: number;
  tag_id: number;
  tag_name: string;
  tag_color: string;
}

interface MessageRow extends RowDataPacket {
  id: number;
  conversation_id: number;
  project_id: number | null;
  user_id: number;
}

// GET - Get all tags for a message
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
      SELECT m.id, m.conversation_id, c.project_id, c.user_id
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

    // Get tags for this message
    const [tags] = await pool.execute<MessageTagRow[]>(`
      SELECT mt.id, mt.tag_id, t.name as tag_name, t.color as tag_color
      FROM message_tags mt
      JOIN tags t ON mt.tag_id = t.id
      WHERE mt.message_id = ?
      ORDER BY t.name ASC
    `, [id]);

    return NextResponse.json(tags);
  } catch (error) {
    console.error("Error fetching message tags:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// POST - Add tag to message
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
    const body = await request.json();
    const { tag_id } = body;

    if (!tag_id) {
      return NextResponse.json(
        { error: "El tag_id es requerido" },
        { status: 400 }
      );
    }

    // Verify user has access to message
    const [messages] = await pool.execute<MessageRow[]>(`
      SELECT m.id, m.conversation_id, c.project_id, c.user_id
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id = ? AND m.deleted_at IS NULL
    `, [id]);

    if (messages.length === 0) {
      return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
    }

    const message = messages[0];

    // Check access
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

    // Verify tag belongs to same project
    const [tagCheck] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM tags WHERE id = ? AND project_id = ?",
      [tag_id, message.project_id]
    );

    if (tagCheck.length === 0) {
      return NextResponse.json(
        { error: "La etiqueta no pertenece a este proyecto" },
        { status: 400 }
      );
    }

    // Check if already assigned
    const [existing] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM message_tags WHERE message_id = ? AND tag_id = ?",
      [id, tag_id]
    );

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "La etiqueta ya está asignada" },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO message_tags (message_id, tag_id) VALUES (?, ?)",
      [id, tag_id]
    );

    return NextResponse.json(
      { id: result.insertId, message_id: Number(id), tag_id },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error adding tag to message:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// DELETE - Remove tag from message
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
    const { searchParams } = new URL(request.url);
    const tagId = searchParams.get("tag_id");

    if (!tagId) {
      return NextResponse.json(
        { error: "El tag_id es requerido" },
        { status: 400 }
      );
    }

    // Verify user has access to message
    const [messages] = await pool.execute<MessageRow[]>(`
      SELECT m.id, m.conversation_id, c.project_id, c.user_id
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.id = ? AND m.deleted_at IS NULL
    `, [id]);

    if (messages.length === 0) {
      return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
    }

    const message = messages[0];

    // Check access
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

    const [result] = await pool.execute<ResultSetHeader>(
      "DELETE FROM message_tags WHERE message_id = ? AND tag_id = ?",
      [id, tagId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Etiqueta no encontrada en este mensaje" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing tag from message:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
