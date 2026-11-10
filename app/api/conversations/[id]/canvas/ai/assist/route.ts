// POST /api/conversations/[id]/canvas/ai/assist — asistente del canvas.
//
// Recibe el pedido del usuario y un snapshot compacto del canvas, le pide a
// Gemini operaciones chicas (crear/editar/borrar nodos, conectar) y devuelve
// un plan ya validado con las reglas de conexión y las capacidades de cada
// modelo. NO escribe el canvas: el cliente aplica el plan con la misma
// persistencia y colaboración que un cambio a mano, y puede deshacerlo.

import { NextRequest, NextResponse } from "next/server";
import { RowDataPacket } from "mysql2";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { generateJson } from "@/lib/production/gemini-json";
import {
  buildAssistPlan,
  planIsEmpty,
  type AssistModel,
  type AssistModels,
  type AssistResponse,
  type AssistSnapshotEdge,
  type AssistSnapshotNode,
} from "@/lib/canvas-ai/assist-plan";
import { ASSIST_SCHEMA, ASSIST_SYSTEM_INSTRUCTION, buildAssistUserText } from "@/lib/canvas-ai/assist-prompt";

export const maxDuration = 120;

const MODEL = process.env.CANVAS_AI_ASSIST_MODEL || "gemini-3.8-flash";
const HOURLY_LIMIT = Number(process.env.CANVAS_AI_HOURLY_CALLS_PER_USER ?? 30);
const MAX_INSTRUCTION_CHARS = 4000;
const MAX_SNAPSHOT_NODES = 300;
const MAX_NODE_TEXT = 600;
const RELAYOUT_WORDS = /\b(re)?orden|acomod|organiz|layout|alinea|despeja/i;

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number | null;
}

interface ModelRow extends RowDataPacket, AssistModel {
  generation_type: string;
}

interface CountRow extends RowDataPacket {
  n: number;
}

function cleanSnapshot(raw: unknown): { nodes: AssistSnapshotNode[]; edges: AssistSnapshotEdge[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(r.nodes) || !Array.isArray(r.edges)) return null;
  const nodes: AssistSnapshotNode[] = [];
  for (const n of r.nodes.slice(0, MAX_SNAPSHOT_NODES)) {
    if (!n || typeof n !== "object") continue;
    const o = n as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.type !== "string") continue;
    nodes.push({
      id: o.id,
      type: o.type,
      label: typeof o.label === "string" ? o.label.slice(0, 80) : undefined,
      text: typeof o.text === "string" ? o.text.slice(0, MAX_NODE_TEXT) : undefined,
      modelId: typeof o.modelId === "number" ? o.modelId : undefined,
      aspectRatio: typeof o.aspectRatio === "string" ? o.aspectRatio : undefined,
      resolution: typeof o.resolution === "string" ? o.resolution : undefined,
      duration: typeof o.duration === "number" ? o.duration : undefined,
      hasOutput: o.hasOutput === true,
      locked: o.locked === true,
      stages: Array.isArray(o.stages)
        ? (o.stages as unknown[]).slice(0, 30).flatMap((st) => {
            if (!st || typeof st !== "object") return [];
            const x = st as Record<string, unknown>;
            if (typeof x.id !== "string") return [];
            return [{
              id: x.id,
              name: typeof x.name === "string" ? x.name.slice(0, 80) : "",
              text: typeof x.text === "string" ? x.text.slice(0, 2000) : "",
              referenceImages: Array.isArray(x.referenceImages)
                ? (x.referenceImages as unknown[]).slice(0, 24).flatMap((r) => {
                    const y = r as Record<string, unknown> | null;
                    return y && typeof y.nodeId === "string" && typeof y.url === "string" ? [{ nodeId: y.nodeId, url: y.url }] : [];
                  })
                : undefined,
              imageNodeId: typeof x.imageNodeId === "string" ? x.imageNodeId : undefined,
            }];
          })
        : undefined,
      dna: typeof o.dna === "string" ? o.dna.slice(0, 2000) : undefined,
      images: Array.isArray(o.images)
        ? (o.images as unknown[]).filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u)).slice(0, 24)
        : undefined,
    });
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: AssistSnapshotEdge[] = [];
  for (const e of r.edges) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.source !== "string" || typeof o.target !== "string") continue;
    if (!ids.has(o.source) || !ids.has(o.target)) continue;
    edges.push({
      id: o.id,
      source: o.source,
      target: o.target,
      sourceHandle: typeof o.sourceHandle === "string" ? o.sourceHandle : null,
      targetHandle: typeof o.targetHandle === "string" ? o.targetHandle : null,
    });
  }
  return { nodes, edges };
}

async function loadProjectModels(projectId: number | null): Promise<AssistModels> {
  if (!projectId) return {};
  const [rows] = await pool.execute<ModelRow[]>(
    `SELECT pgm.generation_type, m.id, m.model_id, m.display_name, m.api_backend, pgm.is_default
     FROM project_generation_models pgm
     JOIN project_generation_config pgc
       ON pgc.project_id = pgm.project_id AND pgc.generation_type = pgm.generation_type
     JOIN models m ON m.id = pgm.model_id
     WHERE pgm.project_id = ? AND pgc.is_enabled = 1 AND m.is_active = 1
       AND pgm.generation_type IN ('text', 'image', 'video')
     ORDER BY pgm.is_default DESC, pgm.sort_order ASC, m.id ASC`,
    [projectId],
  );
  const out: AssistModels = {};
  for (const r of rows) {
    const gen = r.generation_type as "text" | "image" | "video";
    (out[gen] ??= []).push({
      id: r.id,
      model_id: r.model_id,
      display_name: r.display_name,
      api_backend: r.api_backend,
      is_default: Boolean(r.is_default),
    });
  }
  return out;
}

async function logInvocation(row: {
  conversationId: number;
  projectId: number | null;
  userId: number;
  instruction: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  durationMs: number;
  counts?: { na: number; nu: number; nr: number; ea: number; er: number };
  success: boolean;
  error?: string;
}) {
  try {
    const c = row.counts ?? { na: 0, nu: 0, nr: 0, ea: 0, er: 0 };
    await pool.execute(
      `INSERT INTO canvas_ai_invocations
        (conversation_id, project_id, user_id, model, instruction, input_tokens, output_tokens,
         estimated_cost, duration_ms, nodes_added, nodes_updated, nodes_removed, edges_added,
         edges_removed, success, error_msg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.conversationId, row.projectId, row.userId, MODEL, row.instruction.slice(0, 4000),
        row.inputTokens, row.outputTokens, row.cost, row.durationMs,
        c.na, c.nu, c.nr, c.ea, c.er, row.success, row.error?.slice(0, 2000) ?? null,
      ],
    );
  } catch (err) {
    console.error("[canvas-ai] no se pudo registrar la invocación", err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const userId = Number(session.user.id);

  const { id } = await params;
  const [convRows] = await pool.execute<ConversationRow[]>(
    `SELECT id, user_id, project_id FROM conversations WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (convRows.length === 0) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
  const conversation = convRows[0];

  const body = (await request.json().catch(() => null)) as {
    instruction?: unknown;
    snapshot?: unknown;
    selected_ids?: unknown;
  } | null;
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  if (instruction.length < 2) return NextResponse.json({ error: "Escribe qué quieres hacer en el canvas." }, { status: 400 });
  if (instruction.length > MAX_INSTRUCTION_CHARS) {
    return NextResponse.json({ error: `El pedido es muy largo (máximo ${MAX_INSTRUCTION_CHARS} caracteres).` }, { status: 400 });
  }
  const snapshot = cleanSnapshot(body?.snapshot);
  if (!snapshot) return NextResponse.json({ error: "Falta el estado del canvas." }, { status: 400 });
  const selectedIds = Array.isArray(body?.selected_ids)
    ? (body!.selected_ids as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 50)
    : [];

  if (HOURLY_LIMIT > 0) {
    const [countRows] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS n FROM canvas_ai_invocations
       WHERE user_id = ? AND created_at > NOW() - INTERVAL 1 HOUR`,
      [userId],
    );
    if ((countRows[0]?.n ?? 0) >= HOURLY_LIMIT) {
      return NextResponse.json(
        { error: `Llegaste al límite de ${HOURLY_LIMIT} pedidos por hora al asistente. Intenta en un rato.`, code: "CANVAS_AI_RATE_LIMIT" },
        { status: 429 },
      );
    }
  }

  const models = await loadProjectModels(conversation.project_id);
  const started = Date.now();
  const base = {
    conversationId: conversation.id,
    projectId: conversation.project_id,
    userId,
    instruction,
  };

  try {
    const { data, usage } = await generateJson<AssistResponse>({
      model: MODEL,
      systemInstruction: ASSIST_SYSTEM_INSTRUCTION,
      schema: ASSIST_SCHEMA,
      parts: [{ text: buildAssistUserText({ instruction, ...snapshot, selectedIds, models }) }],
      temperature: 0.4,
      maxOutputTokens: 32768,
      operationName: "canvasAssist",
      abortSignal: request.signal,
    });

    // Reordenar mueve los nodos del usuario: solo si el pedido lo menciona,
    // aunque el modelo lo proponga por su cuenta.
    if (data.relayout === "all" && snapshot.nodes.length > 0 && !RELAYOUT_WORDS.test(instruction)) {
      data.relayout = "none";
    }
    const plan = buildAssistPlan(data, snapshot, models);
    await logInvocation({
      ...base,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cost: Number(usage.estimatedCost.toFixed(6)),
      durationMs: Date.now() - started,
      counts: {
        na: plan.addNodes.length,
        nu: plan.updates.length,
        nr: plan.removeNodeIds.length,
        ea: plan.addEdges.length,
        er: plan.removeEdgeIds.length,
      },
      success: true,
    });

    return NextResponse.json({ plan, empty: planIsEmpty(plan), cost: usage.estimatedCost });
  } catch (err) {
    const e = err as Error & { usage?: { inputTokens: number; outputTokens: number; estimatedCost: number } };
    await logInvocation({
      ...base,
      inputTokens: e.usage?.inputTokens ?? null,
      outputTokens: e.usage?.outputTokens ?? null,
      cost: e.usage ? Number(e.usage.estimatedCost.toFixed(6)) : null,
      durationMs: Date.now() - started,
      success: false,
      error: e.message,
    });
    if (request.signal.aborted) return NextResponse.json({ error: "Pedido cancelado" }, { status: 499 });
    console.error("[canvas-ai] assist failed", e);
    return NextResponse.json({ error: `La IA no pudo procesar el pedido: ${e.message}` }, { status: 502 });
  }
}
