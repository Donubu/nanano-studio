import { NextRequest } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { generateVideo, isVideoConfigured, VideoGenerationConfig, VideoInput, VideoGenerationProgress } from "@/lib/google-ai-video";
import { uploadVideoToS3, generateVideoFileName, isS3Configured } from "@/lib/s3";
import { generateConversationTitle, Labels } from "@/lib/google-ai";
import { calculateEstimatedCost } from "@/lib/cost-calculator";

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
  video_duration: number;
  video_resolution: string;
  video_aspect_ratio: string;
  video_audio_enabled: boolean;
  video_negative_prompt: string | null;
  supports_video_generation: boolean;
  project_name: string | null;
  // Cost fields from model
  cost_video_per_second: number;
  model_api_backend: string | null;
}

interface VideoLimitRow extends RowDataPacket {
  max_monthly_video_generations: number;
  current_month_video_count: number;
  max_monthly_video_normal: number;
  max_monthly_video_hq: number;
}

interface MessageRow extends RowDataPacket {
  id: number;
}

// POST - Generar video con VEO
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

    if (!isVideoConfigured()) {
      return new Response(JSON.stringify({ error: "API de Google AI Video no configurada" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!isS3Configured()) {
      return new Response(JSON.stringify({ error: "S3 no configurado para almacenar videos" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { id } = await params;
    const body = await request.json();
    // Type for reference images with ASSET or STYLE type
    type ReferenceImageWithType = {
      image: string;
      type: "ASSET" | "STYLE";
    };

    const {
      content,
      firstFrameImage,
      lastFrameImage,
      referenceImages,
      videoSettings,
      videoInputs,
      quality_tier = "normal",
    } = body as {
      content: string;
      firstFrameImage?: string;
      lastFrameImage?: string;
      referenceImages?: ReferenceImageWithType[];
      videoSettings?: {
        duration?: number;
        resolution?: string;
        aspectRatio?: string;
        audioEnabled?: boolean;
        negativePrompt?: string;
        seed?: number;
      };
      videoInputs?: {
        firstFrame?: string;
        lastFrame?: string;
        referenceImages?: ReferenceImageWithType[];
      };
      quality_tier?: QualityTier;
    };

    // Validate quality_tier
    const effectiveQualityTier: QualityTier = quality_tier === "hq" ? "hq" : "normal";

    // Debug: log received settings
    console.log("[Video API] Received videoSettings:", videoSettings);
    console.log("[Video API] audioEnabled from request:", videoSettings?.audioEnabled);

    if (!content || content.trim() === "") {
      return new Response(JSON.stringify({ error: "El prompt del video es requerido" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Obtener conversación con configuración de video y costos del modelo
    const isAdmin = session.user.role === "admin";
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT c.*, m.model_id as model_model_id, m.supports_video_generation, m.api_backend as model_api_backend, p.title as project_name,
              m.cost_video_per_second
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

    // Get the correct model from project_generation_config based on quality_tier
    let effectiveModelId = conversation.model_model_id;
    let effectiveBackend = conversation.model_api_backend || undefined;
    let effectiveCostVideoPerSecond = Number(conversation.cost_video_per_second) || 0;
    const generationType = conversation.generation_type || "video";

    if (conversation.project_id) {
      const [configRows] = await pool.execute<RowDataPacket[]>(`
        SELECT
          pgc.model_normal_id,
          pgc.model_hq_id,
          mn.model_id as model_normal_model_id,
          mn.api_backend as mn_api_backend,
          mn.cost_video_per_second as mn_cost_video,
          mh.model_id as model_hq_model_id,
          mh.api_backend as mh_api_backend,
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
          effectiveBackend = config.mh_api_backend || undefined;
          effectiveCostVideoPerSecond = Number(config.mh_cost_video) || 0;
          console.log(`[Video] Using HQ model from config: ${effectiveModelId} (${effectiveBackend || 'default'})`);
        } else if (config.model_normal_model_id) {
          effectiveModelId = config.model_normal_model_id;
          effectiveBackend = config.mn_api_backend || undefined;
          effectiveCostVideoPerSecond = Number(config.mn_cost_video) || 0;
          console.log(`[Video] Using Normal model from config: ${effectiveModelId} (${effectiveBackend || 'default'})`);
        }
      }
    }

    // Verificar que el modelo soporta video
    if (!conversation.supports_video_generation) {
      return new Response(JSON.stringify({ error: "El modelo seleccionado no soporta generación de video" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verificar límite de generaciones de video mensuales (por calidad)
    if (conversation.project_id && session.user.role !== "admin") {
      const limitColumn = effectiveQualityTier === "hq"
        ? "max_monthly_video_hq"
        : "max_monthly_video_normal";

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
              AND m.video_url IS NOT NULL
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
            error: `Has alcanzado el límite de generaciones de video ${effectiveQualityTier === 'hq' ? 'HQ' : 'normales'} mensuales para este proyecto`,
            type: "video_limit",
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

    // Verificar si necesita generar titulo (aún tiene el titulo por defecto)
    const needsTitle = conversation.title === "Nueva conversación" || !conversation.title;

    // Actualizar timestamp de la conversación
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

          // Configuración de generación de video (usa request settings, fallback a conversation settings)
          const audioEnabled = videoSettings?.audioEnabled !== undefined
            ? videoSettings.audioEnabled
            : (conversation.video_audio_enabled ?? true);

          // Use user-provided seed or generate random seed (uint32 range: 0-4294967295)
          const generatedSeed = videoSettings?.seed ?? Math.floor(Math.random() * 4294967295);

          const videoConfig: VideoGenerationConfig = {
            durationSeconds: ((videoSettings?.duration || conversation.video_duration) as 4 | 6 | 8) || 8,
            resolution: ((videoSettings?.resolution || conversation.video_resolution) as "720p" | "1080p") || "720p",
            aspectRatio: ((videoSettings?.aspectRatio || conversation.video_aspect_ratio) as "16:9" | "9:16") || "16:9",
            generateAudio: audioEnabled,
            negativePrompt: videoSettings?.negativePrompt || conversation.video_negative_prompt || undefined,
            seed: generatedSeed,
            personGeneration: "allow_all",
          };

          // Debug: log final config
          console.log("[Video API] Final generateAudio value:", videoConfig.generateAudio);

          // Input del video (usa videoInputs si está disponible, fallback a campos directos)
          // Get reference images - could be from referenceImages or videoInputs.referenceImages
          const refImages = referenceImages || videoInputs?.referenceImages;

          const videoInput: VideoInput = {
            prompt: content,
            firstFrameImage: videoInputs?.firstFrame || firstFrameImage || undefined,
            lastFrameImage: videoInputs?.lastFrame || lastFrameImage || undefined,
            referenceImages: refImages,
          };

          const backendLabel = effectiveBackend === 'vertex' ? 'Vertex AI' : effectiveBackend === 'gemini' ? 'Gemini API' : (process.env.GOOGLE_GENAI_USE_VERTEXAI === "true" ? "Vertex AI" : "Gemini API");
          console.log(`\n========== [VIDEO GENERATION REQUEST] (${backendLabel}) ==========`);
          console.log("Model:", effectiveModelId);
          console.log("Quality tier:", effectiveQualityTier);
          console.log("Seed:", generatedSeed, videoSettings?.seed ? "(user-provided)" : "(auto-generated)");
          console.log("Config:", JSON.stringify(videoConfig, null, 2));
          console.log("Input prompt:", content);
          console.log("Has first frame:", !!videoInput.firstFrameImage);
          console.log("Has last frame:", !!videoInput.lastFrameImage);
          console.log("Reference images count:", refImages?.length || 0);
          if (refImages && refImages.length > 0) {
            console.log("Reference images types:", refImages.map(r => r.type).join(", "));
          }
          console.log("================================================\n");

          // Callback de progreso
          const onProgress = (progress: VideoGenerationProgress) => {
            sendEvent({
              type: "progress",
              status: progress.status,
              message: progress.message,
              progress: progress.progress,
            });
          };

          // Generar video using effective model
          const generatedVideo = await generateVideo(
            effectiveModelId,
            videoInput,
            videoConfig,
            onProgress,
            labels,
            effectiveBackend
          );

          // Guardar video en S3
          sendEvent({
            type: "progress",
            status: "processing",
            message: "Guardando video...",
            progress: 95,
          });

          const videoFileName = generateVideoFileName(id, "mp4");
          const uploadResult = await uploadVideoToS3(
            generatedVideo.data,
            videoFileName,
            generatedVideo.mimeType
          );

          // Calculate estimated cost for video generation using effective model cost
          const estimatedCost = calculateEstimatedCost(
            {
              cost_input_per_million: 0,
              cost_output_per_million: 0,
              cost_image_1k: 0,
              cost_image_2k: 0,
              cost_image_4k: 0,
              cost_video_per_second: effectiveCostVideoPerSecond,
            },
            {
              tokensInput: 0,
              tokensOutput: 0,
              imageGenerated: false,
              imageSize: null,
              videoSeconds: generatedVideo.duration,
            }
          );

          // Guardar respuesta del modelo en la base de datos (con quality_tier y seed)
          const [modelResult] = await pool.execute<ResultSetHeader>(
            `INSERT INTO messages (conversation_id, role, content_type, quality_tier, generation_seed, content, video_url, video_mime_type, video_file_size, video_duration, video_has_audio, video_aspect_ratio, estimated_cost)
             VALUES (?, 'model', 'video', ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              effectiveQualityTier,
              generatedVideo.seed,
              uploadResult.url,
              generatedVideo.mimeType,
              uploadResult.fileSize,
              generatedVideo.duration,
              generatedVideo.hasAudio ? 1 : 0,
              videoConfig.aspectRatio,
              estimatedCost,
            ]
          );

          const modelMessageId = modelResult.insertId;

          // Actualizar costo total en la conversación
          await pool.execute(
            `UPDATE conversations
             SET total_estimated_cost = total_estimated_cost + ?
             WHERE id = ?`,
            [estimatedCost, id]
          );

          // Enviar evento de video generado
          sendEvent({
            type: "video",
            videoUrl: uploadResult.url,
            mimeType: generatedVideo.mimeType,
            duration: generatedVideo.duration,
            hasAudio: generatedVideo.hasAudio,
            aspectRatio: videoConfig.aspectRatio,
            fileSize: uploadResult.fileSize,
            estimatedCost,
            seed: generatedSeed,
          });

          // Enviar evento de finalización
          sendEvent({
            type: "complete",
            id: modelMessageId,
            videoUrl: uploadResult.url,
            duration: generatedVideo.duration,
            hasAudio: generatedVideo.hasAudio,
            aspectRatio: videoConfig.aspectRatio,
            estimatedCost,
            seed: generatedSeed,
          });

          controllerClosed = true;
          controller.close();

          // Generar título después de completar exitosamente (fire-and-forget)
          // Se genera aquí para no competir por cuota API con la llamada principal
          if (needsTitle) {
            generateConversationTitle(content, labels)
              .then(async (title) => {
                await pool.execute(
                  "UPDATE conversations SET title = ? WHERE id = ?",
                  [title, id]
                );
                console.log("[Video] Generated title:", title);
              })
              .catch((err) => {
                console.error("[Video] Error generating title:", err);
              });
          }

        } catch (error) {
          console.error("[Video] Error generating video:", error);
          const errorMessage = error instanceof Error ? error.message : "Error desconocido";

          // Guardar mensaje de error (con content_type 'error' para excluirlo del historial)
          // También marcar el mensaje del usuario con ignore_in_context para no enviarlo como contexto
          const [modelResult] = await pool.execute<ResultSetHeader>(
            `INSERT INTO messages (conversation_id, role, content_type, content)
             VALUES (?, 'model', 'error', ?)`,
            [id, `Error generando video: ${errorMessage}`]
          );
          await pool.execute(
            `UPDATE messages SET ignore_in_context = 1 WHERE id = ?`,
            [userMessageId]
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
    console.error("[Video] Error en endpoint de video:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
