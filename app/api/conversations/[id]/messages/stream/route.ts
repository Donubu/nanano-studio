import { NextRequest } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { sendMessageStream, ChatMessage, isConfigured, Labels, GeneratedImage, generateConversationTitle, AttachedFile } from "@/lib/google-ai";
import { uploadToS3, generateFileName, isS3Configured } from "@/lib/s3";

// Guardar imagen generada en S3 y retornar la URL de CloudFront y tamaño
async function saveGeneratedImage(image: GeneratedImage, conversationId: string): Promise<{ url: string; fileSize: number }> {
  const extension = image.mimeType.split("/")[1] || "png";
  const fileName = generateFileName(conversationId, extension);
  const buffer = Buffer.from(image.data, "base64");

  const result = await uploadToS3(buffer, fileName, image.mimeType, "generated");

  return {
    url: result.url,
    fileSize: result.fileSize
  };
}

// Guardar archivo adjunto del usuario en S3 y retornar la URL de CloudFront
async function saveUploadedFile(file: AttachedFile, conversationId: string): Promise<string> {
  const extension = file.mimeType.split("/")[1] || "bin";
  const fileName = generateFileName(conversationId, extension);

  // Extraer base64 del dataUrl
  const base64Data = file.dataUrl.split(",")[1];
  const buffer = Buffer.from(base64Data, "base64");

  const result = await uploadToS3(buffer, fileName, file.mimeType, "chat");

  return result.url;
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
    const { content, files, useProjectSystemInstruction = true } = body as {
      content: string;
      files?: AttachedFile[];
      useProjectSystemInstruction?: boolean;
    };

    if (!content || content.trim() === "") {
      return new Response(JSON.stringify({ error: "El contenido del mensaje es requerido" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Log de archivos recibidos
    if (files && files.length > 0) {
      console.log("[Stream] Files received:", files.map(f => ({ name: f.name, type: f.type, mimeType: f.mimeType })));
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


    // Determinar tipo de contenido
    const hasFiles = files && files.length > 0;
    const firstImage = files?.find(f => f.type === "image");
    const contentType = hasFiles ? "mixed" : "text";

    // Guardar primera imagen en disco si existe (para preview en historial)
    let savedImageUrl: string | null = null;
    if (firstImage) {
      try {
        savedImageUrl = await saveUploadedFile(firstImage, id);
      } catch (err) {
        console.error("Error guardando imagen del usuario:", err);
      }
    }

    // Guardar mensaje del usuario (con URL de imagen guardada, no base64)
    const [userMessageResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO messages (conversation_id, role, content_type, content, image_url, image_mime_type)
       VALUES (?, 'user', ?, ?, ?, ?)`,
      [id, contentType, content, savedImageUrl, firstImage?.mimeType || null]
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
    const messages: ChatMessage[] = historyRows.map((msg, index) => {
      const isLastMessage = index === historyRows.length - 1;

      // Para el último mensaje (el actual del usuario), incluir todos los archivos
      if (isLastMessage && hasFiles && files) {
        return {
          role: msg.role,
          content: msg.content,
          files: files, // Incluir todos los archivos en el mensaje actual
        };
      }

      // Para mensajes históricos, usar el formato legacy (solo una imagen)
      return {
        role: msg.role,
        content: msg.content,
        imageUrl: msg.image_url,
        imageMimeType: msg.image_mime_type,
      };
    });

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

        // Construir configuración de generación
        const generationConfig = {
          temperature: Number(conversation.temperature),
          topP: Number(conversation.top_p),
          topK: conversation.top_k,
          maxOutputTokens: conversation.max_output_tokens,
          ...(conversation.supports_image_generation && {
            imageConfig: {
              aspectRatio: conversation.image_aspect_ratio as "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9",
              imageSize: conversation.image_size as "1K" | "2K" | "4K",
            },
          }),
        };

        // Construir objeto de request para debug y almacenamiento
        const requestData = {
          model: conversation.model_model_id,
          systemInstruction: finalSystemInstruction,
          generationConfig,
          labels,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
            files: m.files?.map(f => ({ name: f.name, type: f.type, mimeType: f.mimeType })),
            imageUrl: m.imageUrl || undefined,
          })),
        };

        // Debug: log completo de la solicitud al modelo
        console.log("\n========== [GOOGLE AI REQUEST] ==========");
        console.log(JSON.stringify(requestData, null, 2));
        console.log("==========================================\n");

        // Guardar request_data en el mensaje del usuario
        await pool.execute(
          "UPDATE messages SET request_data = ? WHERE id = ?",
          [JSON.stringify(requestData), userMessageId]
        );

        // Variables para trackear imagen guardada durante streaming
        let savedImageUrl: string | null = null;
        let savedImageFileSize: number | null = null;
        let savedImageMimeType: string | null = null;
        let imageUploadStarted = false; // Flag síncrono para evitar race condition
        let imageUploadPromise: Promise<void> | null = null; // Promise para esperar upload
        let controllerClosed = false; // Flag para saber si el controller ya cerró

        try {
          await sendMessageStream(
            conversation.model_model_id,
            messages,
            finalSystemInstruction,
            generationConfig,
            {
              onChunk: (text) => {
                fullResponse += text;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`)
                );
              },
              onImage: async (image: GeneratedImage) => {
                // Guardar imagen en S3 solo una vez (flag síncrono para evitar race condition)
                if (imageUploadStarted) return;
                imageUploadStarted = true;

                // Guardar la promesa para que onComplete pueda esperarla
                imageUploadPromise = (async () => {
                  try {
                    const savedImage = await saveGeneratedImage(image, id);
                    savedImageUrl = savedImage.url;
                    savedImageFileSize = savedImage.fileSize;
                    savedImageMimeType = image.mimeType;
                    // Solo enviar si el controller no está cerrado
                    if (!controllerClosed) {
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ type: "image", imageUrl: savedImage.url, mimeType: image.mimeType })}\n\n`)
                      );
                    }
                  } catch (err) {
                    console.error("Error guardando imagen:", err);
                  }
                })();
              },
              onComplete: async (text, tokenCount, images) => {
                // Esperar a que termine el upload de imagen si está en progreso
                if (imageUploadPromise) {
                  await imageUploadPromise;
                }

                // Determinar tipo de contenido
                let contentType: "text" | "image" | "mixed" = "text";
                let imageUrl: string | null = savedImageUrl;
                let imageMimeType: string | null = savedImageMimeType;
                let imageFileSize: number | null = savedImageFileSize;

                // Si hay imagen guardada durante streaming, usar esa
                if (imageUploadStarted && savedImageUrl) {
                  contentType = text ? "mixed" : "image";
                }
                // Si no se inició upload durante streaming pero llegó imagen en onComplete, guardarla ahora
                else if (!imageUploadStarted && images && images.length > 0) {
                  imageUploadStarted = true;
                  const firstImage = images[0];
                  try {
                    const savedImage = await saveGeneratedImage(firstImage, id);
                    imageUrl = savedImage.url;
                    imageFileSize = savedImage.fileSize;
                    imageMimeType = firstImage.mimeType;
                    contentType = text ? "mixed" : "image";
                  } catch (err) {
                    console.error("Error guardando imagen final:", err);
                  }
                }

                // Guardar respuesta del modelo en la base de datos
                const [modelResult] = await pool.execute<ResultSetHeader>(
                  `INSERT INTO messages (conversation_id, role, content_type, content, image_url, image_mime_type, image_file_size, tokens_input, tokens_output)
                   VALUES (?, 'model', ?, ?, ?, ?, ?, ?, ?)`,
                  [id, contentType, text || "", imageUrl, imageMimeType, imageFileSize, tokenCount.input, tokenCount.output]
                );
                modelMessageId = modelResult.insertId;

                // Acumular tokens en la conversación
                await pool.execute(
                  `UPDATE conversations
                   SET total_tokens_input = total_tokens_input + ?,
                       total_tokens_output = total_tokens_output + ?
                   WHERE id = ?`,
                  [tokenCount.input, tokenCount.output, id]
                );

                // Obtener totales actualizados
                const [totalsResult] = await pool.execute<RowDataPacket[]>(
                  `SELECT total_tokens_input, total_tokens_output FROM conversations WHERE id = ?`,
                  [id]
                );

                const totalTokens = {
                  input: totalsResult[0]?.total_tokens_input || 0,
                  output: totalsResult[0]?.total_tokens_output || 0,
                };

                // Enviar evento de finalización con tokens del mensaje y totales de conversación
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "complete",
                      id: modelMessageId,
                      tokens: tokenCount,
                      totalTokens,
                      imageUrl: imageUrl,
                    })}\n\n`
                  )
                );
                controllerClosed = true;
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

                if (!controllerClosed) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: "error",
                        message: error.message,
                        id: modelResult.insertId,
                      })}\n\n`
                    )
                  );
                  controllerClosed = true;
                  controller.close();
                }
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

          if (!controllerClosed) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "error",
                  message: errorMessage,
                  id: modelResult.insertId,
                })}\n\n`
              )
            );
            controllerClosed = true;
            controller.close();
          }
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
