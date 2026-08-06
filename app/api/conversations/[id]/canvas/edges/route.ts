import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { broadcastCanvasEvent } from "@/lib/canvas-socket";

interface ConversationCheckRow extends RowDataPacket {
  id: number;
  user_id: number;
}

async function verifyConversationAccess(conversationId: string) {
  const [rows] = await pool.execute<ConversationCheckRow[]>(
    `SELECT id, user_id FROM conversations WHERE id = ? AND deleted_at IS NULL`,
    [conversationId]
  );
  return rows.length > 0 ? rows[0] : null;
}

interface IncomingEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  // Prioridad opcional (edges de referencia). NULL = neutro.
  data?: { priority?: unknown } | null;
}

// Sanitiza la prioridad: entero 1..99 o null (neutro).
function parsePriority(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
}

// POST - Crear (o resucitar) un edge. También actualiza la prioridad
// (es un upsert: re-postear el mismo edge con otra data.priority la cambia).
// Body: { edge: { id, source, target, sourceHandle?, targetHandle?, data?: { priority? } } }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { id } = await params;
    const conversation = await verifyConversationAccess(id);
    if (!conversation) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });

    const body = await request.json();
    const edge = body?.edge as IncomingEdge | undefined;
    if (!edge?.id || !edge.source || !edge.target) {
      return NextResponse.json({ error: "edge.id, source y target requeridos" }, { status: 400 });
    }

    await pool.execute(
      `INSERT INTO canvas_edges
        (id, conversation_id, source_node_id, source_handle, target_node_id, target_handle, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         source_node_id = VALUES(source_node_id),
         source_handle = VALUES(source_handle),
         target_node_id = VALUES(target_node_id),
         target_handle = VALUES(target_handle),
         priority = VALUES(priority),
         deleted_at = NULL`,
      [
        edge.id,
        id,
        edge.source,
        edge.sourceHandle ?? null,
        edge.target,
        edge.targetHandle ?? null,
        parsePriority(edge.data?.priority),
      ]
    );

    broadcastCanvasEvent(id, "edge:created", { edge });

    return NextResponse.json({ success: true, edge });
  } catch (error) {
    console.error("Error creating canvas edge:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE - Soft-delete uno o varios edges.
// Body: { edgeIds: string[] }
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { id } = await params;
    const conversation = await verifyConversationAccess(id);
    if (!conversation) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });

    const body = await request.json();
    const edgeIds = Array.isArray(body?.edgeIds) ? (body.edgeIds as string[]) : [];
    if (edgeIds.length === 0) {
      return NextResponse.json({ error: "edgeIds requerido" }, { status: 400 });
    }

    const chunk = <T,>(arr: T[], n: number) => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    };

    for (const batch of chunk(edgeIds, 500)) {
      const placeholders = batch.map(() => "?").join(",");
      await pool.execute(
        `UPDATE canvas_edges SET deleted_at = NOW()
         WHERE conversation_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL`,
        [id, ...batch]
      );
    }

    broadcastCanvasEvent(id, "edge:deleted", { edgeIds });

    return NextResponse.json({ success: true, deleted: edgeIds.length });
  } catch (error) {
    console.error("Error deleting canvas edges:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
