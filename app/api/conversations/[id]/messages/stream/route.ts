import { NextRequest } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { sendMessageStream, ChatMessage, isConfigured, Labels, GeneratedImage, generateConversationTitle, AttachedFile } from "@/lib/google-ai";
import { uploadToS3, generateFileName, isS3Configured } from "@/lib/s3";
import { calculateEstimatedCost } from "@/lib/cost-calculator";

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
  ignore_in_context: number;
}

type GenerationType = "text" | "image" | "video" | "audio";
type QualityTier = "normal" | "hq";

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number | null;
  model_id: number;
  generation_type: GenerationType;
  title: string | null;
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
  // Cost fields from model
  cost_input_per_million: number;
  cost_output_per_million: number;
  cost_image_1k: number;
  cost_image_2k: number;
  cost_image_4k: number;
  cost_video_per_second: number;
}

interface GenerationConfigRow extends RowDataPacket {
  model_normal_id: number | null;
  model_hq_id: number | null;
}

interface ProjectModelRow extends RowDataPacket {
  system_instruction: string | null;
}

interface ImageLimitRow extends RowDataPacket {
  max_monthly_image_generations: number;
  current_month_image_count: number;
  // New quality-based limits
  max_monthly_image_normal: number;
  max_monthly_image_hq: number;
  max_monthly_text_normal: number;
  max_monthly_text_hq: number;
}

interface ModelRow extends RowDataPacket {
  id: number;
  model_id: string;
  supports_image_generation: boolean;
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
    const { content, files, useProjectSystemInstruction = true, modelIdOverride, imageSettings, quality_tier = "normal", generation_type_override, no_context = false } = body as {
      content: string;
      files?: AttachedFile[];
      useProjectSystemInstruction?: boolean;
      modelIdOverride?: number;
      imageSettings?: { aspectRatio: string; size: string };
      quality_tier?: QualityTier;
      generation_type_override?: GenerationType;
      no_context?: boolean;
    };

    // Validate quality_tier
    const effectiveQualityTier: QualityTier = quality_tier === "hq" ? "hq" : "normal";

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

    // Obtener conversación con configuración, nombre del proyecto y costos del modelo
    const isAdmin = session.user.role === "admin";
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT c.*, c.generation_type, m.model_id as model_model_id, m.supports_image_generation, p.title as project_name,
              m.cost_input_per_million, m.cost_output_per_million,
              m.cost_image_1k, m.cost_image_2k, m.cost_image_4k, m.cost_video_per_second
       FROM conversations c
       JOIN models m ON c.model_id = m.id
       LEFT JOIN projects p ON c.project_id = p.id
       WHERE c.id = ? ${isAdmin ? "" : "AND c.user_id = ?"} AND c.deleted_at IS NULL`,
      isAdmin ? [id] : [id, session.user.id]
    );

    if (conversations.length === 0) {
      return new Response(JSON.stringify({ error: "Conversación no encontrada" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const conversation = conversations[0];

    // Handle model override if provided
    let effectiveModelId = conversation.model_model_id;
    let effectiveSupportsImageGeneration = conversation.supports_image_generation;
    let effectiveImageAspectRatio = conversation.image_aspect_ratio;
    let effectiveImageSize = conversation.image_size;
    let effectiveModelDbId = conversation.model_id; // Track the DB id for cost lookup

    // Get the correct model from project_generation_config based on quality_tier
    // Use generation_type_override if provided (e.g., when video conversation is in image mode)
    const generationType = generation_type_override || conversation.generation_type || "text";
    if (generation_type_override) {
      console.log(`[Stream] Using generation_type_override: ${generation_type_override} (conversation type: ${conversation.generation_type})`);
    }
    // Track effective costs (will be updated if we get model from config)
    let effectiveCosts = {
      cost_input_per_million: Number(conversation.cost_input_per_million) || 0,
      cost_output_per_million: Number(conversation.cost_output_per_million) || 0,
      cost_image_1k: Number(conversation.cost_image_1k) || 0,
      cost_image_2k: Number(conversation.cost_image_2k) || 0,
      cost_image_4k: Number(conversation.cost_image_4k) || 0,
      cost_video_per_second: Number(conversation.cost_video_per_second) || 0,
    };

    if (conversation.project_id && !modelIdOverride) {
      const [configRows] = await pool.execute<RowDataPacket[]>(`
        SELECT
          pgc.model_normal_id,
          pgc.model_hq_id,
          mn.model_id as model_normal_model_id,
          mn.supports_image_generation as model_normal_supports_image,
          mn.cost_input_per_million as mn_cost_input,
          mn.cost_output_per_million as mn_cost_output,
          mn.cost_image_1k as mn_cost_image_1k,
          mn.cost_image_2k as mn_cost_image_2k,
          mn.cost_image_4k as mn_cost_image_4k,
          mn.cost_video_per_second as mn_cost_video,
          mh.model_id as model_hq_model_id,
          mh.supports_image_generation as model_hq_supports_image,
          mh.cost_input_per_million as mh_cost_input,
          mh.cost_output_per_million as mh_cost_output,
          mh.cost_image_1k as mh_cost_image_1k,
          mh.cost_image_2k as mh_cost_image_2k,
          mh.cost_image_4k as mh_cost_image_4k,
          mh.cost_video_per_second as mh_cost_video
        FROM project_generation_config pgc
        LEFT JOIN models mn ON pgc.model_normal_id = mn.id
        LEFT JOIN models mh ON pgc.model_hq_id = mh.id
        WHERE pgc.project_id = ? AND pgc.generation_type = ? AND pgc.is_enabled = 1
      `, [conversation.project_id, generationType]);

      if (configRows.length > 0) {
        const config = configRows[0];
        if (effectiveQualityTier === "hq" && config.model_hq_model_id) {
          effectiveModelId = config.model_hq_model_id;
          effectiveSupportsImageGeneration = config.model_hq_supports_image;
          effectiveModelDbId = config.model_hq_id;
          effectiveCosts = {
            cost_input_per_million: Number(config.mh_cost_input) || 0,
            cost_output_per_million: Number(config.mh_cost_output) || 0,
            cost_image_1k: Number(config.mh_cost_image_1k) || 0,
            cost_image_2k: Number(config.mh_cost_image_2k) || 0,
            cost_image_4k: Number(config.mh_cost_image_4k) || 0,
            cost_video_per_second: Number(config.mh_cost_video) || 0,
          };
          console.log(`[Stream] Using HQ model from config: ${effectiveModelId}`);
        } else if (config.model_normal_model_id) {
          effectiveModelId = config.model_normal_model_id;
          effectiveSupportsImageGeneration = config.model_normal_supports_image;
          effectiveModelDbId = config.model_normal_id;
          effectiveCosts = {
            cost_input_per_million: Number(config.mn_cost_input) || 0,
            cost_output_per_million: Number(config.mn_cost_output) || 0,
            cost_image_1k: Number(config.mn_cost_image_1k) || 0,
            cost_image_2k: Number(config.mn_cost_image_2k) || 0,
            cost_image_4k: Number(config.mn_cost_image_4k) || 0,
            cost_video_per_second: Number(config.mn_cost_video) || 0,
          };
          console.log(`[Stream] Using Normal model from config: ${effectiveModelId}`);
        }
      }
    }

    if (modelIdOverride && conversation.project_id) {
      // Verify the override model belongs to the same project
      const [overrideRows] = await pool.execute<ModelRow[]>(
        `SELECT m.id, m.model_id, m.supports_image_generation
         FROM models m
         JOIN project_models pm ON m.id = pm.model_id
         WHERE pm.project_id = ? AND m.id = ?`,
        [conversation.project_id, modelIdOverride]
      );

      if (overrideRows.length > 0) {
        effectiveModelId = overrideRows[0].model_id;
        effectiveSupportsImageGeneration = overrideRows[0].supports_image_generation;
        console.log(`[Stream] Using model override: ${effectiveModelId}`);
      } else {
        console.warn(`[Stream] Model override ${modelIdOverride} not found in project ${conversation.project_id}, using default`);
      }
    }

    // Apply image settings override if provided
    if (imageSettings) {
      effectiveImageAspectRatio = imageSettings.aspectRatio;
      effectiveImageSize = imageSettings.size;
      console.log(`[Stream] Using image settings override: ${effectiveImageAspectRatio}, ${effectiveImageSize}`);
    }

    // Verificar límite de generaciones según tipo de conversación y calidad
    if (conversation.project_id && session.user.role !== "admin") {
      // Determinar qué límite verificar según el tipo de generación
      const limitColumn = effectiveQualityTier === "hq"
        ? `max_monthly_${generationType}_hq`
        : `max_monthly_${generationType}_normal`;

      // Determinar qué URL verificar para contar generaciones
      const urlColumn = generationType === "image" ? "image_url"
        : generationType === "video" ? "video_url"
        : generationType === "audio" ? "audio_url"
        : null; // texto no tiene URL específica

      const [limitRows] = await pool.execute<RowDataPacket[]>(`
        SELECT
          COALESCE(pu.${limitColumn}, 0) as max_limit,
          (
            SELECT COUNT(*)
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            WHERE c.project_id = ?
              AND c.user_id = ?
              AND c.generation_type = ?
              AND m.role = 'model'
              AND m.quality_tier = ?
              ${urlColumn ? `AND m.${urlColumn} IS NOT NULL` : "AND m.content IS NOT NULL AND m.image_url IS NULL AND m.video_url IS NULL AND m.audio_url IS NULL"}
              AND m.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
          ) as current_count
        FROM project_users pu
        WHERE pu.project_id = ? AND pu.user_id = ?
      `, [conversation.project_id, session.user.id, generationType, effectiveQualityTier, conversation.project_id, session.user.id]);

      if (limitRows.length > 0) {
        const maxLimit = limitRows[0].max_limit;
        const currentCount = limitRows[0].current_count;
        // 0 = sin límite, mayor a 0 = límite activo
        if (maxLimit > 0 && currentCount >= maxLimit) {
          return new Response(JSON.stringify({
            error: `Has alcanzado el límite de generaciones de ${generationType} ${effectiveQualityTier === 'hq' ? 'HQ' : 'normales'} mensuales para este proyecto`,
            type: `${generationType}_limit`,
            limit: maxLimit,
            used: currentCount,
            quality_tier: effectiveQualityTier
          }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
    }

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
      `INSERT INTO messages (conversation_id, role, content_type, quality_tier, content, image_url, image_mime_type)
       VALUES (?, 'user', ?, ?, ?, ?, ?)`,
      [id, contentType, effectiveQualityTier, content, savedImageUrl, firstImage?.mimeType || null]
    );

    const userMessageId = userMessageResult.insertId;

    // Obtener historial de mensajes para contexto (excluir errores)
    // Si no_context es true, solo obtenemos el mensaje actual (será el último en el historial)
    const [historyRows] = no_context
      ? await pool.execute<MessageRow[]>(
          `SELECT role, content, image_url, image_mime_type, ignore_in_context
           FROM messages
           WHERE id = ?`,
          [userMessageId]
        )
      : await pool.execute<MessageRow[]>(
          `SELECT role, content, image_url, image_mime_type, ignore_in_context
           FROM messages
           WHERE conversation_id = ? AND content_type != 'error'
           ORDER BY created_at ASC`,
          [id]
        );

    // Filter out ignored messages:
    // - User messages with ignore_in_context = 1
    // - Model messages that follow an ignored user message
    const filteredHistory: MessageRow[] = [];
    let lastUserIgnored = false;
    for (const msg of historyRows) {
      if (msg.role === "user") {
        lastUserIgnored = msg.ignore_in_context === 1;
        if (!lastUserIgnored) {
          filteredHistory.push(msg);
        }
      } else {
        // Model message: include only if previous user message was not ignored
        if (!lastUserIgnored) {
          filteredHistory.push(msg);
        }
      }
    }

    // Convertir historial al formato de ChatMessage
    const messages: ChatMessage[] = filteredHistory
      .map((msg, index) => {
        const isLastMessage = index === filteredHistory.length - 1;

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
      })
      // Filter out messages with empty content (can happen from error responses)
      .filter((msg) => msg.content && msg.content.trim() !== "");

    // Si hay model override (generando imagen desde conversación de video),
    // solo enviar el mensaje actual sin el historial de video
    const messagesToSend = modelIdOverride
      ? messages.slice(-1) // Solo el último mensaje (el actual)
      : messages;

    // Verificar si necesita generar titulo (aún tiene el titulo por defecto)
    const needsTitle = conversation.title === "Nueva conversación" || !conversation.title;

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
    let controllerClosed = false; // Hoisted para que cancel() pueda accederlo

    const stream = new ReadableStream({
      async start(controller) {
        // Enviar el ID del mensaje del usuario primero
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "user_message", id: userMessageId })}\n\n`)
        );

        // Construir configuración de generación
        const generationConfig = {
          temperature: Number(conversation.temperature),
          topP: Number(conversation.top_p),
          topK: conversation.top_k,
          maxOutputTokens: conversation.max_output_tokens,
          ...(effectiveSupportsImageGeneration && {
            imageConfig: {
              aspectRatio: effectiveImageAspectRatio as "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9",
              imageSize: effectiveImageSize as "1K" | "2K" | "4K",
            },
          }),
        };

        // Construir objeto de request para debug y almacenamiento
        const requestData = {
          model: effectiveModelId,
          systemInstruction: finalSystemInstruction,
          generationConfig,
          labels,
          messages: messagesToSend.map(m => ({
            role: m.role,
            content: m.content,
            files: m.files?.map(f => ({ name: f.name, type: f.type, mimeType: f.mimeType })),
            imageUrl: m.imageUrl || undefined,
          })),
        };

        // Debug: log completo de la solicitud al modelo
        console.log(`\n========== [GOOGLE AI REQUEST] (${process.env.GOOGLE_GENAI_USE_VERTEXAI === "true" ? "Vertex AI" : "Gemini API"}) ==========`);
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

        try {
          await sendMessageStream(
            effectiveModelId,
            messagesToSend,
            finalSystemInstruction,
            generationConfig,
            {
              onChunk: (text) => {
                fullResponse += text;
                if (!controllerClosed) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`)
                  );
                }
              },
              onRetry: (info) => {
                // Resetear estado acumulado para que el reintento empiece limpio
                fullResponse = "";
                imageUploadStarted = false;
                imageUploadPromise = null;
                savedImageUrl = null;
                savedImageFileSize = null;
                savedImageMimeType = null;

                if (!controllerClosed) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({
                      type: "retry",
                      attempt: info.attempt,
                      maxAttempts: info.maxAttempts,
                      delaySeconds: Math.round(info.delayMs / 1000),
                      error: info.error.substring(0, 200), // Truncar mensaje largo
                    })}\n\n`)
                  );
                }
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
                // Si hay imagen, guardar también los settings usados para generarla
                const imageAspectRatioToSave = imageUrl ? effectiveImageAspectRatio : null;
                const imageSizeToSave = imageUrl ? effectiveImageSize : null;

                // Calculate estimated cost using effective model costs
                const estimatedCost = calculateEstimatedCost(
                  effectiveCosts,
                  {
                    tokensInput: tokenCount.input,
                    tokensOutput: tokenCount.output,
                    imageGenerated: !!imageUrl,
                    imageSize: imageSizeToSave,
                    videoSeconds: null,
                  }
                );

                const [modelResult] = await pool.execute<ResultSetHeader>(
                  `INSERT INTO messages (conversation_id, role, content_type, quality_tier, content, image_url, image_mime_type, image_file_size, image_aspect_ratio, image_size, tokens_input, tokens_output, estimated_cost)
                   VALUES (?, 'model', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [id, contentType, effectiveQualityTier, text || "", imageUrl, imageMimeType, imageFileSize, imageAspectRatioToSave, imageSizeToSave, tokenCount.input, tokenCount.output, estimatedCost]
                );
                modelMessageId = modelResult.insertId;

                // Acumular tokens y costo en la conversación
                await pool.execute(
                  `UPDATE conversations
                   SET total_tokens_input = total_tokens_input + ?,
                       total_tokens_output = total_tokens_output + ?,
                       total_estimated_cost = total_estimated_cost + ?
                   WHERE id = ?`,
                  [tokenCount.input, tokenCount.output, estimatedCost, id]
                );

                // Obtener totales actualizados
                const [totalsResult] = await pool.execute<RowDataPacket[]>(
                  `SELECT total_tokens_input, total_tokens_output, total_estimated_cost FROM conversations WHERE id = ?`,
                  [id]
                );

                const totalTokens = {
                  input: totalsResult[0]?.total_tokens_input || 0,
                  output: totalsResult[0]?.total_tokens_output || 0,
                };

                const totalCost = Number(totalsResult[0]?.total_estimated_cost) || 0;

                // Enviar evento de finalización con tokens, costo del mensaje y totales de conversación
                if (!controllerClosed) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: "complete",
                        id: modelMessageId,
                        tokens: tokenCount,
                        totalTokens,
                        estimatedCost,
                        totalCost,
                        imageUrl: imageUrl,
                      })}\n\n`
                    )
                  );
                  controllerClosed = true;
                  controller.close();
                }

                // Generar título después de completar exitosamente (fire-and-forget)
                // Se genera aquí para no competir por cuota API con la llamada principal
                if (needsTitle) {
                  generateConversationTitle(content, labels)
                    .then(async (title) => {
                      await pool.execute(
                        "UPDATE conversations SET title = ? WHERE id = ?",
                        [title, id]
                      );
                      console.log("[Stream] Generated title:", title);
                    })
                    .catch((err) => {
                      console.error("[Stream] Error generating title:", err);
                    });
                }
              },
              onError: async (error) => {
                // Si el cliente se desconectó, no guardar error ni intentar enviar
                if (controllerClosed) return;

                console.error("Error en streaming:", error);

                // Guardar mensaje de error (con content_type 'error' para excluirlo del historial)
                // También marcar el mensaje del usuario con ignore_in_context para no enviarlo como contexto
                const errorMessage = `Error al generar respuesta: ${error.message}`;
                const [modelResult] = await pool.execute<ResultSetHeader>(
                  `INSERT INTO messages (conversation_id, role, content_type, content)
                   VALUES (?, 'model', 'error', ?)`,
                  [id, errorMessage]
                );
                await pool.execute(
                  `UPDATE messages SET ignore_in_context = 1 WHERE id = ?`,
                  [userMessageId]
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
            labels,
            request.signal
          );
        } catch (error) {
          // Si el cliente se desconectó, no guardar error ni intentar enviar
          if (controllerClosed) return;

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
      cancel() {
        // Cliente se desconectó (navegó, abortó fetch, reintentó)
        controllerClosed = true;
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
