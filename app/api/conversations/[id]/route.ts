import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number | null;
  model_id: number;
  model_model_id: string;
  model_display_name: string;
  model_supports_image_generation: boolean;
  project_title: string | null;
  title: string;
  system_instruction: string | null;
  temperature: number;
  top_p: number;
  top_k: number;
  max_output_tokens: number;
  image_aspect_ratio: string;
  image_size: string;
  created_at: Date;
  updated_at: Date;
}

// GET - Obtener conversación con mensajes
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
    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get("archived") === "true";

    // Obtener conversación (incluir archivadas si se solicita)
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT
        c.*,
        m.model_id as model_model_id,
        m.display_name as model_display_name,
        m.supports_image_generation as model_supports_image_generation,
        p.title as project_title
      FROM conversations c
      JOIN models m ON c.model_id = m.id
      LEFT JOIN projects p ON c.project_id = p.id
      WHERE c.id = ? AND c.user_id = ? ${includeArchived ? "" : "AND c.deleted_at IS NULL"}`,
      [id, session.user.id]
    );

    if (conversations.length === 0) {
      return NextResponse.json(
        { error: "Conversación no encontrada" },
        { status: 404 }
      );
    }

    // Obtener mensajes
    const [messages] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
      [id]
    );

    return NextResponse.json({
      ...conversations[0],
      messages,
    });
  } catch (error) {
    console.error("Error obteniendo conversación:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PUT - Actualizar conversación (título, configuración)
export async function PUT(
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
      title,
      system_instruction,
      temperature,
      top_p,
      top_k,
      max_output_tokens,
      model_id,
      image_aspect_ratio,
      image_size,
    } = body;

    // Debug: log received body
    console.log("[PUT /conversations] Received body:", body);
    console.log("[PUT /conversations] Extracted image_aspect_ratio:", image_aspect_ratio);

    // Verificar que la conversación pertenece al usuario y no está eliminada
    const [existing] = await pool.execute<ConversationRow[]>(
      "SELECT id FROM conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
      [id, session.user.id]
    );

    if (existing.length === 0) {
      return NextResponse.json(
        { error: "Conversación no encontrada" },
        { status: 404 }
      );
    }

    await pool.execute<ResultSetHeader>(
      `UPDATE conversations SET
        title = COALESCE(?, title),
        system_instruction = COALESCE(?, system_instruction),
        temperature = COALESCE(?, temperature),
        top_p = COALESCE(?, top_p),
        top_k = COALESCE(?, top_k),
        max_output_tokens = COALESCE(?, max_output_tokens),
        model_id = COALESCE(?, model_id),
        image_aspect_ratio = COALESCE(?, image_aspect_ratio),
        image_size = COALESCE(?, image_size)
       WHERE id = ?`,
      [
        title ?? null,
        system_instruction ?? null,
        temperature ?? null,
        top_p ?? null,
        top_k ?? null,
        max_output_tokens ?? null,
        model_id ?? null,
        image_aspect_ratio ?? null,
        image_size ?? null,
        id,
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando conversación:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// DELETE - Eliminar conversación (soft delete)
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

    // Soft delete: marcar como eliminada en lugar de borrar
    const [result] = await pool.execute<ResultSetHeader>(
      "UPDATE conversations SET deleted_at = NOW() WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
      [id, session.user.id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { error: "Conversación no encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando conversación:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
