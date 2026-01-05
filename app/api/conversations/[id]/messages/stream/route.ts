import { NextRequest } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { sendMessageStream, ChatMessage, isConfigured, Labels, GeneratedImage, generateConversationTitle } from "@/lib/google-ai";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

// Guardar imagen base64 en archivo y retornar la URL pública
async function saveGeneratedImage(image: GeneratedImage, conversationId: string): Promise<string> {
  const uploadsDir = path.join(process.cwd(), "public", "uploads", "generated");

  // Asegurar que el directorio existe
  await mkdir(uploadsDir, { recursive: true });

  // Generar nombre único para el archivo
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 8);
  const extension = image.mimeType.split("/")[1] || "png";
  const fileName = `${conversationId}_${timestamp}_${randomId}.${extension}`;
  const filePath = path.join(uploadsDir, fileName);

  // Decodificar base64 y guardar
  const buffer = Buffer.from(image.data, "base64");
  await writeFile(filePath, buffer);

  // Retornar URL pública
  return `/uploads/generated/${fileName}`;
}

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
  project_id: number | null;
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
}

interface ProjectModelRow extends RowDataPacket {
  system_instruction: string | null;
}

// POST - Enviar mensaje y obtener respuesta con streaming
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!isConfigured()) {
      return new Response(JSON.stringify({ error: "API de Google AI no configurada" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { id } = await params;
    const body = await request.json();
    const { content, image_url, image_mime_type, useProjectSystemInstruction = true } = body;

    if (!content || content.trim() === "") {
      return new Response(JSON.stringify({ error: "El contenido del mensaje es requerido" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Obtener conversación con configuración y nombre del proyecto
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT c.*, m.model_id as model_model_id, m.supports_image_generation, p.title as project_name
       FROM conversations c
       JOIN models m ON c.model_id = m.id
       LEFT JOIN projects p ON c.project_id = p.id
       WHERE c.id = ? AND c.user_id = ? AND c.deleted_at IS NULL`,
      [id, session.user.id]
    );

    if (conversations.length === 0) {
      return new Response(JSON.stringify({ error: "Conversación no encontrada" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const conversation = conversations[0];

    // Obtener system instruction del proyecto-modelo si existe
    let projectSystemInstruction: string | null = null;
    if (conversation.project_id && useProjectSystemInstruction) {
      const [projectModels] = await pool.execute<ProjectModelRow[]>(
        `SELECT system_instruction FROM project_models
         WHERE project_id = ? AND model_id = ?`,
        [conversation.project_id, conversation.model_id]
      );
      if (projectModels.length > 0) {
        projectSystemInstruction = projectModels[0].system_instruction;
      }
    }

    // Concatenar system instructions
    let finalSystemInstruction: string | null = null;
    if (projectSystemInstruction && conversation.system_instruction) {
      finalSystemInstruction = `${projectSystemInstruction}\n\n${conversation.system_instruction}`;
    } else if (projectSystemInstruction) {
      finalSystemInstruction = projectSystemInstruction;
    } else {
      finalSystemInstruction = conversation.system_instruction;
    }

    // Debug: log system instructions
    console.log("[Stream] System Instructions:", {
      conversationId: conversation.id,
      useProjectSystemInstruction,
      projectSystemInstruction: projectSystemInstruction ? `"${projectSystemInstruction.substring(0, 100)}${projectSystemInstruction.length > 100 ? '...' : ''}"` : null,
      conversationSystemInstruction: conversation.system_instruction ? `"${conversation.system_instruction.substring(0, 100)}${conversation.system_instruction.length > 100 ? '...' : ''}"` : null,
      finalSystemInstruction: finalSystemInstruction ? `"${finalSystemInstruction.substring(0, 200)}${finalSystemInstruction.length > 200 ? '...' : ''}"` : null,
    });

    // Debug: log image settings
    console.log("[Stream] Image settings:", {
      supports_image_generation: conversation.supports_image_generation,
      image_aspect_ratio: conversation.image_aspect_ratio,
      image_size: conversation.image_size,
    });

    // Determinar tipo de contenido
    const contentType = image_url ? (content ? "mixed" : "image") : "text";

    // Guardar mensaje del usuario
    const [userMessageResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO messages (conversation_id, role, content_type, content, image_url, image_mime_type)
       VALUES (?, 'user', ?, ?, ?, ?)`,
      [id, contentType, content, image_url || null, image_mime_type || null]
    );

    const userMessageId = userMessageResult.insertId;

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

    // Detectar si es el primer mensaje (solo hay 1 mensaje en el historial)
    const isFirstMessage = historyRows.length === 1;

    // Actualizar timestamp de la conversación
    await pool.execute(
      "UPDATE conversations SET updated_at = NOW() WHERE id = ?",
      [id]
    );

    // Preparar labels para tracking en Vertex AI
    // Usar solo la parte inicial del email para no exponer datos sensibles
    const userIdentifier = session.user.email?.split("@")[0] || "unknown";
    const labels: Labels = {
      project_name: conversation.project_name || "sin_proyecto",
      user_name: userIdentifier,
    };

    // Crear el stream de respuesta
    const encoder = new TextEncoder();
    let modelMessageId: number | null = null;
    let fullResponse = "";

    const stream = new ReadableStream({
      async start(controller) {
        // Enviar el ID del mensaje del usuario primero
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "user_message", id: userMessageId })}\n\n`)
        );

        // Generar título si es el primer mensaje (async, no bloquea el stream)
        if (isFirstMessage) {
          generateConversationTitle(content, labels)
            .then(async (title) => {
              // Actualizar título en la base de datos
              await pool.execute(
                "UPDATE conversations SET title = ? WHERE id = ?",
                [title, id]
              );
              // Enviar el nuevo título al frontend
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "title", title })}\n\n`)
              );
              console.log("[Stream] Generated title:", title);
            })
            .catch((err) => {
              console.error("[Stream] Error generating title:", err);
            });
        }

        try {
          await sendMessageStream(
            conversation.model_model_id,
            messages,
            finalSystemInstruction,
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
            {
              onChunk: (text) => {
                fullResponse += text;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`)
                );
              },
              onImage: async (image: GeneratedImage) => {
                // Guardar imagen en archivo y enviar URL
                try {
                  const savedUrl = await saveGeneratedImage(image, id);
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "image", imageUrl: savedUrl, mimeType: image.mimeType })}\n\n`)
                  );
                } catch (err) {
                  console.error("Error guardando imagen:", err);
                }
              },
              onComplete: async (text, tokenCount, images) => {
                // Determinar tipo de contenido y guardar imagen si existe
                let contentType: "text" | "image" | "mixed" = "text";
                let imageUrl: string | null = null;
                let imageMimeType: string | null = null;

                if (images && images.length > 0) {
                  // Guardar la primera imagen en archivo
                  const firstImage = images[0];
                  try {
                    imageUrl = await saveGeneratedImage(firstImage, id);
                    imageMimeType = firstImage.mimeType;
                    contentType = text ? "mixed" : "image";
                  } catch (err) {
                    console.error("Error guardando imagen final:", err);
                  }
                }

                // Guardar respuesta del modelo en la base de datos
                const [modelResult] = await pool.execute<ResultSetHeader>(
                  `INSERT INTO messages (conversation_id, role, content_type, content, image_url, image_mime_type, tokens_input, tokens_output)
                   VALUES (?, 'model', ?, ?, ?, ?, ?, ?)`,
                  [id, contentType, text || "", imageUrl, imageMimeType, tokenCount.input, tokenCount.output]
                );
                modelMessageId = modelResult.insertId;

                // Enviar evento de finalización
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "complete",
                      id: modelMessageId,
                      tokens: tokenCount,
                      imageUrl: imageUrl,
                    })}\n\n`
                  )
                );
                controller.close();
              },
              onError: async (error) => {
                console.error("Error en streaming:", error);

                // Guardar mensaje de error como respuesta del modelo
                const errorMessage = `Error al generar respuesta: ${error.message}`;
                const [modelResult] = await pool.execute<ResultSetHeader>(
                  `INSERT INTO messages (conversation_id, role, content_type, content)
                   VALUES (?, 'model', 'text', ?)`,
                  [id, errorMessage]
                );

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "error",
                      message: error.message,
                      id: modelResult.insertId,
                    })}\n\n`
                  )
                );
                controller.close();
              },
            },
            labels
          );
        } catch (error) {
          console.error("Error iniciando streaming:", error);
          const errorMessage = error instanceof Error ? error.message : "Error desconocido";

          // Guardar mensaje de error
          const [modelResult] = await pool.execute<ResultSetHeader>(
            `INSERT INTO messages (conversation_id, role, content_type, content)
             VALUES (?, 'model', 'text', ?)`,
            [id, `Error: ${errorMessage}`]
          );

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "error",
                message: errorMessage,
                id: modelResult.insertId,
              })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error en endpoint de streaming:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
