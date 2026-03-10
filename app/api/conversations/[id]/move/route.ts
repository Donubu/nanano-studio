import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

// PUT - Move conversation to a different project (admin only)
export async function PUT(
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
    const body = await request.json();
    const { project_id } = body;

    if (!project_id) {
      return NextResponse.json({ error: "Se requiere project_id" }, { status: 400 });
    }

    // Verify the conversation exists
    const [conversations] = await pool.execute<RowDataPacket[]>(
      "SELECT id, project_id, title FROM conversations WHERE id = ? AND deleted_at IS NULL",
      [conversationId]
    );

    if (conversations.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const conversation = conversations[0];

    if (conversation.project_id === project_id) {
      return NextResponse.json({ error: "La conversación ya pertenece a ese proyecto" }, { status: 400 });
    }

    // Verify the target project exists
    const [projects] = await pool.execute<RowDataPacket[]>(
      "SELECT id, title FROM projects WHERE id = ?",
      [project_id]
    );

    if (projects.length === 0) {
      return NextResponse.json({ error: "Proyecto destino no encontrado" }, { status: 404 });
    }

    // Move the conversation - update project_id
    // Messages and message_images are linked via conversation_id, not project_id,
    // so they follow the conversation automatically. No need to update them.
    await pool.execute<ResultSetHeader>(
      "UPDATE conversations SET project_id = ?, updated_at = NOW() WHERE id = ?",
      [project_id, conversationId]
    );

    return NextResponse.json({
      success: true,
      conversation_id: conversationId,
      old_project_id: conversation.project_id,
      new_project_id: project_id,
      new_project_title: projects[0].title,
    });
  } catch (error) {
    console.error("Error moviendo conversación:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
