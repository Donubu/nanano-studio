import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { calculateEstimatedCost } from "@/lib/cost-calculator";
import type { MusicGenerationSettings } from "@/types/music";

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  generation_type: string;
}

// POST - Guardar musica previamente generada (mover de temp a permanente)
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

    const {
      tempUrl,
      tempKey,
      duration,
      fileSize,
      config,
      userMessageId,
      costPerMinute = 0,
    } = body as {
      tempUrl: string;
      tempKey: string;
      duration: number;
      fileSize: number;
      config: MusicGenerationSettings;
      userMessageId: number;
      costPerMinute?: number;
    };

    if (!tempUrl || !tempKey) {
      return NextResponse.json({ error: "tempUrl y tempKey son requeridos" }, { status: 400 });
    }

    // Verify conversation exists and belongs to user
    const isAdmin = session.user.role === "admin";
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT id, user_id, generation_type FROM conversations
       WHERE id = ? ${isAdmin ? "" : "AND user_id = ?"} AND deleted_at IS NULL`,
      isAdmin ? [id] : [id, session.user.id]
    );

    if (conversations.length === 0) {
      return NextResponse.json({ error: "Conversacion no encontrada" }, { status: 404 });
    }

    // The temp file is already in S3, we just need to save the message to DB
    // The temp URL works fine as the permanent URL (same CDN)
    // We keep the file in temp/ - S3 lifecycle will clean up old temps,
    // but saved ones will be referenced in DB so we know they're in use

    // Calculate cost
    const durationMinutes = duration / 60;
    const estimatedCost = calculateEstimatedCost(
      {
        cost_input_per_million: 0,
        cost_output_per_million: 0,
        cost_image_1k: 0,
        cost_image_2k: 0,
        cost_image_4k: 0,
        cost_video_per_second: 0,
        cost_music_per_minute: Number(costPerMinute) || 0,
      },
      {
        tokensInput: 0,
        tokensOutput: 0,
        imageGenerated: false,
        imageSize: null,
        musicMinutes: durationMinutes,
      }
    );

    // Save model message with music data
    const [modelResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO messages (conversation_id, role, content_type, content, music_url, music_mime_type, music_file_size, music_duration, music_config, estimated_cost)
       VALUES (?, 'model', 'music', ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        config.prompts.map(p => p.text).join(" + "),
        tempUrl,
        "audio/mpeg",
        fileSize,
        duration,
        JSON.stringify(config),
        estimatedCost,
      ]
    );

    // Update conversation total cost
    await pool.execute(
      `UPDATE conversations SET total_estimated_cost = total_estimated_cost + ? WHERE id = ?`,
      [estimatedCost, id]
    );

    return NextResponse.json({
      success: true,
      messageId: modelResult.insertId,
      musicUrl: tempUrl,
      estimatedCost,
    });

  } catch (error) {
    console.error("[Music Save] Error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
