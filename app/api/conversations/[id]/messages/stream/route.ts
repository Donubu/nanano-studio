import { NextRequest } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { sendMessageStream, sendMessage, ChatMessage, isConfigured, Labels, GeneratedImage, GroundingData, generateConversationTitle, AttachedFile } from "@/lib/google-ai";
import { uploadToS3, generateFileName, isS3Configured } from "@/lib/s3";
import { calculateEstimatedCost } from "@/lib/cost-calculator";
import { isRedisConfigured, createRedisConnection } from "@/lib/redis";
import { getStreamQueue, jobChannel, StreamJobEvent, hasActiveWorkers } from "@/lib/queue";

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

interface ProjectModelRow extends RowDataPacket {
  model_id: number;
  model_model_id: string;
  model_supports_image: number;
  model_supports_google_search: number;
  model_api_backend: string | null;
  cost_input_per_million: number;
  cost_output_per_million: number;
  cost_image_1k: number;
  cost_image_2k: number;
  cost_image_4k: number;
  cost_video_per_second: number;
  is_default: number;
}

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
  client_name: string | null;
  // Cost fields from model
  cost_input_per_million: number;
  cost_output_per_million: number;
  cost_image_1k: number;
  cost_image_2k: number;
  cost_image_4k: number;
  cost_video_per_second: number;
  model_api_backend: string | null;
  model_system_instruction: string | null;
  model_supports_google_search: number;
}

interface ProjectModelRow extends RowDataPacket {
  system_instruction: string | null;
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
    if (!id || isNaN(Number(id))) {
      return new Response(JSON.stringify({ error: "ID de conversación inválido" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = await request.json();
    const { content, files, useProjectSystemInstruction = true, modelIdOverride, imageSettings, quality_tier, selected_model_id, generation_type_override, no_context = false, skip_user_message = false, google_search_enabled: reqGoogleSearchEnabled, google_image_search_enabled: reqGoogleImageSearchEnabled, thinking_level, include_thoughts } = body as {
      content: string;
      files?: AttachedFile[];
      useProjectSystemInstruction?: boolean;
      modelIdOverride?: number;
      imageSettings?: { aspectRatio: string; size: string; numberOfImages?: number };
      quality_tier?: QualityTier;
      selected_model_id?: number;
      generation_type_override?: GenerationType;
      no_context?: boolean;
      skip_user_message?: boolean;
      google_search_enabled?: boolean;
      google_image_search_enabled?: boolean;
      thinking_level?: "none" | "low" | "medium" | "high";
      include_thoughts?: boolean;
    };

    // quality_tier kept for legacy compat but selected_model_id takes precedence
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
      `SELECT c.*, c.generation_type, m.model_id as model_model_id, m.supports_image_generation, m.supports_google_search as model_supports_google_search, m.api_backend as model_api_backend, m.system_instruction as model_system_instruction, p.title as project_name, cl.name as client_name,
              m.cost_input_per_million, m.cost_output_per_million,
              m.cost_image_1k, m.cost_image_2k, m.cost_image_4k, m.cost_video_per_second
       FROM conversations c
       JOIN models m ON c.model_id = m.id
       LEFT JOIN projects p ON c.project_id = p.id
       LEFT JOIN clients cl ON p.client_id = cl.id
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

    // Crear el stream de respuesta inmediatamente para enviar headers rápido
    const encoder = new TextEncoder();
    let modelMessageId: number | null = null;
    let fullResponse = "";
    let controllerClosed = false;
    let heartbeat: ReturnType<typeof setInterval>;

    const stream = new ReadableStream({
      async start(controller) {
        // Heartbeat cada 10s para mantener la conexión viva durante generaciones largas
        heartbeat = setInterval(() => {
          if (!controllerClosed) {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } else {
            clearInterval(heartbeat);
          }
        }, 10000);

        try {
          // Handle model override if provided
          let effectiveModelId = conversation.model_model_id;
          let effectiveSupportsImageGeneration = conversation.supports_image_generation;
          let effectiveSupportsGoogleSearch = Boolean(conversation.model_supports_google_search);
          let effectiveImageAspectRatio = conversation.image_aspect_ratio;
          let effectiveImageSize = conversation.image_size;
          let effectiveModelDbId = conversation.model_id; // Track the DB id for cost lookup
          let effectiveBackend = conversation.model_api_backend || undefined;

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
            // Query models assigned to this project+type from new table
            const [projectModels] = await pool.execute<ProjectModelRow[]>(`
              SELECT
                pgm.model_id,
                pgm.is_default,
                m.model_id as model_model_id,
                m.supports_image_generation as model_supports_image,
                m.supports_google_search as model_supports_google_search,
                m.api_backend as model_api_backend,
                m.cost_input_per_million,
                m.cost_output_per_million,
                m.cost_image_1k,
                m.cost_image_2k,
                m.cost_image_4k,
                m.cost_video_per_second
              FROM project_generation_models pgm
              JOIN models m ON pgm.model_id = m.id
              JOIN project_generation_config pgc ON pgc.project_id = pgm.project_id AND pgc.generation_type = pgm.generation_type
              WHERE pgm.project_id = ? AND pgm.generation_type = ? AND pgc.is_enabled = 1
              ORDER BY pgm.sort_order ASC
            `, [conversation.project_id, generationType]);

            if (projectModels.length > 0) {
              // Pick model: selected_model_id > default > first
              let chosen = projectModels.find(m => selected_model_id && m.model_id === selected_model_id)
                || projectModels.find(m => m.is_default)
                || projectModels[0];

              effectiveModelId = chosen.model_model_id;
              effectiveSupportsImageGeneration = Boolean(chosen.model_supports_image);
              effectiveSupportsGoogleSearch = Boolean(chosen.model_supports_google_search);
              effectiveModelDbId = chosen.model_id;
              effectiveBackend = chosen.model_api_backend || undefined;
              effectiveCosts = {
                cost_input_per_million: Number(chosen.cost_input_per_million) || 0,
                cost_output_per_million: Number(chosen.cost_output_per_million) || 0,
                cost_image_1k: Number(chosen.cost_image_1k) || 0,
                cost_image_2k: Number(chosen.cost_image_2k) || 0,
                cost_image_4k: Number(chosen.cost_image_4k) || 0,
                cost_video_per_second: Number(chosen.cost_video_per_second) || 0,
              };
              console.log(`[Stream] Using model from config: ${effectiveModelId} (${effectiveBackend || 'default'})`);
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

          // Concatenar system instructions: modelo + proyecto + conversación
          const systemParts: string[] = [];
          if (conversation.model_system_instruction) systemParts.push(conversation.model_system_instruction);
          if (projectSystemInstruction) systemParts.push(projectSystemInstruction);
          if (conversation.system_instruction) systemParts.push(conversation.system_instruction);
          const finalSystemInstruction: string | null = systemParts.length > 0 ? systemParts.join("\n\n") : null;


          // Determinar tipo de contenido
          const hasFiles = files && files.length > 0;
          const firstImage = files?.find(f => f.type === "image");
          const contentType = hasFiles ? "mixed" : "text";

          // When skip_user_message is true, we skip creating the user message (used for parallel multi-image generation)
          let savedImageUrl: string | null = null;
          let userMessageId: number = 0;

          if (!skip_user_message) {
            // Guardar primera imagen en disco si existe (para preview en historial)
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

            userMessageId = userMessageResult.insertId;

            // Guardar todas las imágenes adjuntas en message_images
            if (hasFiles && files) {
              const imageFiles = files.filter(f => f.type === "image");
              for (let i = 0; i < imageFiles.length; i++) {
                const imgFile = imageFiles[i];
                try {
                  // La primera imagen ya fue guardada como savedImageUrl
                  const imgUrl = i === 0 && savedImageUrl ? savedImageUrl : await saveUploadedFile(imgFile, id);
                  const base64Data = imgFile.dataUrl.split(",")[1];
                  const fileSize = Buffer.from(base64Data, "base64").length;
                  await pool.execute(
                    `INSERT INTO message_images (message_id, image_url, mime_type, file_size, sort_order) VALUES (?, ?, ?, ?, ?)`,
                    [userMessageId, imgUrl, imgFile.mimeType, fileSize, i]
                  );
                } catch (err) {
                  console.error(`Error guardando imagen ${i} en message_images:`, err);
                }
              }
            }
          }

          // Obtener historial de mensajes para contexto (excluir errores)
          // Si no_context es true, o es generación de imagen/video, solo obtenemos el mensaje actual
          // Si skip_user_message, no hay mensaje en BD — usamos el content del request directamente
          const skipHistoryQuery = no_context || generationType === "image" || generationType === "video";
          const [historyRows] = skip_user_message
            ? [[] as MessageRow[]]
            : skipHistoryQuery
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

          // Para imagen/video, solo enviar el mensaje actual (sin historial).
          // Los modelos de generación visual no usan contexto conversacional.
          // También aplica cuando hay model override (ej: generando imagen desde conversación de video).
          const skipHistory = modelIdOverride || generationType === "image" || generationType === "video";

          // When skip_user_message, inject user message from request body (not from DB)
          if (skip_user_message && messages.length === 0) {
            messages.push({ role: "user", content });
          }

          const messagesToSend = skipHistory
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
            project_name: conversation.client_name ? `${conversation.client_name} > ${conversation.project_name}` : conversation.project_name || "sin_proyecto",
            user_name: userIdentifier,
          };

          // Enviar el ID del mensaje del usuario primero (skip for parallel image requests)
          if (!skip_user_message) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "user_message", id: userMessageId })}\n\n`)
            );
          }

          // Construir configuración de generación
          const googleSearchEnabled = Boolean(reqGoogleSearchEnabled) && effectiveSupportsGoogleSearch;
          const googleImageSearchEnabled = Boolean(reqGoogleImageSearchEnabled) && effectiveSupportsGoogleSearch;
          console.log(`[Stream] Google Search: web=${googleSearchEnabled}, image=${googleImageSearchEnabled}, modelSupports=${effectiveSupportsGoogleSearch}`);
          const generationConfig = {
            temperature: Number(conversation.temperature),
            topP: Number(conversation.top_p),
            topK: conversation.top_k,
            maxOutputTokens: conversation.max_output_tokens,
            ...(effectiveSupportsImageGeneration && generationType === "image" && {
              imageConfig: {
                aspectRatio: effectiveImageAspectRatio as "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9",
                imageSize: effectiveImageSize as "1K" | "2K" | "4K",
              },
            }),
            ...(googleSearchEnabled && { googleSearchEnabled: true }),
            ...(googleImageSearchEnabled && { googleImageSearchEnabled: true }),
            ...(thinking_level && { thinkingLevel: thinking_level }),
            ...(include_thoughts && thinking_level && thinking_level !== "none" && { includeThoughts: true }),
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
          const backendLabel = effectiveBackend === 'vertex' ? 'Vertex AI' : effectiveBackend === 'gemini' ? 'Gemini API' : (process.env.GOOGLE_GENAI_USE_VERTEXAI === "true" ? "Vertex AI" : "Gemini API");
          console.log(`\n========== [GOOGLE AI REQUEST] (${backendLabel}) ==========`);
          console.log(JSON.stringify(requestData, null, 2));
          console.log("==========================================\n");

          // Guardar request_data en el mensaje del usuario
          if (!skip_user_message) {
            await pool.execute(
              "UPDATE messages SET request_data = ? WHERE id = ?",
              [JSON.stringify(requestData), userMessageId]
            );
          }

          // ============================================
          // WORKER DELEGATION (when Redis is available)
          // ============================================
          if (isRedisConfigured() && await hasActiveWorkers()) {
            try {
              const queue = getStreamQueue();
              const job = await queue.add("stream", {
                conversationId: id,
                userMessageId,
                skipUserMessage: skip_user_message,
                content,
                modelId: effectiveModelId,
                backend: effectiveBackend,
                generationType,
                qualityTier: effectiveQualityTier,
                systemInstruction: finalSystemInstruction || undefined,
                settings: generationConfig,
                messages: messagesToSend.map((m) => ({
                  role: m.role,
                  content: m.content,
                  imageUrl: m.imageUrl || undefined,
                  imageMimeType: m.imageMimeType || undefined,
                  files: m.files?.map((f) => ({
                    dataUrl: f.dataUrl,
                    mimeType: f.mimeType,
                    name: f.name,
                    type: f.type as string,
                  })),
                })),
                labels: {
                  project_name: labels.project_name || "sin_proyecto",
                  user_name: labels.user_name || "unknown",
                },
                needsTitle,
                effectiveCosts,
                effectiveImageAspectRatio,
                effectiveImageSize,
              });

              console.log(`[Stream] Job ${job.id} enqueued to worker`);

              // Subscribe to worker events via Redis pub/sub
              const subRedis = createRedisConnection();
              const channel = jobChannel(job.id!);

              // Safety timeout: if worker doesn't respond in 10 minutes, close
              const workerTimeout = setTimeout(() => {
                if (!controllerClosed) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: "Worker timeout" })}\n\n`));
                  clearInterval(heartbeat);
                  controllerClosed = true;
                  controller.close();
                  subRedis.unsubscribe();
                  subRedis.disconnect();
                }
              }, 600000);

              await subRedis.subscribe(channel);
              subRedis.on("message", (ch: string, message: string) => {
                if (ch !== channel || controllerClosed) return;
                try {
                  const event: StreamJobEvent = JSON.parse(message);

                  if (event.type === "complete" || event.type === "error") {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                    clearInterval(heartbeat);
                    clearTimeout(workerTimeout);
                    controllerClosed = true;
                    controller.close();
                    subRedis.unsubscribe();
                    subRedis.disconnect();
                  } else {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                  }
                } catch (err) {
                  console.error("[Stream] Error parsing worker event:", err);
                }
              });

              return; // Skip direct processing — worker handles it
            } catch (err) {
              console.error("[Stream] Error enqueuing to worker, falling back to direct:", err);
              // Fall through to direct processing
            }
          }

          // ============================================
          // DIRECT PROCESSING (fallback when no Redis)
          // ============================================

          // Variables para trackear múltiples imágenes generadas durante streaming
          interface SavedImage {
            url: string;
            fileSize: number;
            mimeType: string;
          }
          let savedImages: SavedImage[] = [];
          let imageUploadPromises: Promise<void>[] = [];
          let groundingData: GroundingData | null = null;

          // Image Search requires non-streaming generateContent (not supported in streaming API)
          if (googleImageSearchEnabled) {
            try {
              const result = await sendMessage(
                effectiveModelId,
                messagesToSend,
                finalSystemInstruction,
                generationConfig,
                labels,
                effectiveBackend
              );

              fullResponse = result.text;
              const tokenCount = result.tokenCount;
              groundingData = result.groundingData || null;

              // Emit text as a single chunk
              if (result.text && !controllerClosed) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "chunk", text: result.text })}\n\n`)
                );
              }

              // Emit grounding data
              if (groundingData && !controllerClosed) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({
                    type: "grounding",
                    sources: groundingData.sources,
                    searchEntryPointHtml: groundingData.searchEntryPointHtml,
                    webSearchQueries: groundingData.webSearchQueries,
                    imageSearchQueries: groundingData.imageSearchQueries,
                  })}\n\n`)
                );
              }

              // Save and emit images
              for (const img of result.images) {
                try {
                  const saved = await saveGeneratedImage(img, id);
                  savedImages.push({ url: saved.url, fileSize: saved.fileSize, mimeType: img.mimeType });
                  if (!controllerClosed) {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ type: "image", imageUrl: saved.url, mimeType: img.mimeType, imageIndex: savedImages.length - 1 })}\n\n`)
                    );
                  }
                } catch (err) {
                  console.error("Error guardando imagen (non-stream):", err);
                }
              }

              // --- Save to DB (same logic as streaming onComplete) ---
              const validImages = savedImages.filter(img => img.url);
              const hasImages = validImages.length > 0;
              const hasText = !!fullResponse;
              const imageAspectRatioToSave = hasImages ? effectiveImageAspectRatio : null;
              const imageSizeToSave = hasImages ? effectiveImageSize : null;
              let totalEstimatedCost = 0;
              const imageMessages: Array<{ id: number; imageUrl: string }> = [];

              if (hasText) {
                const textCost = calculateEstimatedCost(effectiveCosts, {
                  tokensInput: tokenCount.input, tokensOutput: tokenCount.output,
                  imageGenerated: false, imageSize: null, videoSeconds: null,
                });
                totalEstimatedCost += textCost;
                const [modelResult] = await pool.execute<ResultSetHeader>(
                  `INSERT INTO messages (conversation_id, role, content_type, quality_tier, model_id, content, tokens_input, tokens_output, estimated_cost, grounding_data)
                   VALUES (?, 'model', 'text', ?, ?, ?, ?, ?, ?, ?)`,
                  [id, effectiveQualityTier, effectiveModelDbId, fullResponse, tokenCount.input, tokenCount.output, textCost, groundingData ? JSON.stringify(groundingData) : null]
                );
                modelMessageId = modelResult.insertId;
              }

              for (let i = 0; i < validImages.length; i++) {
                const img = validImages[i];
                const isFirstMessage = !hasText && i === 0;
                const imageCost = calculateEstimatedCost(effectiveCosts, {
                  tokensInput: isFirstMessage ? tokenCount.input : 0,
                  tokensOutput: isFirstMessage ? tokenCount.output : 0,
                  imageGenerated: true, imageSize: imageSizeToSave, videoSeconds: null,
                });
                totalEstimatedCost += imageCost;
                const [imgResult] = await pool.execute<ResultSetHeader>(
                  `INSERT INTO messages (conversation_id, role, content_type, quality_tier, model_id, content, image_url, image_mime_type, image_file_size, image_aspect_ratio, image_size, tokens_input, tokens_output, estimated_cost)
                   VALUES (?, 'model', 'image', ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [id, effectiveQualityTier, effectiveModelDbId, img.url, img.mimeType, img.fileSize, imageAspectRatioToSave, imageSizeToSave,
                   isFirstMessage ? tokenCount.input : 0, isFirstMessage ? tokenCount.output : 0, imageCost]
                );
                imageMessages.push({ id: imgResult.insertId, imageUrl: img.url });
                if (isFirstMessage) modelMessageId = imgResult.insertId;
              }

              if (!hasText && validImages.length === 0) {
                const textCost = calculateEstimatedCost(effectiveCosts, {
                  tokensInput: tokenCount.input, tokensOutput: tokenCount.output,
                  imageGenerated: false, imageSize: null, videoSeconds: null,
                });
                totalEstimatedCost += textCost;
                const [modelResult] = await pool.execute<ResultSetHeader>(
                  `INSERT INTO messages (conversation_id, role, content_type, quality_tier, model_id, content, tokens_input, tokens_output, estimated_cost)
                   VALUES (?, 'model', 'text', ?, ?, '', ?, ?, ?)`,
                  [id, effectiveQualityTier, effectiveModelDbId, tokenCount.input, tokenCount.output, textCost]
                );
                modelMessageId = modelResult.insertId;
              }

              await pool.execute(
                `UPDATE conversations SET total_tokens_input = total_tokens_input + ?, total_tokens_output = total_tokens_output + ?, total_estimated_cost = total_estimated_cost + ? WHERE id = ?`,
                [tokenCount.input, tokenCount.output, totalEstimatedCost, id]
              );

              const [totalsResult] = await pool.execute<RowDataPacket[]>(
                `SELECT total_tokens_input, total_tokens_output, total_estimated_cost FROM conversations WHERE id = ?`,
                [id]
              );

              if (!controllerClosed) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({
                    type: "complete",
                    id: modelMessageId,
                    tokens: tokenCount,
                    totalTokens: { input: totalsResult[0]?.total_tokens_input || 0, output: totalsResult[0]?.total_tokens_output || 0 },
                    estimatedCost: totalEstimatedCost,
                    totalCost: Number(totalsResult[0]?.total_estimated_cost) || 0,
                    imageUrl: validImages.length === 1 ? validImages[0].url : null,
                    imageMessages: imageMessages.length > 0 ? imageMessages : undefined,
                  })}\n\n`)
                );
                clearInterval(heartbeat);
                controllerClosed = true;
                controller.close();
              }

              if (needsTitle && !skip_user_message) {
                generateConversationTitle(content, labels)
                  .then(async (title) => {
                    await pool.execute("UPDATE conversations SET title = ? WHERE id = ?", [title, id]);
                  })
                  .catch((err) => console.error("[Stream] Error generating title:", err));
              }
            } catch (error) {
              if (controllerClosed) return;
              console.error("Error en non-streaming (image search):", error);
              const errorMessage = error instanceof Error ? error.message : "Error desconocido";
              try {
                const [modelResult] = await pool.execute<ResultSetHeader>(
                  `INSERT INTO messages (conversation_id, role, content_type, content) VALUES (?, 'model', 'error', ?)`,
                  [id, `Error: ${errorMessage}`]
                );
                if (!skip_user_message && userMessageId) {
                  await pool.execute(`UPDATE messages SET ignore_in_context = 1 WHERE id = ?`, [userMessageId]);
                }
                if (!controllerClosed) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: errorMessage, id: modelResult.insertId })}\n\n`));
                  clearInterval(heartbeat);
                  controllerClosed = true;
                  controller.close();
                }
              } catch (dbErr) {
                console.error("Error guardando error:", dbErr);
                if (!controllerClosed) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message: errorMessage })}\n\n`));
                  clearInterval(heartbeat);
                  controllerClosed = true;
                  controller.close();
                }
              }
            }
            return; // Skip streaming path
          }

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
              ...(include_thoughts && thinking_level && thinking_level !== "none" && {
                onThought: (text: string) => {
                  if (!controllerClosed) {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ type: "thought", text })}\n\n`)
                    );
                  }
                },
              }),
              onRetry: (info) => {
                // Resetear estado acumulado para que el reintento empiece limpio
                fullResponse = "";
                savedImages = [];
                imageUploadPromises = [];
                groundingData = null;

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
              onGrounding: (data: GroundingData) => {
                groundingData = data;
                if (!controllerClosed) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({
                      type: "grounding",
                      sources: data.sources,
                      searchEntryPointHtml: data.searchEntryPointHtml,
                      webSearchQueries: data.webSearchQueries,
                      imageSearchQueries: data.imageSearchQueries,
                    })}\n\n`)
                  );
                }
              },
              onImage: async (image: GeneratedImage) => {
                const imageIndex = imageUploadPromises.length;

                // Guardar la promesa para que onComplete pueda esperarlas todas
                const uploadPromise = (async () => {
                  try {
                    const savedImage = await saveGeneratedImage(image, id);
                    savedImages[imageIndex] = {
                      url: savedImage.url,
                      fileSize: savedImage.fileSize,
                      mimeType: image.mimeType,
                    };
                    // Enviar evento SSE por cada imagen
                    if (!controllerClosed) {
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ type: "image", imageUrl: savedImage.url, mimeType: image.mimeType, imageIndex })}\n\n`)
                      );
                    }
                  } catch (err) {
                    console.error(`Error guardando imagen ${imageIndex}:`, err);
                  }
                })();
                imageUploadPromises.push(uploadPromise);
              },
              onComplete: async (text, tokenCount, images) => {
                // Esperar a que terminen todos los uploads de imagen
                if (imageUploadPromises.length > 0) {
                  await Promise.all(imageUploadPromises);
                }

                // Si no hubo uploads durante streaming pero llegaron imágenes en onComplete, guardarlas ahora
                if (imageUploadPromises.length === 0 && images && images.length > 0) {
                  for (const img of images) {
                    try {
                      const saved = await saveGeneratedImage(img, id);
                      savedImages.push({
                        url: saved.url,
                        fileSize: saved.fileSize,
                        mimeType: img.mimeType,
                      });
                    } catch (err) {
                      console.error("Error guardando imagen final:", err);
                    }
                  }
                }

                // Filtrar imágenes que se guardaron exitosamente
                const validImages = savedImages.filter(img => img.url);
                const hasImages = validImages.length > 0;
                const hasText = !!text;

                const imageAspectRatioToSave = hasImages ? effectiveImageAspectRatio : null;
                const imageSizeToSave = hasImages ? effectiveImageSize : null;

                let totalEstimatedCost = 0;
                const imageMessages: Array<{ id: number; imageUrl: string }> = [];

                // --- Guardar mensaje de texto (si hay texto, o texto+primera imagen si solo 1 imagen) ---
                if (hasText) {
                  // Texto puro: tokens van aquí, sin imagen
                  const textCost = calculateEstimatedCost(
                    effectiveCosts,
                    {
                      tokensInput: tokenCount.input,
                      tokensOutput: tokenCount.output,
                      imageGenerated: false,
                      imageSize: null,
                      videoSeconds: null,
                    }
                  );
                  totalEstimatedCost += textCost;

                  const [modelResult] = await pool.execute<ResultSetHeader>(
                    `INSERT INTO messages (conversation_id, role, content_type, quality_tier, model_id, content, tokens_input, tokens_output, estimated_cost, grounding_data)
                     VALUES (?, 'model', 'text', ?, ?, ?, ?, ?, ?, ?)`,
                    [id, effectiveQualityTier, effectiveModelDbId, text, tokenCount.input, tokenCount.output, textCost, groundingData ? JSON.stringify(groundingData) : null]
                  );
                  modelMessageId = modelResult.insertId;
                }

                // --- Guardar cada imagen como mensaje separado ---
                for (let i = 0; i < validImages.length; i++) {
                  const img = validImages[i];
                  const isFirstMessage = !hasText && i === 0;

                  const imageCost = calculateEstimatedCost(
                    effectiveCosts,
                    {
                      tokensInput: isFirstMessage ? tokenCount.input : 0,
                      tokensOutput: isFirstMessage ? tokenCount.output : 0,
                      imageGenerated: true,
                      imageSize: imageSizeToSave,
                      videoSeconds: null,
                    }
                  );
                  totalEstimatedCost += imageCost;

                  const [imgResult] = await pool.execute<ResultSetHeader>(
                    `INSERT INTO messages (conversation_id, role, content_type, quality_tier, model_id, content, image_url, image_mime_type, image_file_size, image_aspect_ratio, image_size, tokens_input, tokens_output, estimated_cost)
                     VALUES (?, 'model', 'image', ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, effectiveQualityTier, effectiveModelDbId, img.url, img.mimeType, img.fileSize, imageAspectRatioToSave, imageSizeToSave,
                     isFirstMessage ? tokenCount.input : 0,
                     isFirstMessage ? tokenCount.output : 0,
                     imageCost]
                  );

                  imageMessages.push({ id: imgResult.insertId, imageUrl: img.url });

                  // Si no hay texto, el primer mensaje de imagen es el modelMessageId principal
                  if (isFirstMessage) {
                    modelMessageId = imgResult.insertId;
                  }
                }

                // --- Si no hay texto ni imágenes, guardar mensaje vacío ---
                if (!hasText && validImages.length === 0) {
                  const textCost = calculateEstimatedCost(
                    effectiveCosts,
                    {
                      tokensInput: tokenCount.input,
                      tokensOutput: tokenCount.output,
                      imageGenerated: false,
                      imageSize: null,
                      videoSeconds: null,
                    }
                  );
                  totalEstimatedCost += textCost;

                  const [modelResult] = await pool.execute<ResultSetHeader>(
                    `INSERT INTO messages (conversation_id, role, content_type, quality_tier, model_id, content, tokens_input, tokens_output, estimated_cost)
                     VALUES (?, 'model', 'text', ?, ?, '', ?, ?, ?)`,
                    [id, effectiveQualityTier, effectiveModelDbId, tokenCount.input, tokenCount.output, textCost]
                  );
                  modelMessageId = modelResult.insertId;
                }

                // Acumular tokens y costo en la conversación
                await pool.execute(
                  `UPDATE conversations
                   SET total_tokens_input = total_tokens_input + ?,
                       total_tokens_output = total_tokens_output + ?,
                       total_estimated_cost = total_estimated_cost + ?
                   WHERE id = ?`,
                  [tokenCount.input, tokenCount.output, totalEstimatedCost, id]
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

                // Enviar evento de finalización
                if (!controllerClosed) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: "complete",
                        id: modelMessageId,
                        tokens: tokenCount,
                        totalTokens,
                        estimatedCost: totalEstimatedCost,
                        totalCost,
                        imageUrl: validImages.length === 1 ? validImages[0].url : null,
                        imageMessages: imageMessages.length > 0 ? imageMessages : undefined,
                      })}\n\n`
                    )
                  );
                  clearInterval(heartbeat);
                  controllerClosed = true;
                  controller.close();
                }

                // Generar título después de completar exitosamente (fire-and-forget)
                // Se genera aquí para no competir por cuota API con la llamada principal
                if (needsTitle && !skip_user_message) {
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
                if (!skip_user_message && userMessageId) {
                  await pool.execute(
                    `UPDATE messages SET ignore_in_context = 1 WHERE id = ?`,
                    [userMessageId]
                  );
                }

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
                  clearInterval(heartbeat);
                  controllerClosed = true;
                  controller.close();
                }
              },
            },
            labels,
            request.signal,
            effectiveBackend
          );
        } catch (error) {
          // Si el cliente se desconectó, no guardar error ni intentar enviar
          if (controllerClosed) return;

          console.error("Error iniciando streaming:", error);
          const errorMessage = error instanceof Error ? error.message : "Error desconocido";

          // Guardar mensaje de error
          try {
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
            }
          } catch (dbError) {
            console.error("Error saving error message:", dbError);
            if (!controllerClosed) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "error",
                    message: errorMessage,
                  })}\n\n`
                )
              );
            }
          }

          clearInterval(heartbeat);
          controllerClosed = true;
          controller.close();
        }
      },
      cancel() {
        // Cliente se desconectó (navegó, abortó fetch, reintentó)
        clearInterval(heartbeat);
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
