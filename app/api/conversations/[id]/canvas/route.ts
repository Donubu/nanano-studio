import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface CanvasNodeRow extends RowDataPacket {
  id: string;
  conversation_id: number;
  type: "text" | "image" | "video";
  label: string;
  position_x: number;
  position_y: number;
  width: number | null;
  height: number | null;
  config: string;
  status: "idle" | "generating" | "completed" | "error";
  output_message_id: number | null;
  output_url: string | null;
  output_text: string | null;
  error_message: string | null;
}

interface CanvasEdgeRow extends RowDataPacket {
  id: string;
  conversation_id: number;
  source_node_id: string;
  source_handle: string | null;
  target_node_id: string;
  target_handle: string | null;
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

// GET - Load canvas state (nodes + edges) — solo vivos
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

    const conn = await pool.getConnection();
    let nodeRows: CanvasNodeRow[];
    let edgeRows: CanvasEdgeRow[];
    try {
      await conn.execute("SET SESSION sort_buffer_size = 8388608");
      [nodeRows] = await conn.execute<CanvasNodeRow[]>(
        `SELECT * FROM canvas_nodes
         WHERE conversation_id = ? AND deleted_at IS NULL
         ORDER BY created_at ASC`,
        [id]
      );
      [edgeRows] = await conn.execute<CanvasEdgeRow[]>(
        `SELECT * FROM canvas_edges
         WHERE conversation_id = ? AND deleted_at IS NULL
         ORDER BY created_at ASC`,
        [id]
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
    }));

    const edges = edgeRows.map((row) => ({
      id: row.id,
      source: row.source_node_id,
      sourceHandle: row.source_handle,
      target: row.target_node_id,
      targetHandle: row.target_handle,
    }));

    return NextResponse.json({ nodes, edges });
  } catch (error) {
    console.error("Error loading canvas:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// PUT - Save canvas state con snapshot + diff + soft-delete + guard anti-wipe.
//
// Body:
//   { nodes: [...], edges: [...], allowWipe?: boolean }
//
// Comportamiento:
//   1. Snapshot del estado vivo actual a canvas_nodes_history (reason=autosave o pre-wipe).
//   2. Calcula diff por id: ids vivos actuales vs ids entrantes.
//   3. Guard anti-wipe: si el incoming borraría >70% de los nodos vivos
//      (o todos cuando hay >5) y no viene allowWipe=true, responde 409
//      con detalle. El cliente puede reintentar con allowWipe=true tras
//      confirmar con el usuario.
//   4. UPSERT de los entrantes (resucitando los soft-deleted que vuelvan,
//      ON DUPLICATE KEY UPDATE deleted_at = NULL, version = version + 1).
//   5. Soft-delete (deleted_at = NOW()) de los ausentes — quedan en la papelera.
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
    const conversation = await verifyConversationAccess(id);
    if (!conversation) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const sessionUserId = Number((session.user as unknown as { id?: number | string }).id) || null;

    const body = await request.json();
    const { nodes = [], edges = [], allowWipe = false } = body as {
      nodes: Array<{
        id: string;
        type: string;
        position: { x: number; y: number };
        width?: number;
        height?: number;
        data: Record<string, unknown>;
      }>;
      edges: Array<{
        id: string;
        source: string;
        sourceHandle?: string | null;
        target: string;
        targetHandle?: string | null;
      }>;
      allowWipe?: boolean;
    };

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1) Estado vivo actual (lo necesitamos para snapshot + diff + guard).
      const [aliveNodeRows] = await conn.execute<CanvasNodeRow[]>(
        `SELECT * FROM canvas_nodes
         WHERE conversation_id = ? AND deleted_at IS NULL`,
        [id]
      );
      const [aliveEdgeRows] = await conn.execute<CanvasEdgeRow[]>(
        `SELECT * FROM canvas_edges
         WHERE conversation_id = ? AND deleted_at IS NULL`,
        [id]
      );

      const currentNodeIds = new Set(aliveNodeRows.map((r) => r.id));
      const currentEdgeIds = new Set(aliveEdgeRows.map((r) => r.id));
      const incomingNodeIds = new Set(nodes.map((n) => n.id));
      const incomingEdgeIds = new Set(edges.map((e) => e.id));

      const nodesToSoftDelete = [...currentNodeIds].filter((nid) => !incomingNodeIds.has(nid));
      const edgesToSoftDelete = [...currentEdgeIds].filter((eid) => !incomingEdgeIds.has(eid));

      // 2) Guard anti-wipe. Solo aplica si hay cantidad significativa que perder.
      const currentAlive = currentNodeIds.size;
      const incomingCount = incomingNodeIds.size;
      const wouldWipeAll = currentAlive > 5 && incomingCount === 0;
      const wouldDropHard = currentAlive > 5 && incomingCount < currentAlive * 0.3;
      const wipeCheckFails = (wouldWipeAll || wouldDropHard) && !allowWipe;

      const snapshotReason: "autosave" | "pre-wipe" = wipeCheckFails || allowWipe ? "pre-wipe" : "autosave";
      const snapshotId = randomUUID();

      // 3) Snapshot pre-cambio — SIEMPRE, incluso si vamos a rechazar (auditoría).
      const nodesJson = JSON.stringify(aliveNodeRows.map((r) => ({
        id: r.id,
        type: r.type,
        label: r.label,
        position_x: r.position_x,
        position_y: r.position_y,
        width: r.width,
        height: r.height,
        config: typeof r.config === "string" ? r.config : JSON.stringify(r.config),
        status: r.status,
        output_message_id: r.output_message_id,
        output_url: r.output_url,
        output_text: r.output_text,
        error_message: r.error_message,
      })));
      const edgesJson = JSON.stringify(aliveEdgeRows.map((r) => ({
        id: r.id,
        source_node_id: r.source_node_id,
        source_handle: r.source_handle,
        target_node_id: r.target_node_id,
        target_handle: r.target_handle,
      })));

      if (currentAlive > 0 || aliveEdgeRows.length > 0) {
        await conn.execute(
          `INSERT INTO canvas_nodes_history
            (conversation_id, snapshot_id, snapshot_reason, saved_by_user_id,
             nodes_json, edges_json, nodes_count, edges_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, snapshotId, snapshotReason, sessionUserId, nodesJson, edgesJson, currentAlive, aliveEdgeRows.length]
        );
      }

      if (wipeCheckFails) {
        await conn.commit(); // commit del snapshot, no del cambio
        return NextResponse.json(
          {
            error: "wipe_protection",
            message: "El cambio eliminaría una fracción grande del canvas. Confirma para continuar.",
            currentAlive,
            incomingCount,
            wouldSoftDelete: nodesToSoftDelete.length,
            snapshotId,
          },
          { status: 409 }
        );
      }

      // 4) UPSERT de nodos entrantes — resucita soft-deleted y bumpea version.
      for (const node of nodes) {
        const { label, status, outputMessageId, outputUrl, outputText, errorMessage, type: _nodeType, ...configData } = node.data as Record<string, unknown>;
        void _nodeType;
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
            node.id,
            id,
            node.type,
            (label as string) || "",
            node.position.x,
            node.position.y,
            node.width || null,
            node.height || null,
            JSON.stringify(configData),
            (status as string) || "idle",
            (outputMessageId as number) || null,
            (outputUrl as string) || null,
            (outputText as string) || null,
            (errorMessage as string) || null,
          ]
        );
      }

      // 5) UPSERT de edges entrantes.
      for (const edge of edges) {
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
          [
            edge.id,
            id,
            edge.source,
            edge.sourceHandle || null,
            edge.target,
            edge.targetHandle || null,
          ]
        );
      }

      // 6) Soft-delete de los ausentes (en lotes para no exceder placeholders).
      const chunk = <T,>(arr: T[], n: number) => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
        return out;
      };
      for (const batch of chunk(nodesToSoftDelete, 500)) {
        const placeholders = batch.map(() => "?").join(",");
        await conn.execute(
          `UPDATE canvas_nodes SET deleted_at = NOW()
           WHERE conversation_id = ? AND id IN (${placeholders})`,
          [id, ...batch]
        );
      }
      for (const batch of chunk(edgesToSoftDelete, 500)) {
        const placeholders = batch.map(() => "?").join(",");
        await conn.execute(
          `UPDATE canvas_edges SET deleted_at = NOW()
           WHERE conversation_id = ? AND id IN (${placeholders})`,
          [id, ...batch]
        );
      }

      await conn.commit();
      return NextResponse.json({
        success: true,
        snapshotId,
        upsertedNodes: nodes.length,
        upsertedEdges: edges.length,
        softDeletedNodes: nodesToSoftDelete.length,
        softDeletedEdges: edgesToSoftDelete.length,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error("Error saving canvas:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

