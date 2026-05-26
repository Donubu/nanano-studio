import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface CanvasNodeRow extends RowDataPacket {
  id: string;
  conversation_id: number;
  type: string;
  label: string;
  position_x: number;
  position_y: number;
  width: number | null;
  height: number | null;
  config: string;
  status: string;
  output_message_id: number | null;
  output_url: string | null;
  output_text: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface CanvasEdgeRow extends RowDataPacket {
  id: string;
  source_node_id: string;
  source_handle: string | null;
  target_node_id: string;
  target_handle: string | null;
  created_at: string;
  deleted_at: string | null;
}

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

// GET - Lista nodos y edges soft-deleted (papelera del canvas).
//
// Querystring opcional:
//   ?since=ISO8601  → solo eliminados desde esa fecha
//   ?limit=200      → cap (default 500)
//
// Respuesta:
//   { nodes: [...], edges: [...] }  con la misma forma que el GET principal
//   pero cada item incluye además { deletedAt, originallyCreatedAt }.
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
    const conversation = await verifyConversationAccess(id);
    if (!conversation) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const url = new URL(request.url);
    const since = url.searchParams.get("since");
    const limitParam = parseInt(url.searchParams.get("limit") || "500", 10);
    const limit = Math.min(Math.max(limitParam, 1), 2000);

    const sinceClause = since ? `AND deleted_at >= ?` : "";
    const sinceParams = since ? [since] : [];

    const conn = await pool.getConnection();
    let nodeRows: CanvasNodeRow[];
    let edgeRows: CanvasEdgeRow[];
    try {
      await conn.execute("SET SESSION sort_buffer_size = 8388608");
      [nodeRows] = await conn.execute<CanvasNodeRow[]>(
        `SELECT * FROM canvas_nodes
         WHERE conversation_id = ? AND deleted_at IS NOT NULL ${sinceClause}
         ORDER BY deleted_at DESC
         LIMIT ${limit}`,
        [id, ...sinceParams]
      );
      [edgeRows] = await conn.execute<CanvasEdgeRow[]>(
        `SELECT * FROM canvas_edges
         WHERE conversation_id = ? AND deleted_at IS NOT NULL ${sinceClause}
         ORDER BY deleted_at DESC
         LIMIT ${limit}`,
        [id, ...sinceParams]
      );
    } finally {
      conn.release();
    }

    const nodes = nodeRows.map((row) => ({
      id: row.id,
      type: row.type,
      position: { x: row.position_x, y: row.position_y },
      ...(row.width && row.height ? { width: row.width, height: row.height } : {}),
      data: {
        ...JSON.parse(typeof row.config === "string" ? row.config : JSON.stringify(row.config)),
        label: row.label,
        status: row.status,
        outputMessageId: row.output_message_id,
        outputUrl: row.output_url,
        outputText: row.output_text,
        errorMessage: row.error_message,
      },
      deletedAt: row.deleted_at,
      originallyCreatedAt: row.created_at,
    }));

    const edges = edgeRows.map((row) => ({
      id: row.id,
      source: row.source_node_id,
      sourceHandle: row.source_handle,
      target: row.target_node_id,
      targetHandle: row.target_handle,
      deletedAt: row.deleted_at,
    }));

    return NextResponse.json({ nodes, edges });
  } catch (error) {
    console.error("Error loading canvas trash:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Restaura nodos y/o edges soft-deleted.
//
// Body:
//   {
//     nodeIds?: string[],          // ids a resucitar
//     edgeIds?: string[],          // ids a resucitar
//     restoreIncidentEdges?: bool, // tras restaurar nodos, resucita edges
//                                  // cuyos source/target queden vivos
//   }
//
// Respuesta: { restoredNodes, restoredEdges }.
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
    const conversation = await verifyConversationAccess(id);
    if (!conversation) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const body = await request.json();
    const { nodeIds = [], edgeIds = [], restoreIncidentEdges = false } = body as {
      nodeIds?: string[];
      edgeIds?: string[];
      restoreIncidentEdges?: boolean;
    };

    if (nodeIds.length === 0 && edgeIds.length === 0 && !restoreIncidentEdges) {
      return NextResponse.json({ error: "Nada para restaurar" }, { status: 400 });
    }

    const chunk = <T,>(arr: T[], n: number) => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    };

    const conn = await pool.getConnection();
    let restoredNodes = 0;
    let restoredEdges = 0;
    try {
      await conn.beginTransaction();

      for (const batch of chunk(nodeIds, 500)) {
        const placeholders = batch.map(() => "?").join(",");
        const [res] = await conn.execute(
          `UPDATE canvas_nodes
           SET deleted_at = NULL, version = version + 1
           WHERE conversation_id = ? AND id IN (${placeholders}) AND deleted_at IS NOT NULL`,
          [id, ...batch]
        );
        restoredNodes += (res as unknown as { affectedRows: number }).affectedRows ?? 0;
      }

      for (const batch of chunk(edgeIds, 500)) {
        const placeholders = batch.map(() => "?").join(",");
        const [res] = await conn.execute(
          `UPDATE canvas_edges
           SET deleted_at = NULL
           WHERE conversation_id = ? AND id IN (${placeholders}) AND deleted_at IS NOT NULL`,
          [id, ...batch]
        );
        restoredEdges += (res as unknown as { affectedRows: number }).affectedRows ?? 0;
      }

      if (restoreIncidentEdges) {
        // Restaura cualquier edge soft-deleted cuyo source y target estén vivos.
        const [res] = await conn.execute(
          `UPDATE canvas_edges e
           SET e.deleted_at = NULL
           WHERE e.conversation_id = ?
             AND e.deleted_at IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM canvas_nodes sn
               WHERE sn.conversation_id = e.conversation_id
                 AND sn.id = e.source_node_id
                 AND sn.deleted_at IS NULL
             )
             AND EXISTS (
               SELECT 1 FROM canvas_nodes tn
               WHERE tn.conversation_id = e.conversation_id
                 AND tn.id = e.target_node_id
                 AND tn.deleted_at IS NULL
             )`,
          [id]
        );
        restoredEdges += (res as unknown as { affectedRows: number }).affectedRows ?? 0;
      }

      await conn.commit();
      return NextResponse.json({ restoredNodes, restoredEdges });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error("Error restoring canvas trash:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
