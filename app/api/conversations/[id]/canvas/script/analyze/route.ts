import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { analyzeScript } from "@/lib/script-analyzer";
import type { ScriptAnalysisAlt, ScriptNodeData } from "@/components/canvas/lib/canvas-types";

// Generous timeout — 3 alternatives + structured output can take ~60-90s.
export const maxDuration = 300;

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number;
}

interface NodeRow extends RowDataPacket {
  id: string;
  type: string;
  config: string;
}

interface ModelRow extends RowDataPacket {
  id: number;
  model_id: string;
  display_name: string;
  api_backend: string | null;
}

interface ProjectRow extends RowDataPacket {
  title: string;
}

interface UserRow extends RowDataPacket {
  name: string | null;
}

// POST - Analyze a script (call Gemini with structured output) and persist scriptAnalysis on the node
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

    const [convRows] = await pool.execute<ConversationRow[]>(
      `SELECT id, user_id, project_id FROM conversations WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    if (convRows.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }
    const conversation = convRows[0];

    const body = await request.json();
    const { nodeId, prompt, modelId, temperature, maxOutputTokens, systemInstruction } = body as {
      nodeId: string;
      prompt: string;
      modelId?: number;
      temperature?: number;
      maxOutputTokens?: number;
      systemInstruction?: string;
    };

    if (!nodeId || typeof nodeId !== "string") {
      return NextResponse.json({ error: "nodeId requerido" }, { status: 400 });
    }
    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json({ error: "El guion está vacío" }, { status: 400 });
    }

    // Verificar que el nodo exista y sea de tipo script
    const [nodeRows] = await pool.execute<NodeRow[]>(
      `SELECT id, type, config FROM canvas_nodes WHERE id = ? AND conversation_id = ?`,
      [nodeId, id]
    );
    if (nodeRows.length === 0) {
      return NextResponse.json({ error: "Nodo no encontrado" }, { status: 404 });
    }
    if (nodeRows[0].type !== "script") {
      return NextResponse.json({ error: "El nodo no es de tipo Guión" }, { status: 400 });
    }

    // Resolver modelo: si llega modelId numérico, busca en DB; si no, usa el default de generation_type=text
    let modelString: string | null = null;
    let apiBackend: string | undefined = undefined;
    let modelDisplayName: string | null = null;

    if (modelId) {
      const [modelRows] = await pool.execute<ModelRow[]>(
        `SELECT id, model_id, display_name, api_backend FROM models WHERE id = ?`,
        [modelId]
      );
      if (modelRows.length > 0) {
        modelString = modelRows[0].model_id;
        apiBackend = modelRows[0].api_backend || undefined;
        modelDisplayName = modelRows[0].display_name;
      }
    }

    if (!modelString) {
      // Fallback: primer modelo de texto disponible para el proyecto.
      // Requires project_generation_config.is_enabled = 1 for text and at least
      // one row in project_generation_models for that project + generation_type.
      const [defaultRows] = await pool.execute<ModelRow[]>(
        `SELECT m.id, m.model_id, m.display_name, m.api_backend
         FROM models m
         INNER JOIN project_generation_models pgm ON pgm.model_id = m.id
         INNER JOIN project_generation_config pgc
           ON pgc.project_id = pgm.project_id AND pgc.generation_type = pgm.generation_type
         WHERE pgm.project_id = ?
           AND pgm.generation_type = 'text'
           AND pgc.is_enabled = 1
         ORDER BY pgm.is_default DESC, pgm.sort_order ASC, m.id ASC
         LIMIT 1`,
        [conversation.project_id]
      );
      if (defaultRows.length > 0) {
        modelString = defaultRows[0].model_id;
        apiBackend = defaultRows[0].api_backend || undefined;
        modelDisplayName = defaultRows[0].display_name;
      }
    }

    if (!modelString) {
      return NextResponse.json({ error: "No hay un modelo de texto disponible" }, { status: 400 });
    }

    // Etiquetas para Vertex AI
    const [projectRows] = await pool.execute<ProjectRow[]>(
      `SELECT title FROM projects WHERE id = ?`,
      [conversation.project_id]
    );
    const [userRows] = await pool.execute<UserRow[]>(
      `SELECT name FROM users WHERE id = ?`,
      [conversation.user_id]
    );
    const labels = {
      project_name: projectRows[0]?.title,
      user_name: userRows[0]?.name || undefined,
    };

    // Llamar al analyzer
    let result;
    try {
      result = await analyzeScript({
        modelString,
        apiBackend,
        prompt,
        temperature,
        maxOutputTokens,
        systemInstruction,
        labels,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error analizando el guion";
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    // Persistir alternativas en config del nodo (merge con config existente).
    // La primera alternativa queda como "activa" — script-node muestra los tabs
    // y al cambiar de tab, el frontend sincroniza scriptAnalysis con la elegida.
    let existingConfig: Record<string, unknown> = {};
    try {
      const raw = nodeRows[0].config;
      existingConfig = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw)) as Record<string, unknown>;
    } catch {}

    const alternatives: ScriptAnalysisAlt[] = result.analyses;
    const activeIndex = 0;

    // NOTE: we deliberately do NOT overwrite `prompt` in the persisted config.
    // The frontend may be analyzing a staged version of the text (Escenificar)
    // while keeping the user's original prompt visible in the textarea. The
    // frontend persists prompt/model fields via autosave; this endpoint only
    // owns scriptAnalysis + scriptAnalysisAlternatives.
    const newConfig: Record<string, unknown> = {
      ...existingConfig,
      scriptAnalysis: alternatives[activeIndex] satisfies ScriptNodeData["scriptAnalysis"],
      scriptAnalysisAlternatives: alternatives,
      activeAnalysisIndex: activeIndex,
    };

    await pool.execute(
      `UPDATE canvas_nodes SET config = ?, status = 'completed', error_message = NULL WHERE id = ? AND conversation_id = ?`,
      [JSON.stringify(newConfig), nodeId, id]
    );

    return NextResponse.json({
      analyses: alternatives,
      activeAnalysisIndex: activeIndex,
      warnings: result.warnings,
      tokenCount: result.tokenCount,
      modelName: modelDisplayName,
    });
  } catch (error) {
    console.error("Error analyzing script:", error);
    const msg = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
