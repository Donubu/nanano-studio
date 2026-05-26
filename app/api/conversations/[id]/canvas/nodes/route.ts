import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { broadcastCanvasEvent, broadcastCanvasEventVolatile } from "@/lib/canvas-socket";

interface ConversationCheckRow extends RowDataPacket {
  id: number;
  user_id: number;
}

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
  deleted_at: string | null;
  version: number;
}

async function verifyConversationAccess(conversationId: string) {
  const [rows] = await pool.execute<ConversationCheckRow[]>(
    `SELECT id, user_id FROM conversations WHERE id = ? AND deleted_at IS NULL`,
    [conversationId]
  );
  return rows.length > 0 ? rows[0] : null;
}

function rowToClient(row: CanvasNodeRow) {
  return {
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
    version: row.version,
  };
}

interface IncomingNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  data?: Record<string, unknown>;
}

// POST - Crear un nodo nuevo.
// Body: { node: { id, type, position, width?, height?, data } }
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
    const node = body?.node as IncomingNode | undefined;
    if (!node || !node.id || !node.type) {
      return NextResponse.json({ error: "node.id y node.type requeridos" }, { status: 400 });
    }

    const data = (node.data ?? {}) as Record<string, unknown>;
    const { label, status, outputMessageId, outputUrl, outputText, errorMessage, type: _ignoredType, ...configData } = data;
    void _ignoredType;

    await pool.execute(
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

    const [rows] = await pool.execute<CanvasNodeRow[]>(
      `SELECT * FROM canvas_nodes WHERE id = ? AND conversation_id = ?`,
      [node.id, id]
    );
    const created = rows[0] ? rowToClient(rows[0]) : null;

    if (created) {
      broadcastCanvasEvent(id, "node:created", { node: created });
    }

    return NextResponse.json({ node: created });
  } catch (error) {
    console.error("Error creating canvas node:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// PATCH - Actualiza uno o varios nodos.
//
// Acepta dos formatos:
//   Single:  { nodeId, updates: { ... } }
//   Batch:   { updates: [{ id, ...fields }, ...] }
//
// Campos aceptados por nodo:
//   position { x, y } | width | height | label | type | config | status |
//   output_message_id | output_url | output_text | error_message
//
// Para movimientos (solo position) el broadcast es volatile.
export async function PATCH(
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

    type PatchItem = {
      id: string;
      position?: { x: number; y: number };
      width?: number | null;
      height?: number | null;
      label?: string;
      type?: string;
      config?: Record<string, unknown>;
      status?: string;
      output_message_id?: number | null;
      output_url?: string | null;
      output_text?: string | null;
      error_message?: string | null;
    };

    const items: PatchItem[] = [];
    if (Array.isArray(body?.updates) && typeof body.updates[0] === "object" && "id" in body.updates[0]) {
      items.push(...(body.updates as PatchItem[]));
    } else if (typeof body?.nodeId === "string" && body?.updates) {
      items.push({ id: body.nodeId, ...(body.updates as Omit<PatchItem, "id">) });
    } else {
      return NextResponse.json({ error: "Body inválido" }, { status: 400 });
    }

    if (items.length === 0) {
      return NextResponse.json({ error: "Sin updates" }, { status: 400 });
    }

    const isMoveOnly = items.every((it) => {
      const keys = Object.keys(it).filter((k) => k !== "id");
      return keys.length === 1 && keys[0] === "position";
    });

    for (const it of items) {
      const set: string[] = [];
      const values: unknown[] = [];

      if (it.position) {
        set.push("position_x = ?", "position_y = ?");
        values.push(it.position.x, it.position.y);
      }
      if (it.width !== undefined) { set.push("width = ?"); values.push(it.width); }
      if (it.height !== undefined) { set.push("height = ?"); values.push(it.height); }
      if (it.label !== undefined) { set.push("label = ?"); values.push(it.label); }
      if (it.type !== undefined) { set.push("type = ?"); values.push(it.type); }
      if (it.config !== undefined) { set.push("config = ?"); values.push(JSON.stringify(it.config)); }
      if (it.status !== undefined) { set.push("status = ?"); values.push(it.status); }
      if (it.output_message_id !== undefined) { set.push("output_message_id = ?"); values.push(it.output_message_id); }
      if (it.output_url !== undefined) { set.push("output_url = ?"); values.push(it.output_url); }
      if (it.output_text !== undefined) { set.push("output_text = ?"); values.push(it.output_text); }
      if (it.error_message !== undefined) { set.push("error_message = ?"); values.push(it.error_message); }

      if (set.length === 0) continue;

      set.push("version = version + 1");
      values.push(it.id, id);

      await pool.execute(
        `UPDATE canvas_nodes SET ${set.join(", ")}
         WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL`,
        values
      );
    }

    // Broadcast por op.
    if (isMoveOnly) {
      for (const it of items) {
        broadcastCanvasEventVolatile(id, "node:moved", {
          nodeId: it.id,
          x: it.position!.x,
          y: it.position!.y,
        });
      }
    } else {
      for (const it of items) {
        broadcastCanvasEvent(id, "node:updated", {
          nodeId: it.id,
          changes: it,
        });
      }
    }

    return NextResponse.json({ success: true, updated: items.length });
  } catch (error) {
    console.error("Error updating canvas node:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE - Soft-delete uno o varios nodos.
// Body: { nodeIds: string[] }
// Devuelve también los edges incidentes que fueron soft-deleted en cascada.
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
    const nodeIds = Array.isArray(body?.nodeIds) ? (body.nodeIds as string[]) : [];
    if (nodeIds.length === 0) {
      return NextResponse.json({ error: "nodeIds requerido" }, { status: 400 });
    }

    const conn = await pool.getConnection();
    const cascadedEdges: string[] = [];
    try {
      await conn.beginTransaction();

      const chunk = <T,>(arr: T[], n: number) => {
        const out: T[][] = [];
        for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
        return out;
      };

      for (const batch of chunk(nodeIds, 500)) {
        const placeholders = batch.map(() => "?").join(",");
        await conn.execute(
          `UPDATE canvas_nodes SET deleted_at = NOW()
           WHERE conversation_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL`,
          [id, ...batch]
        );

        // Edges incidentes: source o target en los nodos borrados.
        const [edgeRows] = await conn.execute<RowDataPacket[]>(
          `SELECT id FROM canvas_edges
           WHERE conversation_id = ? AND deleted_at IS NULL
             AND (source_node_id IN (${placeholders}) OR target_node_id IN (${placeholders}))`,
          [id, ...batch, ...batch]
        );
        const eids = (edgeRows as Array<{ id: string }>).map((r) => r.id);
        if (eids.length > 0) {
          const eph = eids.map(() => "?").join(",");
          await conn.execute(
            `UPDATE canvas_edges SET deleted_at = NOW()
             WHERE conversation_id = ? AND id IN (${eph})`,
            [id, ...eids]
          );
          cascadedEdges.push(...eids);
        }
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    broadcastCanvasEvent(id, "node:deleted", { nodeIds, cascadedEdgeIds: cascadedEdges });

    return NextResponse.json({
      success: true,
      deletedNodes: nodeIds.length,
      cascadedEdges: cascadedEdges.length,
    });
  } catch (error) {
    console.error("Error deleting canvas nodes:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
