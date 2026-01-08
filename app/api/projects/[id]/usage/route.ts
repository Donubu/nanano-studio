import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface LimitsRow extends RowDataPacket {
  max_monthly_image_normal: number;
  max_monthly_image_hq: number;
  max_monthly_video_normal: number;
  max_monthly_video_hq: number;
  max_monthly_audio_normal: number;
  max_monthly_audio_hq: number;
  max_monthly_text_normal: number;
  max_monthly_text_hq: number;
}

interface CountRow extends RowDataPacket {
  generation_type: string;
  quality_tier: string;
  count: number;
}

interface QualityUsage {
  used: number;
  limit: number;
  unlimited: boolean;
}

interface TypeUsage {
  normal: QualityUsage;
  hq: QualityUsage;
}

interface UsageResponse {
  text: TypeUsage;
  image: TypeUsage;
  video: TypeUsage;
  audio: TypeUsage;
}

// GET - Obtener uso del usuario en el proyecto (separado por tipo y calidad)
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

    // Admin no tiene límites
    if (session.user.role === "admin") {
      const unlimitedQuality: QualityUsage = { used: 0, limit: 0, unlimited: true };
      const unlimitedType: TypeUsage = { normal: unlimitedQuality, hq: unlimitedQuality };
      return NextResponse.json({
        text: unlimitedType,
        image: unlimitedType,
        video: unlimitedType,
        audio: unlimitedType,
      } as UsageResponse);
    }

    // Obtener límites del usuario en el proyecto
    const [limitsRows] = await pool.execute<LimitsRow[]>(`
      SELECT
        COALESCE(max_monthly_image_normal, 0) as max_monthly_image_normal,
        COALESCE(max_monthly_image_hq, 0) as max_monthly_image_hq,
        COALESCE(max_monthly_video_normal, 0) as max_monthly_video_normal,
        COALESCE(max_monthly_video_hq, 0) as max_monthly_video_hq,
        COALESCE(max_monthly_audio_normal, 0) as max_monthly_audio_normal,
        COALESCE(max_monthly_audio_hq, 0) as max_monthly_audio_hq,
        COALESCE(max_monthly_text_normal, 0) as max_monthly_text_normal,
        COALESCE(max_monthly_text_hq, 0) as max_monthly_text_hq
      FROM project_users
      WHERE project_id = ? AND user_id = ?
    `, [id, session.user.id]);

    if (limitsRows.length === 0) {
      return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
    }

    const limits = limitsRows[0];

    // Contar uso actual por tipo y calidad
    // Para texto: mensajes sin image_url, video_url, audio_url
    // Para imagen: mensajes con image_url
    // Para video: mensajes con video_url
    // Para audio: mensajes con audio_url
    const [countRows] = await pool.execute<CountRow[]>(`
      SELECT
        c.generation_type,
        COALESCE(m.quality_tier, 'normal') as quality_tier,
        COUNT(*) as count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.project_id = ?
        AND c.user_id = ?
        AND m.role = 'model'
        AND m.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
        AND (
          (c.generation_type = 'text' AND m.content IS NOT NULL AND m.image_url IS NULL AND m.video_url IS NULL AND m.audio_url IS NULL)
          OR (c.generation_type = 'image' AND m.image_url IS NOT NULL)
          OR (c.generation_type = 'video' AND m.video_url IS NOT NULL)
          OR (c.generation_type = 'audio' AND m.audio_url IS NOT NULL)
        )
      GROUP BY c.generation_type, m.quality_tier
    `, [id, session.user.id]);

    // Construir mapa de conteos
    const counts: Record<string, Record<string, number>> = {
      text: { normal: 0, hq: 0 },
      image: { normal: 0, hq: 0 },
      video: { normal: 0, hq: 0 },
      audio: { normal: 0, hq: 0 },
    };

    for (const row of countRows) {
      const type = row.generation_type || 'text';
      const quality = row.quality_tier || 'normal';
      if (counts[type] && (quality === 'normal' || quality === 'hq')) {
        counts[type][quality] = row.count;
      }
    }

    // Construir respuesta
    const response: UsageResponse = {
      text: {
        normal: {
          used: counts.text.normal,
          limit: limits.max_monthly_text_normal,
          unlimited: limits.max_monthly_text_normal === 0,
        },
        hq: {
          used: counts.text.hq,
          limit: limits.max_monthly_text_hq,
          unlimited: limits.max_monthly_text_hq === 0,
        },
      },
      image: {
        normal: {
          used: counts.image.normal,
          limit: limits.max_monthly_image_normal,
          unlimited: limits.max_monthly_image_normal === 0,
        },
        hq: {
          used: counts.image.hq,
          limit: limits.max_monthly_image_hq,
          unlimited: limits.max_monthly_image_hq === 0,
        },
      },
      video: {
        normal: {
          used: counts.video.normal,
          limit: limits.max_monthly_video_normal,
          unlimited: limits.max_monthly_video_normal === 0,
        },
        hq: {
          used: counts.video.hq,
          limit: limits.max_monthly_video_hq,
          unlimited: limits.max_monthly_video_hq === 0,
        },
      },
      audio: {
        normal: {
          used: counts.audio.normal,
          limit: limits.max_monthly_audio_normal,
          unlimited: limits.max_monthly_audio_normal === 0,
        },
        hq: {
          used: counts.audio.hq,
          limit: limits.max_monthly_audio_hq,
          unlimited: limits.max_monthly_audio_hq === 0,
        },
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error obteniendo uso del proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
