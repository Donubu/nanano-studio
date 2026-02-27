import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { deleteFromS3 } from "@/lib/s3";

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
}

// POST - Descartar musica temporal (eliminar de S3)
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

    const { tempKey } = body as { tempKey: string };

    if (!tempKey) {
      return NextResponse.json({ error: "tempKey es requerido" }, { status: 400 });
    }

    // Verify conversation exists and belongs to user
    const isAdmin = session.user.role === "admin";
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT id, user_id FROM conversations
       WHERE id = ? ${isAdmin ? "" : "AND user_id = ?"} AND deleted_at IS NULL`,
      isAdmin ? [id] : [id, session.user.id]
    );

    if (conversations.length === 0) {
      return NextResponse.json({ error: "Conversacion no encontrada" }, { status: 404 });
    }

    // Delete temp file from S3
    const deleted = await deleteFromS3(tempKey);

    if (!deleted) {
      console.warn("[Music Discard] Could not delete temp file:", tempKey);
    }

    return NextResponse.json({ success: true, deleted });

  } catch (error) {
    console.error("[Music Discard] Error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
