import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";

// POST - Create placeholder message(s) with status='generating'
// Used by FullModeWorkspace so other users see generation in progress
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
    const { type, count = 1, aspectRatio, size } = body as {
      type: "image" | "video";
      count?: number;
      aspectRatio?: string;
      size?: string;
    };

    // Verify conversation exists
    const [conv] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM conversations WHERE id = ? AND deleted_at IS NULL",
      [id]
    );
    if (conv.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const ids: number[] = [];
    for (let i = 0; i < Math.min(count, 10); i++) {
      const [result] = await pool.execute<ResultSetHeader>(
        `INSERT INTO messages (conversation_id, user_id, role, status, content_type, content${type === "image" ? ", image_aspect_ratio, image_size" : ", video_aspect_ratio"})
         VALUES (?, ?, 'model', 'generating', ?, ''${type === "image" ? ", ?, ?" : ", ?"})`,
        type === "image"
          ? [id, session.user.id, type, aspectRatio || "16:9", size || "1K"]
          : [id, session.user.id, type, aspectRatio || "16:9"]
      );
      ids.push(result.insertId);
    }

    return NextResponse.json({ ids });
  } catch (error) {
    console.error("Error creating placeholder:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

// DELETE - Clean up placeholder messages (when generation completes or fails)
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
    const body = await request.json();
    const { ids } = body as { ids: number[] };

    if (ids && ids.length > 0) {
      await pool.execute(
        `DELETE FROM messages WHERE id IN (${ids.map(() => "?").join(",")}) AND conversation_id = ? AND status = 'generating'`,
        [...ids, id]
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error deleting placeholders:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
