import { NextRequest } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { generateImagen, isImagenConfigured, ImagenAspectRatio, ImagenResolution, Labels } from "@/lib/google-ai-imagen";
import { uploadToS3, generateFileName, isS3Configured } from "@/lib/s3";
import { generateConversationTitle } from "@/lib/google-ai";
import { calculateEstimatedCost } from "@/lib/cost-calculator";

type QualityTier = "normal" | "hq";

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number | null;
  model_id: number;
  generation_type: string;
  model_model_id: string;
  system_instruction: string | null;
  image_aspect_ratio: string;
  image_size: string;
  supports_image_generation: boolean;
  project_name: string | null;
  // Cost fields from model
  cost_image_1k: number;
  cost_image_2k: number;
  cost_image_4k: number;
}

interface MessageRow extends RowDataPacket {
  id: number;
}

// POST - Generar imagen con Imagen 4
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

    if (!isImagenConfigured()) {
      return new Response(JSON.stringify({ error: "API de Imagen no configurada" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!isS3Configured()) {
      return new Response(JSON.stringify({ error: "S3 no configurado para almacenar imagenes" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { id } = await params;
    const body = await request.json();

    const {
      content,
      imageSettings,
      quality_tier = "normal",
      generation_type_override,
    } = body as {
      content: string;
      imageSettings?: {
        aspectRatio?: ImagenAspectRatio;
        resolution?: ImagenResolution;
        negativePrompt?: string;
        seed?: number;
      };
      quality_tier?: QualityTier;
      generation_type_override?: "text" | "image" | "video" | "audio";
    };

    // Validate quality_tier
    const effectiveQualityTier: QualityTier = quality_tier === "hq" ? "hq" : "normal";

    if (!content || content.trim() === "") {
      return new Response(JSON.stringify({ error: "El prompt de la imagen es requerido" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Obtener conversacion con configuracion de imagen y costos del modelo
    const isAdmin = session.user.role === "admin";
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT c.*, m.model_id as model_model_id, m.supports_image_generation, p.title as project_name,
              m.cost_image_1k, m.cost_image_2k, m.cost_image_4k
       FROM conversations c
       JOIN models m ON c.model_id = m.id
       LEFT JOIN projects p ON c.project_id = p.id
       WHERE c.id = ? ${isAdmin ? "" : "AND c.user_id = ?"} AND c.deleted_at IS NULL`,
      isAdmin ? [id] : [id, session.user.id]
    );

    if (conversations.length === 0) {
      return new Response(JSON.stringify({ error: "Conversacion no encontrada" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const conversation = conversations[0];

    // Get the correct model from project_generation_config based on quality_tier
    // Use generation_type_override if provided (e.g., when video conversation is in image mode)
    let effectiveModelId = conversation.model_model_id;
    let effectiveCostImage1k = Number(conversation.cost_image_1k) || 0;
    let effectiveCostImage2k = Number(conversation.cost_image_2k) || 0;
    let effectiveCostImage4k = Number(conversation.cost_image_4k) || 0;
    const generationType = generation_type_override || conversation.generation_type || "image";
    if (generation_type_override) {
      console.log(`[Imagen] Using generation_type_override: ${generation_type_override} (conversation type: ${conversation.generation_type})`);
    }

    if (conversation.project_id) {
      const [configRows] = await pool.execute<RowDataPacket[]>(`
        SELECT
          pgc.model_normal_id,
          pgc.model_hq_id,
          mn.model_id as model_normal_model_id,
          mn.cost_image_1k as mn_cost_1k,
          mn.cost_image_2k as mn_cost_2k,
          mn.cost_image_4k as mn_cost_4k,
          mh.model_id as model_hq_model_id,
          mh.cost_image_1k as mh_cost_1k,
          mh.cost_image_2k as mh_cost_2k,
          mh.cost_image_4k as mh_cost_4k
        FROM project_generation_config pgc
        LEFT JOIN models mn ON pgc.model_normal_id = mn.id
        LEFT JOIN models mh ON pgc.model_hq_id = mh.id
        WHERE pgc.project_id = ? AND pgc.generation_type = ? AND pgc.is_enabled = 1
      `, [conversation.project_id, generationType]);

      if (configRows.length > 0) {
        const config = configRows[0];
        if (effectiveQualityTier === "hq" && config.model_hq_model_id) {
          effectiveModelId = config.model_hq_model_id;
          effectiveCostImage1k = Number(config.mh_cost_1k) || 0;
          effectiveCostImage2k = Number(config.mh_cost_2k) || 0;
          effectiveCostImage4k = Number(config.mh_cost_4k) || 0;
          console.log(`[Imagen] Using HQ model from config: ${effectiveModelId}`);
        } else if (config.model_normal_model_id) {
          effectiveModelId = config.model_normal_model_id;
          effectiveCostImage1k = Number(config.mn_cost_1k) || 0;
          effectiveCostImage2k = Number(config.mn_cost_2k) || 0;
          effectiveCostImage4k = Number(config.mn_cost_4k) || 0;
          console.log(`[Imagen] Using Normal model from config: ${effectiveModelId}`);
        }
      }
    }

    // Verificar que el modelo es Imagen 4
    if (!effectiveModelId.includes("imagen-4")) {
      return new Response(JSON.stringify({ error: "El modelo seleccionado no es Imagen 4" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verificar limite de generaciones de imagen mensuales (por calidad)
    if (conversation.project_id && session.user.role !== "admin") {
      const limitColumn = effectiveQualityTier === "hq"
        ? "max_monthly_image_hq"
        : "max_monthly_image_normal";

      const [limitRows] = await pool.execute<RowDataPacket[]>(`
        SELECT
          COALESCE(pu.${limitColumn}, 0) as max_limit,
          (
            SELECT COUNT(*)
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            WHERE c.project_id = ?
              AND c.user_id = ?
              AND m.role = 'model'
              AND m.image_url IS NOT NULL
              AND m.quality_tier = ?
              AND m.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
          ) as current_count
        FROM project_users pu
        WHERE pu.project_id = ? AND pu.user_id = ?
      `, [conversation.project_id, session.user.id, effectiveQualityTier, conversation.project_id, session.user.id]);

      if (limitRows.length > 0) {
        const maxLimit = limitRows[0].max_limit;
        const currentCount = limitRows[0].current_count;
        if (maxLimit > 0 && currentCount >= maxLimit) {
          return new Response(JSON.stringify({
            error: `Has alcanzado el limite de generaciones de imagen ${effectiveQualityTier === 'hq' ? 'HQ' : 'normales'} mensuales para este proyecto`,
            type: "image_limit",
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

    // Guardar mensaje del usuario (con quality_tier)
    const [userMessageResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO messages (conversation_id, role, content_type, quality_tier, content)
       VALUES (?, 'user', 'text', ?, ?)`,
      [id, effectiveQualityTier, content]
    );
    const userMessageId = userMessageResult.insertId;

    // Verificar si es el primer mensaje
    const [messageCount] = await pool.execute<MessageRow[]>(
      `SELECT id FROM messages WHERE conversation_id = ? LIMIT 2`,
      [id]
    );
    const isFirstMessage = messageCount.length === 1;

    // Actualizar timestamp de la conversacion
    await pool.execute(
      "UPDATE conversations SET updated_at = NOW() WHERE id = ?",
      [id]
    );

    // Preparar labels para tracking
    const userIdentifier = session.user.email?.split("@")[0] || "unknown";
    const labels: Labels = {
      project_name: conversation.project_name || "sin_proyecto",
      user_name: userIdentifier,
    };

    // Crear el stream de respuesta SSE
    const encoder = new TextEncoder();
    let controllerClosed = false;

    const stream = new ReadableStream({
      async start(controller) {

        const sendEvent = (data: Record<string, unknown>) => {
          if (!controllerClosed) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
            );
          }
        };

        try {
          // Enviar el ID del mensaje del usuario
          sendEvent({ type: "user_message", id: userMessageId });

          // Generar titulo si es el primer mensaje (async)
          if (isFirstMessage) {
            generateConversationTitle(content, labels)
              .then(async (title) => {
                await pool.execute(
                  "UPDATE conversations SET title = ? WHERE id = ?",
                  [title, id]
                );
                sendEvent({ type: "title", title });
              })
              .catch((err) => {
                console.error("[Imagen] Error generating title:", err);
              });
          }

          // Configuracion de generacion de imagen (usa request settings, fallback a conversation settings)
          const aspectRatio: ImagenAspectRatio = (imageSettings?.aspectRatio ||
            conversation.image_aspect_ratio || "16:9") as ImagenAspectRatio;
          const resolution: ImagenResolution = (imageSettings?.resolution ||
            conversation.image_size || "1K") as ImagenResolution;

          console.log("\n========== [IMAGEN 4 GENERATION REQUEST] ==========");
          console.log("Model:", effectiveModelId);
          console.log("Quality tier:", effectiveQualityTier);
          console.log("Aspect Ratio:", aspectRatio);
          console.log("Resolution:", resolution);
          console.log("Prompt:", content);
          if (imageSettings?.negativePrompt) {
            console.log("Negative Prompt:", imageSettings.negativePrompt);
          }
          if (imageSettings?.seed) {
            console.log("User-provided Seed:", imageSettings.seed);
          }
          console.log("====================================================\n");

          // Callback de progreso
          const onProgress = (progress: { status: string; message: string }) => {
            sendEvent({
              type: "progress",
              status: progress.status,
              message: progress.message,
            });
          };

          // Generar imagen (use user-provided seed if available)
          const generatedImages = await generateImagen(
            effectiveModelId,
            content,
            {
              aspectRatio,
              resolution,
              negativePrompt: imageSettings?.negativePrompt,
              numberOfImages: 1,
              seed: imageSettings?.seed,
            },
            onProgress,
            labels
          );

          if (generatedImages.length === 0) {
            throw new Error("No se genero ninguna imagen");
          }

          const generatedImage = generatedImages[0];

          // Guardar imagen en S3
          sendEvent({
            type: "progress",
            status: "processing",
            message: "Guardando imagen...",
          });

          const extension = generatedImage.mimeType.split("/")[1] || "png";
          const fileName = generateFileName(id, extension);
          const uploadResult = await uploadToS3(
            generatedImage.data,
            fileName,
            generatedImage.mimeType,
            "generated"
          );

          // Calculate estimated cost for image generation using effective model cost
          const estimatedCost = calculateEstimatedCost(
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

          // Guardar respuesta del modelo en la base de datos (con quality_tier y seed)
          const [modelResult] = await pool.execute<ResultSetHeader>(
            `INSERT INTO messages (conversation_id, role, content_type, quality_tier, generation_seed, content, image_url, image_mime_type, estimated_cost)
             VALUES (?, 'model', 'image', ?, ?, '', ?, ?, ?)`,
            [
              id,
              effectiveQualityTier,
              generatedImage.seed,
              uploadResult.url,
              generatedImage.mimeType,
              estimatedCost,
            ]
          );

          const modelMessageId = modelResult.insertId;

          // Actualizar costo total en la conversacion
          await pool.execute(
            `UPDATE conversations
             SET total_estimated_cost = total_estimated_cost + ?
             WHERE id = ?`,
            [estimatedCost, id]
          );

          // Enviar evento de imagen generada
          sendEvent({
            type: "image",
            imageUrl: uploadResult.url,
            mimeType: generatedImage.mimeType,
            seed: generatedImage.seed,
            estimatedCost,
          });

          // Enviar evento de finalizacion
          sendEvent({
            type: "complete",
            id: modelMessageId,
            imageUrl: uploadResult.url,
            seed: generatedImage.seed,
            estimatedCost,
          });

          controllerClosed = true;
          controller.close();

        } catch (error) {
          console.error("[Imagen] Error generating image:", error);
          const errorMessage = error instanceof Error ? error.message : "Error desconocido";

          // Guardar mensaje de error (con content_type 'error' para excluirlo del historial)
          const [modelResult] = await pool.execute<ResultSetHeader>(
            `INSERT INTO messages (conversation_id, role, content_type, content)
             VALUES (?, 'model', 'error', ?)`,
            [id, `Error generando imagen: ${errorMessage}`]
          );

          sendEvent({
            type: "error",
            message: errorMessage,
            id: modelResult.insertId,
          });

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
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
