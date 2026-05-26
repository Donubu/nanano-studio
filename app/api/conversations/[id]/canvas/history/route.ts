import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface ConversationCheckRow extends RowDataPacket {
  id: number;
  user_id: number;
}

interface HistoryRow extends RowDataPacket {
  history_id: number;
  conversation_id: number;
  snapshot_id: string;
  snapshot_reason: string;
  saved_by_user_id: number | null;
  nodes_json: string;
  edges_json: string;
  nodes_count: number;
  edges_count: number;
  created_at: string;
}

interface AliveNodeRow extends RowDataPacket {
  id: string;
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
}

interface AliveEdgeRow extends RowDataPacket {
  id: string;
  source_node_id: string;
  source_handle: string | null;
  target_node_id: string;
  target_handle: string | null;
}

async function verifyConversationAccess(conversationId: string) {
  const [rows] = await pool.execute<ConversationCheckRow[]>(
    `SELECT id, user_id FROM conversations WHERE id = ? AND deleted_at IS NULL`,
    [conversationId]
  );
  return rows.length > 0 ? rows[0] : null;
}

// GET - Lista snapshots del canvas (timeline).
//   ?limit=50 (default 100, max 500)
//   ?includePayload=1 → incluye nodes_json/edges_json (más pesado)
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
    const limitParam = parseInt(url.searchParams.get("limit") || "100", 10);
    const limit = Math.min(Math.max(limitParam, 1), 500);
    const includePayload = url.searchParams.get("includePayload") === "1";

    const cols = includePayload
      ? "history_id, snapshot_id, snapshot_reason, saved_by_user_id, nodes_count, edges_count, created_at, nodes_json, edges_json"
      : "history_id, snapshot_id, snapshot_reason, saved_by_user_id, nodes_count, edges_count, created_at";

    const [rows] = await pool.execute<HistoryRow[]>(
      `SELECT ${cols} FROM canvas_nodes_history
       WHERE conversation_id = ?
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      [id]
    );

    return NextResponse.json({ snapshots: rows });
  } catch (error) {
    console.error("Error loading canvas history:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Restaura un snapshot completo.
//
// Body: { snapshotId: string }
//
// Flujo:
//   1. Carga el snapshot por (conversation_id, snapshot_id).
//   2. Toma snapshot pre-restore del estado vivo actual (reason=pre-restore).
//   3. Marca todos los nodos/edges vivos actuales como deleted_at = NOW().
//   4. INSERT ... ON DUPLICATE KEY UPDATE deleted_at = NULL + datos del snapshot
//      para cada nodo/edge del snapshot.
//
// Esto resucita lo que existió en ese momento y soft-deletea lo que no.
// El "deshacer" sigue siendo posible — el snapshot pre-restore queda en
// la tabla de historial.
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

    const sessionUserId = Number((session.user as unknown as { id?: number | string }).id) || null;

    const body = await request.json();
    const { snapshotId } = body as { snapshotId?: string };
    if (!snapshotId) {
      return NextResponse.json({ error: "snapshotId requerido" }, { status: 400 });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1) Cargar el snapshot target.
      const [snapRows] = await conn.execute<HistoryRow[]>(
        `SELECT * FROM canvas_nodes_history
         WHERE conversation_id = ? AND snapshot_id = ?
         ORDER BY history_id DESC LIMIT 1`,
        [id, snapshotId]
      );
      if (snapRows.length === 0) {
        await conn.rollback();
        return NextResponse.json({ error: "Snapshot no encontrado" }, { status: 404 });
      }
      const snap = snapRows[0];
      const targetNodes = JSON.parse(snap.nodes_json) as Array<{
        id: string;
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
      }>;
      const targetEdges = JSON.parse(snap.edges_json) as Array<{
        id: string;
        source_node_id: string;
        source_handle: string | null;
        target_node_id: string;
        target_handle: string | null;
      }>;

      // 2) Snapshot pre-restore del estado vivo actual.
      const [aliveNodeRows] = await conn.execute<AliveNodeRow[]>(
        `SELECT id, type, label, position_x, position_y, width, height,
                config, status, output_message_id, output_url, output_text, error_message
         FROM canvas_nodes
         WHERE conversation_id = ? AND deleted_at IS NULL`,
        [id]
      );
      const [aliveEdgeRows] = await conn.execute<AliveEdgeRow[]>(
        `SELECT id, source_node_id, source_handle, target_node_id, target_handle
         FROM canvas_edges
         WHERE conversation_id = ? AND deleted_at IS NULL`,
        [id]
      );

      const preRestoreSnapshotId = randomUUID();
      await conn.execute(
        `INSERT INTO canvas_nodes_history
          (conversation_id, snapshot_id, snapshot_reason, saved_by_user_id,
           nodes_json, edges_json, nodes_count, edges_count)
         VALUES (?, ?, 'pre-restore', ?, ?, ?, ?, ?)`,
        [
          id,
          preRestoreSnapshotId,
          sessionUserId,
          JSON.stringify(aliveNodeRows.map((r) => ({
            id: r.id, type: r.type, label: r.label,
            position_x: r.position_x, position_y: r.position_y,
            width: r.width, height: r.height,
            config: typeof r.config === "string" ? r.config : JSON.stringify(r.config),
            status: r.status,
            output_message_id: r.output_message_id,
            output_url: r.output_url,
            output_text: r.output_text,
            error_message: r.error_message,
          }))),
          JSON.stringify(aliveEdgeRows),
          aliveNodeRows.length,
          aliveEdgeRows.length,
        ]
      );

      // 3) Soft-delete de todo lo vivo actual (no incluido en el snapshot
      //    será marcado, lo incluido será resucitado en el paso siguiente).
      await conn.execute(
        `UPDATE canvas_nodes SET deleted_at = NOW()
         WHERE conversation_id = ? AND deleted_at IS NULL`,
        [id]
      );
      await conn.execute(
        `UPDATE canvas_edges SET deleted_at = NOW()
         WHERE conversation_id = ? AND deleted_at IS NULL`,
        [id]
      );

      // 4) UPSERT del snapshot — resucita los que estaban borrados y los actualiza.
      for (const n of targetNodes) {
        await conn.execute(
          `INSERT INTO canvas_nodes
            (id, conversation_id, type, label, position_x, position_y, width, height,
             config, status, output_message_id, output_url, output_text, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             type = VALUES(type),
             label = VALUES(label),
             position_x = VALUES(position_x),
             position_y = VALUES(position_y),
             width = VALUES(width),
             height = VALUES(height),
             config = VALUES(config),
             status = VALUES(status),
             output_message_id = VALUES(output_message_id),
             output_url = VALUES(output_url),
             output_text = VALUES(output_text),
             error_message = VALUES(error_message),
             deleted_at = NULL,
             version = version + 1`,
          [
            n.id, id, n.type, n.label,
            n.position_x, n.position_y, n.width, n.height,
            n.config, n.status,
            n.output_message_id, n.output_url, n.output_text, n.error_message,
          ]
        );
      }

      for (const e of targetEdges) {
        await conn.execute(
          `INSERT INTO canvas_edges
            (id, conversation_id, source_node_id, source_handle, target_node_id, target_handle)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             source_node_id = VALUES(source_node_id),
             source_handle = VALUES(source_handle),
             target_node_id = VALUES(target_node_id),
             target_handle = VALUES(target_handle),
             deleted_at = NULL`,
          [e.id, id, e.source_node_id, e.source_handle, e.target_node_id, e.target_handle]
        );
      }

      await conn.commit();
      return NextResponse.json({
        success: true,
        restoredSnapshotId: snapshotId,
        preRestoreSnapshotId,
        restoredNodes: targetNodes.length,
        restoredEdges: targetEdges.length,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error("Error restoring canvas snapshot:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
