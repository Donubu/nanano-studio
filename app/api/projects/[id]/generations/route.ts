import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface GenerationRow extends RowDataPacket {
  id: number;
  conversation_id: number;
  conversation_user_id: number;
  conversation_title: string;
  image_url: string;
  image_mime_type: string;
  image_file_size: number | null;
  image_aspect_ratio: string;
  image_size: string;
  created_at: Date;
}

// GET - Obtener todas las imágenes generadas en el proyecto
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

    // Verificar que el usuario tiene acceso al proyecto (admin o asignado)
    const isAdmin = session.user.role === "admin";

    if (!isAdmin) {
      const [projectAccess] = await pool.execute<RowDataPacket[]>(
        `SELECT pu.id FROM project_users pu
         WHERE pu.project_id = ? AND pu.user_id = ?`,
        [projectId, session.user.id]
      );

      if (projectAccess.length === 0) {
        return NextResponse.json(
          { error: "Proyecto no encontrado o sin acceso" },
          { status: 404 }
        );
      }
    }

    // Obtener todas las imágenes generadas del proyecto (compartidas entre usuarios del proyecto)
    const [generations] = await pool.execute<GenerationRow[]>(
      `SELECT
        m.id,
        m.conversation_id,
        c.user_id as conversation_user_id,
        c.title as conversation_title,
        m.image_url,
        m.image_mime_type,
        m.image_file_size,
        c.image_aspect_ratio,
        c.image_size,
        m.created_at
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.project_id = ?
        AND m.role = 'model'
        AND m.image_url IS NOT NULL
        AND m.image_url != ''
      ORDER BY m.created_at DESC`,
      [projectId]
    );

    return NextResponse.json(generations);
  } catch (error) {
    console.error("Error obteniendo generaciones:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
