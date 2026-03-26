import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { generateImagen, ImagenAspectRatio, ImagenResolution, Labels } from "@/lib/google-ai-imagen";
import { generateXaiImage, XaiImageAspectRatio, XaiImageResolution } from "@/lib/xai-image";
import { generateKlingImage, KlingImageConfig } from "@/lib/kling-image";
import { uploadToS3, generateFileName, isS3Configured } from "@/lib/s3";
import { generateConversationTitle } from "@/lib/google-ai";
import { calculateEstimatedCost } from "@/lib/cost-calculator";
import { isRedisConfigured, createRedisConnection } from "@/lib/redis";
import { getImagenQueue, jobChannel, ImagenJobEvent, IMAGEN_QUEUE_NAME, hasActiveWorkers } from "@/lib/queue";

// Allow up to 5 minutes for image generation (retries can be slow)
export const maxDuration = 300;

type QualityTier = "normal" | "hq";

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number | null;
  model_id: number;
  generation_type: string;
  title: string | null;
  model_model_id: string;
  system_instruction: string | null;
  image_aspect_ratio: string;
  image_size: string;
  supports_image_generation: boolean;
  project_name: string | null;
  client_name: string | null;
  cost_image_1k: number;
  cost_image_2k: number;
  cost_image_4k: number;
  model_api_backend: string | null;
}

// POST - Generar imagen con Imagen 4 o Grok (worker con fallback directo)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (!isS3Configured()) {
      return NextResponse.json({ error: "S3 no configurado para almacenar imagenes" }, { status: 500 });
    }

    const { id } = await params;
    const body = await request.json();

    const {
      content,
      imageSettings,
      quality_tier,
      selected_model_id,
      generation_type_override,
      files,
    } = body as {
      content: string;
      imageSettings?: {
        aspectRatio?: ImagenAspectRatio;
        resolution?: ImagenResolution;
        negativePrompt?: string;
        seed?: number;
        numberOfImages?: number;
      };
      quality_tier?: QualityTier;
      selected_model_id?: number;
      generation_type_override?: "text" | "image" | "video" | "audio" | "canvas";
      files?: Array<{
        dataUrl: string;
        mimeType: string;
        name: string;
        type: string;
        url?: string; // S3/CDN URL for preselected images
      }>;
    };

    const effectiveQualityTier: QualityTier = quality_tier === "hq" ? "hq" : "normal";

    if (!content || content.trim() === "") {
      return NextResponse.json({ error: "El prompt de la imagen es requerido" }, { status: 400 });
    }

    // Obtener conversacion con configuracion de imagen y costos del modelo
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT c.*, m.model_id as model_model_id, m.supports_image_generation, m.api_backend as model_api_backend, p.title as project_name, cl.name as client_name,
              m.cost_image_1k, m.cost_image_2k, m.cost_image_4k
       FROM conversations c
       JOIN models m ON c.model_id = m.id
       LEFT JOIN projects p ON c.project_id = p.id
       LEFT JOIN clients cl ON p.client_id = cl.id
       WHERE c.id = ? AND c.deleted_at IS NULL`,
      [id]
    );

    if (conversations.length === 0) {
      return NextResponse.json({ error: "Conversacion no encontrada" }, { status: 404 });
    }

    const conversation = conversations[0];

    // Resolve effective model
    let effectiveModelId = conversation.model_model_id;
    let effectiveModelDbId = conversation.model_id;
    let effectiveBackend = conversation.model_api_backend || undefined;
    let effectiveCostImage1k = Number(conversation.cost_image_1k) || 0;
    let effectiveCostImage2k = Number(conversation.cost_image_2k) || 0;
    let effectiveCostImage4k = Number(conversation.cost_image_4k) || 0;
    // Canvas and full types resolve to "image" for model lookup
    const rawType = generation_type_override || conversation.generation_type || "image";
    const generationType = (rawType === "canvas" || rawType === "full") ? "image" : rawType;

    if (conversation.project_id) {
      const [projectModels] = await pool.execute<RowDataPacket[]>(`
        SELECT
          pgm.model_id,
          pgm.is_default,
          m.model_id as model_model_id,
          m.api_backend as model_api_backend,
          m.cost_image_1k,
          m.cost_image_2k,
          m.cost_image_4k
        FROM project_generation_models pgm
        JOIN models m ON pgm.model_id = m.id
        JOIN project_generation_config pgc ON pgc.project_id = pgm.project_id AND pgc.generation_type = pgm.generation_type
        WHERE pgm.project_id = ? AND pgm.generation_type = ? AND pgc.is_enabled = 1
        ORDER BY pgm.sort_order ASC
      `, [conversation.project_id, generationType]);

      if (projectModels.length > 0) {
        const chosen = projectModels.find((m: RowDataPacket) => selected_model_id && m.model_id === selected_model_id)
          || projectModels.find((m: RowDataPacket) => m.is_default)
          || projectModels[0];
        effectiveModelId = chosen.model_model_id;
        effectiveModelDbId = chosen.model_id;
        effectiveBackend = chosen.model_api_backend || undefined;
        effectiveCostImage1k = Number(chosen.cost_image_1k) || 0;
        effectiveCostImage2k = Number(chosen.cost_image_2k) || 0;
        effectiveCostImage4k = Number(chosen.cost_image_4k) || 0;
      }
    }

    // Verificar que el modelo soporta generacion de imagenes dedicada
    const isImagen4 = effectiveModelId.includes("imagen-4");
    const isGrokImage = effectiveModelId.includes("grok-imagine-image");
    const isKlingImage = effectiveBackend === "kling" || effectiveModelId.includes("kling-omni-image");
    if (!isImagen4 && !isGrokImage && !isKlingImage) {
      return NextResponse.json({ error: "El modelo seleccionado no soporta generacion de imagenes dedicada" }, { status: 400 });
    }

    // Guardar mensaje del usuario
    const [userMessageResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO messages (conversation_id, user_id, role, content_type, quality_tier, content)
       VALUES (?, ?, 'user', 'text', ?, ?)`,
      [id, session.user.id, effectiveQualityTier, content]
    );
    const userMessageId = userMessageResult.insertId;

    // Save reference images to message_images table
    if (files && files.length > 0) {
      const imageFiles = files.filter(f => f.type === "image");
      for (let i = 0; i < imageFiles.length; i++) {
        try {
          const imgFile = imageFiles[i];
          // Use S3 URL if available, otherwise upload the base64 data
          let imgUrl = imgFile.url;
          if (!imgUrl && imgFile.dataUrl) {
            const { uploadToS3 } = await import("@/lib/s3");
            const base64Data = imgFile.dataUrl.split(",")[1];
            const ext = imgFile.mimeType?.split("/")[1] || "png";
            const result = await uploadToS3(
              Buffer.from(base64Data, "base64"),
              `conversations/${id}/ref_${userMessageId}_${i}.${ext}`,
              imgFile.mimeType || "image/png"
            );
            imgUrl = result.url;
          }
          if (imgUrl) {
            const fileSize = imgFile.dataUrl ? Buffer.from(imgFile.dataUrl.split(",")[1], "base64").length : null;
            await pool.execute(
              `INSERT INTO message_images (message_id, image_url, mime_type, file_size, sort_order) VALUES (?, ?, ?, ?, ?)`,
              [userMessageId, imgUrl, imgFile.mimeType, fileSize, i]
            );
          }
        } catch (err) {
          console.error(`Error guardando imagen ref ${i} en message_images:`, err);
        }
      }
    }

    const needsTitle = conversation.title === "Nueva conversación" || !conversation.title;

    await pool.execute(
      "UPDATE conversations SET updated_at = NOW() WHERE id = ?",
      [id]
    );

    const userIdentifier = session.user.email?.split("@")[0] || "unknown";
    const labels: Labels = {
      project_name: conversation.client_name ? `${conversation.client_name} > ${conversation.project_name}` : conversation.project_name || "sin_proyecto",
      user_name: userIdentifier,
    };

    const aspectRatio: ImagenAspectRatio = (imageSettings?.aspectRatio ||
      conversation.image_aspect_ratio || "16:9") as ImagenAspectRatio;
    const resolution: ImagenResolution = (imageSettings?.resolution ||
      conversation.image_size || "1K") as ImagenResolution;
    const maxImages = isKlingImage ? 9 : isGrokImage ? 10 : 4;
    const numberOfImages = Math.min(maxImages, Math.max(1, imageSettings?.numberOfImages || 1));

    // Extract reference image URLs from attached files (for providers that support it)
    const referenceImageUrls: string[] = [];
    if (files && files.length > 0) {
      for (const file of files) {
        if (file.type === "image") {
          // Prefer S3/CDN URL if available, otherwise use dataUrl (base64)
          if (file.url) {
            referenceImageUrls.push(file.url);
          } else if (file.dataUrl) {
            referenceImageUrls.push(file.dataUrl);
          }
        }
      }
    }

    // SSE stream
    const encoder = new TextEncoder();
    let controllerClosed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const heartbeat = setInterval(() => {
          if (!controllerClosed) {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } else {
            clearInterval(heartbeat);
          }
        }, 10000);

        const sendEvent = (data: Record<string, unknown>) => {
          if (!controllerClosed) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          }
        };

        // Send user message ID immediately
        sendEvent({ type: "user_message", id: userMessageId });

        // ============================================
        // WORKER DELEGATION (when Redis is available)
        // ============================================
        const redisReady = isRedisConfigured();
        const workersAvailable = redisReady && await hasActiveWorkers(IMAGEN_QUEUE_NAME);
        console.log(`[Imagen] Redis configured: ${redisReady}, Workers available: ${workersAvailable}`);

        if (redisReady && workersAvailable) {
          try {
            const queue = getImagenQueue();

            // Create placeholder messages before enqueuing
            const placeholderIds: number[] = [];
            for (let i = 0; i < numberOfImages; i++) {
              const [ph] = await pool.execute<ResultSetHeader>(
                `INSERT INTO messages (conversation_id, user_id, role, status, content_type, quality_tier, model_id, content, image_aspect_ratio, image_size)
                 VALUES (?, ?, 'model', 'generating', 'image', ?, ?, '', ?, ?)`,
                [id, session.user.id, effectiveQualityTier, effectiveModelDbId, aspectRatio, resolution]
              );
              placeholderIds.push(ph.insertId);
            }
            sendEvent({ type: "placeholders", ids: placeholderIds });

            const job = await queue.add("imagen", {
              conversationId: id,
              userMessageId,
              userId: session.user.id as number,
              content,
              modelId: effectiveModelId,
              modelDbId: effectiveModelDbId,
              backend: effectiveBackend,
              qualityTier: effectiveQualityTier,
              aspectRatio,
              resolution,
              negativePrompt: imageSettings?.negativePrompt,
              numberOfImages,
              seed: imageSettings?.seed,
              labels: {
                project_name: conversation.client_name ? `${conversation.client_name} > ${conversation.project_name}` : conversation.project_name || "sin_proyecto",
                user_name: userIdentifier,
              },
              needsTitle,
              referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
              costImage1k: effectiveCostImage1k,
              costImage2k: effectiveCostImage2k,
              costImage4k: effectiveCostImage4k,
              placeholderIds,
            });

            console.log(`[Imagen] Job ${job.id} enqueued to worker`);

            // Subscribe to worker events via Redis pub/sub
            const subRedis = createRedisConnection();
            const channel = jobChannel(job.id!);

            // Safety timeout: 10 minutes
            const workerTimeout = setTimeout(() => {
              if (!controllerClosed) {
                sendEvent({ type: "error", message: "Worker timeout" });
                clearInterval(heartbeat);
                controllerClosed = true;
                controller.close();
                subRedis.unsubscribe();
                subRedis.disconnect();
              }
            }, 600000);

            await subRedis.subscribe(channel);

            // Handle Redis subscriber errors (connection drops, etc.)
            subRedis.on("error", (err: Error) => {
              console.error(`[Imagen] Redis subscriber error for job ${job.id}:`, err.message);
              if (!controllerClosed) {
                sendEvent({ type: "error", message: "Conexión con worker perdida. Refresca para ver el resultado." });
                clearInterval(heartbeat);
                clearTimeout(workerTimeout);
                controllerClosed = true;
                controller.close();
                subRedis.disconnect();
              }
            });

            subRedis.on("message", (ch: string, message: string) => {
              if (ch !== channel || controllerClosed) return;
              try {
                const event: ImagenJobEvent = JSON.parse(message);

                if (event.type === "complete" || event.type === "error") {
                  sendEvent(event as unknown as Record<string, unknown>);
                  clearInterval(heartbeat);
                  clearTimeout(workerTimeout);
                  controllerClosed = true;
                  controller.close();
                  subRedis.unsubscribe();
                  subRedis.disconnect();
                } else {
                  sendEvent(event as unknown as Record<string, unknown>);
                }
              } catch (err) {
                console.error("[Imagen] Error parsing worker event:", err);
              }
            });

            return; // Worker handles it
          } catch (err) {
            console.error("[Imagen] Error enqueuing to worker, falling back to direct:", err);
            // Fall through to direct processing
          }
        }

        // ============================================
        // DIRECT PROCESSING (fallback when no workers)
        // ============================================
        const placeholderIds: number[] = [];
        try {
          console.log(`[Imagen] Processing directly (no workers available)`);

          // Create placeholder messages in DB
          for (let i = 0; i < numberOfImages; i++) {
            const [ph] = await pool.execute<ResultSetHeader>(
              `INSERT INTO messages (conversation_id, user_id, role, status, content_type, quality_tier, model_id, content, image_aspect_ratio, image_size)
               VALUES (?, ?, 'model', 'generating', 'image', ?, ?, '', ?, ?)`,
              [id, session.user.id, effectiveQualityTier, effectiveModelDbId, aspectRatio, resolution]
            );
            placeholderIds.push(ph.insertId);
          }
          sendEvent({ type: "placeholders", ids: placeholderIds });

          const onProgress = (progress: { status: string; message: string }) => {
            const retryMatch = progress.message.match(/Reintentando \((\d+)\/(\d+)\).*?(\d+)s/);
            if (retryMatch) {
              sendEvent({
                type: "retry",
                attempt: parseInt(retryMatch[1]),
                maxAttempts: parseInt(retryMatch[2]),
                delaySeconds: parseInt(retryMatch[3]),
              });
            }
          };

          // Generate images using the appropriate provider
          let generatedImages: Array<{ data: Buffer; mimeType: string; seed?: number }>;

          if (isKlingImage) {
            const klingResults = await generateKlingImage(
              effectiveModelId,
              content,
              {
                aspectRatio: aspectRatio as KlingImageConfig["aspectRatio"],
                resolution: (resolution?.toLowerCase() || "1k") as KlingImageConfig["resolution"],
                numberOfImages,
              },
              onProgress,
            );
            generatedImages = klingResults;
          } else if (effectiveBackend === "xai") {
            const xaiResults = await generateXaiImage(
              effectiveModelId,
              content,
              {
                aspectRatio: aspectRatio as XaiImageAspectRatio,
                resolution: (resolution?.toLowerCase() || "1k") as XaiImageResolution,
                numberOfImages,
                imageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
              },
              onProgress,
            );
            generatedImages = xaiResults;
          } else {
            const imagenResults = await generateImagen(
              effectiveModelId,
              content,
              {
                aspectRatio,
                resolution,
                negativePrompt: imageSettings?.negativePrompt,
                numberOfImages,
                seed: imageSettings?.seed,
              },
              onProgress,
              labels,
              effectiveBackend
            );
            generatedImages = imagenResults;
          }

          if (generatedImages.length === 0) {
            throw new Error("No se genero ninguna imagen");
          }

          // Calculate per-image cost
          const costPerImage = calculateEstimatedCost(
            {
              cost_input_per_million: 0,
              cost_output_per_million: 0,
              cost_image_1k: effectiveCostImage1k,
              cost_image_2k: effectiveCostImage2k,
              cost_image_4k: effectiveCostImage4k,
              cost_video_per_second: 0,
            },
            {
              tokensInput: 0,
              tokensOutput: 0,
              imageGenerated: true,
              imageSize: resolution,
              videoSeconds: 0,
            }
          );

          const imageMessages: Array<{ id: number; imageUrl: string }> = [];
          let totalCost = 0;

          for (let i = 0; i < generatedImages.length; i++) {
            const generatedImage = generatedImages[i];

            const extension = generatedImage.mimeType.split("/")[1] || "png";
            const fileName = generateFileName(id, extension);
            const uploadResult = await uploadToS3(
              generatedImage.data,
              fileName,
              generatedImage.mimeType,
              "generated"
            );

            await pool.execute(
              `UPDATE messages SET status = 'completed', generation_seed = ?, image_url = ?, image_mime_type = ?, estimated_cost = ? WHERE id = ?`,
              [generatedImage.seed ?? null, uploadResult.url, generatedImage.mimeType, costPerImage, placeholderIds[i]]
            );

            totalCost += costPerImage;
            imageMessages.push({ id: placeholderIds[i], imageUrl: uploadResult.url });

            sendEvent({
              type: "image",
              imageUrl: uploadResult.url,
              mimeType: generatedImage.mimeType,
              seed: generatedImage.seed,
              estimatedCost: costPerImage,
              imageIndex: i,
            });
          }

          // Update total cost on conversation
          await pool.execute(
            `UPDATE conversations SET total_estimated_cost = total_estimated_cost + ? WHERE id = ?`,
            [totalCost, id]
          );

          // Send completion event
          sendEvent({
            type: "complete",
            id: imageMessages[0].id,
            imageUrl: imageMessages[0].imageUrl,
            seed: generatedImages[0].seed,
            estimatedCost: totalCost,
            imageMessages,
          });

          clearInterval(heartbeat);
          controllerClosed = true;
          controller.close();

          // Generate title (fire-and-forget)
          if (needsTitle) {
            generateConversationTitle(content, labels)
              .then(async (title) => {
                await pool.execute(
                  "UPDATE conversations SET title = ? WHERE id = ?",
                  [title, id]
                );
                console.log("[Imagen] Generated title:", title);
              })
              .catch((err) => {
                console.error("[Imagen] Error generating title:", err);
              });
          }

        } catch (error) {
          console.error("[Imagen] Error generating image:", error);
          const errorMessage = error instanceof Error ? error.message : "Error desconocido";

          // Guardar mensaje de error con metadata de la generación para poder reutilizar
          try {
            if (placeholderIds.length > 0) {
              // Update any remaining placeholders to error
              await pool.execute(
                `UPDATE messages SET status = 'error', content = ? WHERE id IN (${placeholderIds.map(() => '?').join(',')}) AND status = 'generating'`,
                [`Error generando imagen: ${errorMessage}`, ...placeholderIds]
              );
              sendEvent({ type: "error", message: errorMessage, id: placeholderIds[0] });
            } else {
              // No placeholders yet, insert error message
              const [modelResult] = await pool.execute<ResultSetHeader>(
                `INSERT INTO messages (conversation_id, user_id, role, status, content_type, content, model_id, quality_tier, image_aspect_ratio, image_size)
                 VALUES (?, ?, 'model', 'error', 'error', ?, ?, ?, ?, ?)`,
                [id, session.user.id, `Error generando imagen: ${errorMessage}`, effectiveModelDbId, effectiveQualityTier, aspectRatio, resolution]
              );
              sendEvent({ type: "error", message: errorMessage, id: modelResult.insertId });
            }
          } catch (dbError) {
            console.error("[Imagen] Error saving error message:", dbError);
            sendEvent({ type: "error", message: errorMessage });
          }

          clearInterval(heartbeat);
          controllerClosed = true;
          controller.close();
        }
      },
      cancel() {
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
    console.error("[Imagen] Error en endpoint de imagen:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
