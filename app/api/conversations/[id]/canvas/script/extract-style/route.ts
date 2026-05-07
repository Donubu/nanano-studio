import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { extractStyleFromImages } from "@/lib/style-extractor";

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

// POST - Extract a style prompt from a list of reference image URLs.
// Used by the "Extraer estilo desde galería" button on Params Escena nodes.
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
    const { imageUrls, modelId } = body as {
      imageUrls: string[];
      modelId?: number;
    };

    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      return NextResponse.json({ error: "Se requiere al menos una imagen" }, { status: 400 });
    }

    // Resolver modelo: el usuario puede pasar uno explícito o caemos al default
    // de generation_type 'text' (los modelos de texto Gemini 2.5+ son multimodales).
    let modelString: string | null = null;
    let apiBackend: string | undefined = undefined;

    if (modelId) {
      const [modelRows] = await pool.execute<ModelRow[]>(
        `SELECT id, model_id, display_name, api_backend FROM models WHERE id = ?`,
        [modelId]
      );
      if (modelRows.length > 0) {
        modelString = modelRows[0].model_id;
        apiBackend = modelRows[0].api_backend || undefined;
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
      const result = await extractStyleFromImages({
        modelString,
        apiBackend,
        imageUrls,
        labels,
      });
      return NextResponse.json({
        stylePrompt: result.stylePrompt,
        tokenCount: result.tokenCount,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error extrayendo estilo";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  } catch (error) {
    console.error("Error in extract-style:", error);
    const msg = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
