import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import type { TemplateNode, TemplateEdge } from "@/lib/canvas-templates";

interface ConversationCheckRow extends RowDataPacket {
  id: number;
  user_id: number;
}

interface TemplateRow extends RowDataPacket {
  id: number;
  name: string;
  nodes_json: string;
  edges_json: string;
}

// POST - Inserta un template en esta conversación (estilo snippet).
// Body: { templateId: number, position?: { x: number, y: number } }
//
// Funciona sobre canvas vacío O con contenido: los nodos/edges del template
// se insertan con IDs frescos (node-tpl<ts>-N), así que nunca colisionan con
// los nodos existentes de la conversación. Las referencias internas se
// remapean (edges y scene.scriptNodeId).
//
// `position` (coords de flow) ancla la esquina superior-izquierda del bounding
// box del template; el layout relativo entre nodos se preserva. Sin position,
// se conservan las coordenadas originales del template.
//
// El cliente que inserta recibe los nodos/edges remapeados en la respuesta,
// los agrega a su estado y los emite por el socket de colaboración (mismo
// flujo que agregar nodos a mano) — este endpoint no broadcastea.
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
    const [convRows] = await pool.execute<ConversationCheckRow[]>(
      `SELECT id, user_id FROM conversations WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    if (convRows.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const body = await request.json();
    const templateId = Number(body?.templateId);
    if (!templateId) {
      return NextResponse.json({ error: "templateId requerido" }, { status: 400 });
    }
    const position = body?.position as { x: number; y: number } | undefined;

    const [templateRows] = await pool.execute<TemplateRow[]>(
      `SELECT id, name, nodes_json, edges_json FROM canvas_templates
       WHERE id = ? AND deleted_at IS NULL`,
      [templateId]
    );
    if (templateRows.length === 0) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }

    const templateNodes = JSON.parse(templateRows[0].nodes_json) as TemplateNode[];
    const templateEdges = JSON.parse(templateRows[0].edges_json) as TemplateEdge[];
    if (templateNodes.length === 0) {
      return NextResponse.json({ error: "El template no tiene nodos" }, { status: 400 });
    }

    // IDs frescos por inserción. No siguen el contador node-N del cliente
    // (el sufijo no-numérico hace que loadCanvas los ignore al recalcular el
    // contador), así que dos inserciones del mismo template tampoco chocan.
    const stamp = Date.now().toString(36);
    const idMap = new Map<string, string>();
    templateNodes.forEach((node, i) => {
      idMap.set(node.id, `node-tpl${stamp}-${i + 1}`);
    });

    let dx = 0;
    let dy = 0;
    if (position && typeof position.x === "number" && typeof position.y === "number") {
      const minX = Math.min(...templateNodes.map((n) => n.position.x));
      const minY = Math.min(...templateNodes.map((n) => n.position.y));
      dx = position.x - minX;
      dy = position.y - minY;
    }

    const nodes = templateNodes.map((node) => {
      const data = { ...((node.data ?? {}) as Record<string, unknown>) };
      // Referencia interna escena → guión: apunta al ID remapeado.
      if (typeof data.scriptNodeId === "string" && idMap.has(data.scriptNodeId)) {
        data.scriptNodeId = idMap.get(data.scriptNodeId)!;
      }
      return {
        ...node,
        id: idMap.get(node.id)!,
        position: { x: node.position.x + dx, y: node.position.y + dy },
        data,
      };
    });

    const edges = templateEdges
      .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge, i) => ({
        ...edge,
        id: `e-tpl${stamp}-${i + 1}`,
        source: idMap.get(edge.source)!,
        target: idMap.get(edge.target)!,
      }));

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const node of nodes) {
        const { label, status, outputMessageId, outputUrl, outputText, errorMessage, type: _nodeType, ...configData } =
          node.data;
        void _nodeType;
        await conn.execute(
          `INSERT INTO canvas_nodes
            (id, conversation_id, type, label, position_x, position_y, width, height,
             config, status, output_message_id, output_url, output_text, error_message)
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

      for (const edge of edges) {
        await conn.execute(
          `INSERT INTO canvas_edges
            (id, conversation_id, source_node_id, source_handle, target_node_id, target_handle)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            edge.id,
            id,
            edge.source,
            edge.sourceHandle ?? null,
            edge.target,
            edge.targetHandle ?? null,
          ]
        );
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return NextResponse.json({
      success: true,
      templateId,
      templateName: templateRows[0].name,
      nodes,
      edges,
    });
  } catch (error) {
    console.error("Error inserting canvas template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
