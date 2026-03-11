import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { sendMessage, ChatMessage, isConfigured, Labels } from "@/lib/google-ai";

interface MessageRow extends RowDataPacket {
  id: number;
  conversation_id: number;
  role: "user" | "model";
  content: string;
  content_type: "text" | "image" | "mixed";
  image_url: string | null;
  image_mime_type: string | null;
  tokens_input: number;
  tokens_output: number;
  created_at: Date;
}

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  model_id: number;
  model_model_id: string;
  system_instruction: string | null;
  temperature: number;
  top_p: number;
  top_k: number;
  max_output_tokens: number;
  image_aspect_ratio: string;
  image_size: string;
  supports_image_generation: boolean;
  project_name: string | null;
  client_name: string | null;
  model_api_backend: string | null;
}

// GET - Obtener mensajes de una conversación
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
    const isAdmin = session.user.role === "admin";

    // Verificar que la conversación pertenece al usuario
    const [conversation] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM conversations WHERE id = ? ${isAdmin ? "" : "AND user_id = ?"}`,
      isAdmin ? [id] : [id, session.user.id]
    );

    if (conversation.length === 0) {
      return NextResponse.json(
        { error: "Conversación no encontrada" },
        { status: 404 }
      );
    }

    const [messages] = await pool.execute<MessageRow[]>(
      `SELECT id, conversation_id, role, content_type, content, thought, image_url, image_mime_type,
              tokens_input, tokens_output, grounding_data, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`,
      [id]
    );

    // Parse grounding_data JSON for messages that have it
    const messagesWithParsedGrounding = messages.map(msg => {
      const raw = msg as Record<string, unknown>;
      let grounding_data = null;
      if (raw.grounding_data) {
        try {
          grounding_data = typeof raw.grounding_data === 'string'
            ? JSON.parse(raw.grounding_data)
            : raw.grounding_data;
        } catch {}
      }
      return { ...msg, grounding_data };
    });

    return NextResponse.json(messagesWithParsedGrounding);
  } catch (error) {
    console.error("Error obteniendo mensajes:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// POST - Enviar mensaje y obtener respuesta del modelo (sin streaming)
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
    const body = await request.json();
    const { content, image_url, image_mime_type } = body;

    if (!content || content.trim() === "") {
      return NextResponse.json(
        { error: "El contenido del mensaje es requerido" },
        { status: 400 }
      );
    }

    // Obtener conversación con configuración y nombre del proyecto
    const isAdmin = session.user.role === "admin";
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT c.*, m.model_id as model_model_id, m.supports_image_generation, m.api_backend as model_api_backend, p.title as project_name, cl.name as client_name
       FROM conversations c
       JOIN models m ON c.model_id = m.id
       LEFT JOIN projects p ON c.project_id = p.id
       LEFT JOIN clients cl ON p.client_id = cl.id
       WHERE c.id = ? ${isAdmin ? "" : "AND c.user_id = ?"}`,
      isAdmin ? [id] : [id, session.user.id]
    );

    if (conversations.length === 0) {
      return NextResponse.json(
        { error: "Conversación no encontrada" },
        { status: 404 }
      );
    }

    const conversation = conversations[0];

    // Determinar tipo de contenido
    const contentType = image_url ? (content ? "mixed" : "image") : "text";

    // Guardar mensaje del usuario
    const [userMessageResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO messages (conversation_id, role, content_type, content, image_url, image_mime_type)
       VALUES (?, 'user', ?, ?, ?, ?)`,
      [id, contentType, content, image_url || null, image_mime_type || null]
    );

    // Obtener historial de mensajes para contexto
    const [historyRows] = await pool.execute<MessageRow[]>(
      `SELECT role, content, image_url, image_mime_type
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`,
      [id]
    );

    // Convertir historial al formato de ChatMessage
    const messages: ChatMessage[] = historyRows.map((msg) => ({
      role: msg.role,
      content: msg.content,
      imageUrl: msg.image_url,
      imageMimeType: msg.image_mime_type,
    }));

    // Actualizar timestamp de la conversación
    await pool.execute(
      "UPDATE conversations SET updated_at = NOW() WHERE id = ?",
      [id]
    );

    let modelResponse: string;
    let tokensInput = 0;
    let tokensOutput = 0;
    let isError = false;

    // Preparar labels para tracking en Vertex AI
    // Usar solo la parte inicial del email para no exponer datos sensibles
    const userIdentifier = session.user.email?.split("@")[0] || "unknown";
    const labels: Labels = {
      project_name: conversation.client_name ? `${conversation.client_name} > ${conversation.project_name}` : conversation.project_name || "sin_proyecto",
      user_name: userIdentifier,
    };

    // Intentar usar Google AI si está configurado
    if (isConfigured()) {
      try {
        const result = await sendMessage(
          conversation.model_model_id,
          messages,
          conversation.system_instruction,
          {
            temperature: Number(conversation.temperature),
            topP: Number(conversation.top_p),
            topK: conversation.top_k,
            maxOutputTokens: conversation.max_output_tokens,
            // Incluir configuración de imagen solo si el modelo lo soporta
            ...(conversation.supports_image_generation && {
              imageConfig: {
                aspectRatio: conversation.image_aspect_ratio as "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9",
                imageSize: conversation.image_size as "1K" | "2K" | "4K",
              },
            }),
          },
          labels,
          conversation.model_api_backend || undefined
        );
        modelResponse = result.text;
        tokensInput = result.tokenCount.input;
        tokensOutput = result.tokenCount.output;
      } catch (aiError) {
        console.error("Error llamando a Google AI:", aiError);
        modelResponse = `Error al generar respuesta: ${aiError instanceof Error ? aiError.message : "Error desconocido"}`;
        isError = true;
      }
    } else {
      modelResponse = `API de Google AI no configurada. Por favor, configure GOOGLE_API_KEY en las variables de entorno.`;
      isError = true;
    }

    // Guardar respuesta del modelo (usar content_type 'error' si hubo error para excluirlo del historial)
    const contentTypeResponse = isError ? "error" : "text";
    const [modelMessageResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO messages (conversation_id, role, content_type, content, tokens_input, tokens_output)
       VALUES (?, 'model', ?, ?, ?, ?)`,
      [id, contentTypeResponse, modelResponse, tokensInput, tokensOutput]
    );

    // Si hubo error, marcar el mensaje del usuario con ignore_in_context para no enviarlo como contexto
    if (isError) {
      await pool.execute(
        `UPDATE messages SET ignore_in_context = 1 WHERE id = ?`,
        [userMessageResult.insertId]
      );
    }

    return NextResponse.json({
      userMessage: {
        id: userMessageResult.insertId,
        role: "user",
        content,
        content_type: contentType,
        image_url: image_url || null,
      },
      modelMessage: {
        id: modelMessageResult.insertId,
        role: "model",
        content: modelResponse,
        content_type: "text",
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
      },
    });
  } catch (error) {
    console.error("Error enviando mensaje:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
