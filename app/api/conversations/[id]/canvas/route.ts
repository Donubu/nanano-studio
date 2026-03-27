import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

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

// GET - Load canvas state (nodes + edges)
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

    const [nodeRows] = await pool.execute<CanvasNodeRow[]>(
      `SELECT * FROM canvas_nodes WHERE conversation_id = ? ORDER BY created_at ASC`,
      [id]
    );

    const [edgeRows] = await pool.execute<CanvasEdgeRow[]>(
      `SELECT * FROM canvas_edges WHERE conversation_id = ? ORDER BY created_at ASC`,
      [id]
    );

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

// PUT - Save entire canvas state (bulk upsert via delete + insert)
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

    const body = await request.json();
    const { nodes = [], edges = [] } = body as {
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
    };

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Delete existing
      await conn.execute("DELETE FROM canvas_edges WHERE conversation_id = ?", [id]);
      await conn.execute("DELETE FROM canvas_nodes WHERE conversation_id = ?", [id]);

      // Insert nodes
      for (const node of nodes) {
        const { label, status, outputMessageId, outputUrl, outputText, errorMessage, type: _nodeType, ...configData } = node.data as Record<string, unknown>;
        await conn.execute(
          `INSERT INTO canvas_nodes (id, conversation_id, type, label, position_x, position_y, width, height, config, status, output_message_id, output_url, output_text, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

      // Insert edges
      for (const edge of edges) {
        await conn.execute(
          `INSERT INTO canvas_edges (id, conversation_id, source_node_id, source_handle, target_node_id, target_handle)
           VALUES (?, ?, ?, ?, ?, ?)`,
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

      await conn.commit();
      return NextResponse.json({ success: true });
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
