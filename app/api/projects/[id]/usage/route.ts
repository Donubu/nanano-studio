import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface UsageRow extends RowDataPacket {
  max_monthly_image_generations: number;
  max_monthly_video_generations: number;
  current_month_image_count: number;
  current_month_video_count: number;
}

// GET - Obtener uso del usuario en el proyecto
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
      return NextResponse.json({
        images: {
          used: 0,
          limit: 0,
          unlimited: true,
        },
        videos: {
          used: 0,
          limit: 0,
          unlimited: true,
        },
      });
    }

    // Obtener límites y uso actual del usuario en el proyecto
    // Imágenes: mensajes del modelo con image_url (generaciones de imagen)
    // Videos: mensajes del modelo con video_url (generaciones de video)
    const [rows] = await pool.execute<UsageRow[]>(`
      SELECT
        COALESCE(pu.max_monthly_image_generations, 0) as max_monthly_image_generations,
        COALESCE(pu.max_monthly_video_generations, 0) as max_monthly_video_generations,
        (
          SELECT COUNT(*)
          FROM messages m
          JOIN conversations c ON m.conversation_id = c.id
          WHERE c.project_id = ?
            AND c.user_id = ?
            AND m.role = 'model'
            AND m.image_url IS NOT NULL
            AND m.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
        ) as current_month_image_count,
        (
          SELECT COUNT(*)
          FROM messages m
          JOIN conversations c ON m.conversation_id = c.id
          WHERE c.project_id = ?
            AND c.user_id = ?
            AND m.role = 'model'
            AND m.video_url IS NOT NULL
            AND m.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
        ) as current_month_video_count
      FROM project_users pu
      WHERE pu.project_id = ? AND pu.user_id = ?
    `, [id, session.user.id, id, session.user.id, id, session.user.id]);

    if (rows.length === 0) {
      return NextResponse.json({ error: "No tienes acceso a este proyecto" }, { status: 403 });
    }

    const {
      max_monthly_image_generations,
      max_monthly_video_generations,
      current_month_image_count,
      current_month_video_count,
    } = rows[0];

    return NextResponse.json({
      images: {
        used: current_month_image_count,
        limit: max_monthly_image_generations,
        unlimited: max_monthly_image_generations === 0,
      },
      videos: {
        used: current_month_video_count,
        limit: max_monthly_video_generations,
        unlimited: max_monthly_video_generations === 0,
      },
    });
  } catch (error) {
    console.error("Error obteniendo uso del proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
