import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { stageScript } from "@/lib/script-stager";

// Generous timeout — staging can take ~30-60s with thinking-enabled models.
export const maxDuration = 300;

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number;
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

// POST - Take a raw script/idea and return a staged screenplay (with INT./EXT.,
// action, VO/dialogue, super impuestos). The result REPLACES the prompt of the
// Script node on the frontend; this endpoint does NOT persist to the node's
// config — the frontend handles that via autosave or PATCH.
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
    const { prompt, modelId, temperature, maxOutputTokens, systemInstruction, thinkingLevel } = body as {
      prompt: string;
      modelId?: number;
      temperature?: number;
      maxOutputTokens?: number;
      systemInstruction?: string;
      thinkingLevel?: "none" | "low" | "medium" | "high";
    };

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json({ error: "El texto está vacío" }, { status: 400 });
    }

    // Resolve model: explicit modelId from frontend, else default text model of the project
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

    try {
      const result = await stageScript({
        modelString,
        apiBackend,
        prompt,
        temperature,
        maxOutputTokens,
        systemInstruction,
        thinkingLevel,
        labels,
      });
      return NextResponse.json({
        stagedPrompt: result.stagedPrompt,
        tokenCount: result.tokenCount,
        modelName: modelDisplayName,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error escenificando el guion";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  } catch (error) {
    console.error("Error in stage endpoint:", error);
    const msg = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
