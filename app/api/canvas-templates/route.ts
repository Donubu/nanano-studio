import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import {
  sanitizeNodeForTemplate,
  edgeRowToTemplate,
  countNodeTypes,
} from "@/lib/canvas-templates";

interface TemplateListRow extends RowDataPacket {
  id: number;
  name: string;
  description: string | null;
  node_count: number;
  edge_count: number;
  node_types_json: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}

interface CanvasNodeRow extends RowDataPacket {
  id: string;
  type: string;
  label: string;
  position_x: number;
  position_y: number;
  width: number | null;
  height: number | null;
  config: string;
  status: string;
  output_url: string | null;
  output_text: string | null;
}

interface CanvasEdgeRow extends RowDataPacket {
  id: string;
  source_node_id: string;
  source_handle: string | null;
  target_node_id: string;
  target_handle: string | null;
}

// GET - Lista global de templates (metadata liviana para el picker).
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const [rows] = await pool.execute<TemplateListRow[]>(
      `SELECT t.id, t.name, t.description, t.node_count, t.edge_count,
              t.node_types_json, t.created_by, u.name AS created_by_name, t.created_at
       FROM canvas_templates t
       LEFT JOIN users u ON u.id = t.created_by
       WHERE t.deleted_at IS NULL
       ORDER BY t.created_at DESC`
    );

    const templates = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      nodeCount: row.node_count,
      edgeCount: row.edge_count,
      nodeTypes: row.node_types_json ? JSON.parse(row.node_types_json) : {},
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      createdAt: row.created_at,
      canManage: session.user.role === "admin" || row.created_by === session.user.id,
    }));

    return NextResponse.json({ templates });
  } catch (error) {
    console.error("Error listing canvas templates:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Crea un template desde el canvas vivo de una conversación.
// Body: { name: string, description?: string, conversation_id: number }
// El snapshot se toma server-side desde la BD (nodos/edges con
// deleted_at IS NULL), sanitizado: se conservan outputUrl/outputText como
// referencia pero se limpian outputMessageId, outputHistory y los campos de
// practicante que apuntan a la conversación origen.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : null;
    const conversationId = Number(body?.conversation_id);

    if (!name) {
      return NextResponse.json({ error: "name requerido" }, { status: 400 });
    }
    if (!conversationId) {
      return NextResponse.json({ error: "conversation_id requerido" }, { status: 400 });
    }

    const [convRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM conversations WHERE id = ? AND deleted_at IS NULL`,
      [conversationId]
    );
    if (convRows.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const [nodeRows] = await pool.execute<CanvasNodeRow[]>(
      `SELECT * FROM canvas_nodes
       WHERE conversation_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [conversationId]
    );
    if (nodeRows.length === 0) {
      return NextResponse.json({ error: "El canvas no tiene nodos" }, { status: 400 });
    }

    const [edgeRows] = await pool.execute<CanvasEdgeRow[]>(
      `SELECT * FROM canvas_edges
       WHERE conversation_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [conversationId]
    );

    const nodes = nodeRows.map(sanitizeNodeForTemplate);
    const edges = edgeRows.map(edgeRowToTemplate);

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO canvas_templates
        (name, description, nodes_json, edges_json, node_count, edge_count,
         node_types_json, source_conversation_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        description || null,
        JSON.stringify(nodes),
        JSON.stringify(edges),
        nodes.length,
        edges.length,
        JSON.stringify(countNodeTypes(nodes)),
        conversationId,
        session.user.id,
      ]
    );

    return NextResponse.json({
      id: result.insertId,
      name,
      description,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    });
  } catch (error) {
    console.error("Error creating canvas template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
