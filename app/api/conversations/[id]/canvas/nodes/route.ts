import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface ConversationCheckRow extends RowDataPacket {
  id: number;
  user_id: number;
}

// PATCH - Update specific node fields (status, output, error)
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
    const isAdmin = session.user.role === "admin";

    const [convRows] = await pool.execute<ConversationCheckRow[]>(
      `SELECT id, user_id FROM conversations WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (convRows.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const body = await request.json();
    const { nodeId, updates } = body as {
      nodeId: string;
      updates: {
        status?: string;
        output_message_id?: number | null;
        output_url?: string | null;
        output_text?: string | null;
        error_message?: string | null;
        config?: Record<string, unknown>;
        label?: string;
      };
    };

    if (!nodeId) {
      return NextResponse.json({ error: "nodeId requerido" }, { status: 400 });
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      setClauses.push("status = ?");
      values.push(updates.status);
    }
    if (updates.output_message_id !== undefined) {
      setClauses.push("output_message_id = ?");
      values.push(updates.output_message_id);
    }
    if (updates.output_url !== undefined) {
      setClauses.push("output_url = ?");
      values.push(updates.output_url);
    }
    if (updates.output_text !== undefined) {
      setClauses.push("output_text = ?");
      values.push(updates.output_text);
    }
    if (updates.error_message !== undefined) {
      setClauses.push("error_message = ?");
      values.push(updates.error_message);
    }
    if (updates.config !== undefined) {
      setClauses.push("config = ?");
      values.push(JSON.stringify(updates.config));
    }
    if (updates.label !== undefined) {
      setClauses.push("label = ?");
      values.push(updates.label);
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
    }

    values.push(nodeId, id);

    await pool.execute(
      `UPDATE canvas_nodes SET ${setClauses.join(", ")} WHERE id = ? AND conversation_id = ?`,
      values
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating canvas node:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
