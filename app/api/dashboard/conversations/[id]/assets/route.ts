import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface AssetRow extends RowDataPacket {
  id: number;
  role: string;
  content: string | null;
  content_type: string;
  image_url: string | null;
  video_url: string | null;
  audio_url: string | null;
  music_url: string | null;
  created_at: string;
}

// GET - Get asset preview for a conversation (admin only)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Solo administradores" }, { status: 403 });
    }

    const { id } = await params;
    const conversationId = parseInt(id);

    // Get messages that have assets (images, videos, audio, music)
    const [assets] = await pool.execute<AssetRow[]>(
      `SELECT id, role, content, content_type, image_url, video_url, audio_url, music_url, created_at
       FROM messages
       WHERE conversation_id = ? AND deleted_at IS NULL
         AND (image_url IS NOT NULL OR video_url IS NOT NULL OR audio_url IS NOT NULL OR music_url IS NOT NULL)
       ORDER BY created_at ASC
       LIMIT 50`,
      [conversationId]
    );

    return NextResponse.json(assets);
  } catch (error) {
    console.error("Error fetching conversation assets:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
