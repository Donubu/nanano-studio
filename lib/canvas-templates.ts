// Serialización y sanitización de snapshots para canvas_templates.
//
// Un template guarda nodos/edges en el mismo shape cliente que devuelve
// GET /api/conversations/[id]/canvas, de modo que instanciarlo es un insert
// directo sin transformación. La sanitización conserva los outputs como
// referencia visual (outputUrl/outputText) pero elimina todo lo que apunta a
// la conversación origen y no tiene sentido en la conversación instanciada.

export interface TemplateNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  data: Record<string, unknown>;
}

export interface TemplateEdge {
  id: string;
  source: string;
  sourceHandle: string | null;
  target: string;
  targetHandle: string | null;
}

// Campos dentro de config que referencian la conversación origen (historial
// de mensajes, conversación de practicante, telemetría de la última corrida).
const CONFIG_FIELDS_TO_STRIP = [
  "outputHistory",
  "conversationId",
  "tokensUsed",
  "estimatedCost",
  "dryRunResponse",
  "files",
  "toolsUsed",
  "delegatedTo",
] as const;

interface DbNodeRow {
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

interface DbEdgeRow {
  id: string;
  source_node_id: string;
  source_handle: string | null;
  target_node_id: string;
  target_handle: string | null;
}

export function sanitizeNodeForTemplate(row: DbNodeRow): TemplateNode {
  const config = JSON.parse(
    typeof row.config === "string" ? row.config : JSON.stringify(row.config)
  ) as Record<string, unknown>;

  for (const field of CONFIG_FIELDS_TO_STRIP) {
    delete config[field];
  }

  // "generating" y "error" son estados transitorios de la conversación
  // origen; el template parte limpio. "completed" se conserva para que el
  // output de referencia se muestre en el canvas instanciado.
  const status = row.status === "completed" ? "completed" : "idle";

  return {
    id: row.id,
    type: row.type,
    position: { x: row.position_x, y: row.position_y },
    ...(row.width && row.height ? { width: row.width, height: row.height } : {}),
    data: {
      ...config,
      label: row.label,
      status,
      outputMessageId: null,
      outputUrl: row.output_url,
      outputText: row.output_text,
      errorMessage: null,
    },
  };
}

export function edgeRowToTemplate(row: DbEdgeRow): TemplateEdge {
  return {
    id: row.id,
    source: row.source_node_id,
    sourceHandle: row.source_handle,
    target: row.target_node_id,
    targetHandle: row.target_handle,
  };
}

/** Conteo por tipo de nodo, ej. {"image": 3, "text": 2}. */
export function countNodeTypes(nodes: TemplateNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of nodes) {
    counts[node.type] = (counts[node.type] || 0) + 1;
  }
  return counts;
}
