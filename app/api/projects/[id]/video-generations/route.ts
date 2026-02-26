import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface VideoGenerationRow extends RowDataPacket {
  id: number;
  conversation_id: number;
  conversation_user_id: number;
  conversation_title: string;
  video_url: string;
  video_mime_type: string;
  video_file_size: number | null;
  video_duration: number | null;
  video_has_audio: boolean;
  video_aspect_ratio: string;
  created_at: Date;
}

// GET - Obtener todos los videos generados en el proyecto
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: projectId } = await params;

    // Obtener todos los videos generados del proyecto (compartidos entre usuarios del proyecto)
    const [generations] = await pool.execute<VideoGenerationRow[]>(
      `SELECT
        m.id,
        m.conversation_id,
        c.user_id as conversation_user_id,
        c.title as conversation_title,
        m.video_url,
        m.video_mime_type,
        m.video_file_size,
        m.video_duration,
        m.video_has_audio,
        COALESCE(m.video_aspect_ratio, c.video_aspect_ratio, '16:9') as video_aspect_ratio,
        m.created_at
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.project_id = ?
        AND m.role = 'model'
        AND m.video_url IS NOT NULL
        AND m.video_url != ''
      ORDER BY m.created_at DESC`,
      [projectId]
    );

    return NextResponse.json(generations);
  } catch (error) {
    console.error("Error obteniendo videos:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
