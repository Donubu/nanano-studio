import { NextRequest } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { generateVideo, isVideoConfigured, VideoGenerationConfig, VideoInput, VideoGenerationProgress } from "@/lib/google-ai-video";
import { uploadVideoToS3, generateVideoFileName, isS3Configured } from "@/lib/s3";
import { generateConversationTitle, Labels } from "@/lib/google-ai";

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number | null;
  model_id: number;
  model_model_id: string;
  system_instruction: string | null;
  video_duration: number;
  video_resolution: string;
  video_aspect_ratio: string;
  video_audio_enabled: boolean;
  video_negative_prompt: string | null;
  supports_video_generation: boolean;
  project_name: string | null;
}

interface UserLimitRow extends RowDataPacket {
  max_monthly_generations: number;
  current_month_count: number;
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
      };
      videoInputs?: {
        firstFrame?: string;
        lastFrame?: string;
        referenceImages?: ReferenceImageWithType[];
      };
    };

    // Debug: log received settings
    console.log("[Video API] Received videoSettings:", videoSettings);
    console.log("[Video API] audioEnabled from request:", videoSettings?.audioEnabled);

    if (!content || content.trim() === "") {
      return new Response(JSON.stringify({ error: "El prompt del video es requerido" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Obtener conversación con configuración de video
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT c.*, m.model_id as model_model_id, m.supports_video_generation, p.title as project_name
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

    // Verificar que el modelo soporta video
    if (!conversation.supports_video_generation) {
      return new Response(JSON.stringify({ error: "El modelo seleccionado no soporta generación de video" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verificar límite de generaciones mensuales
    if (conversation.project_id && session.user.role !== "admin") {
      const [limitRows] = await pool.execute<UserLimitRow[]>(`
        SELECT
          pu.max_monthly_generations,
          (
            SELECT COUNT(*)
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            WHERE c.project_id = ?
              AND c.user_id = ?
              AND m.role = 'user'
              AND m.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
          ) as current_month_count
        FROM project_users pu
        WHERE pu.project_id = ? AND pu.user_id = ?
      `, [conversation.project_id, session.user.id, conversation.project_id, session.user.id]);

      if (limitRows.length > 0) {
        const { max_monthly_generations, current_month_count } = limitRows[0];
        if (max_monthly_generations > 0 && current_month_count >= max_monthly_generations) {
          return new Response(JSON.stringify({
            error: "Has alcanzado el límite de mensajes mensuales para este proyecto",
            limit: max_monthly_generations,
            used: current_month_count
          }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
    }

    // Guardar mensaje del usuario
    const [userMessageResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO messages (conversation_id, role, content_type, content)
       VALUES (?, 'user', 'text', ?)`,
      [id, content]
    );
    const userMessageId = userMessageResult.insertId;

    // Verificar si es el primer mensaje
    const [messageCount] = await pool.execute<MessageRow[]>(
      `SELECT id FROM messages WHERE conversation_id = ? LIMIT 2`,
      [id]
    );
    const isFirstMessage = messageCount.length === 1;

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

    const stream = new ReadableStream({
      async start(controller) {
        let controllerClosed = false;

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

          // Generar título si es el primer mensaje (async)
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
                console.error("[Video] Error generating title:", err);
              });
          }

          // Configuración de generación de video (usa request settings, fallback a conversation settings)
          const audioEnabled = videoSettings?.audioEnabled !== undefined
            ? videoSettings.audioEnabled
            : (conversation.video_audio_enabled ?? true);

          const videoConfig: VideoGenerationConfig = {
            durationSeconds: ((videoSettings?.duration || conversation.video_duration) as 4 | 6 | 8) || 8,
            resolution: ((videoSettings?.resolution || conversation.video_resolution) as "720p" | "1080p") || "720p",
            aspectRatio: ((videoSettings?.aspectRatio || conversation.video_aspect_ratio) as "16:9" | "9:16") || "16:9",
            generateAudio: audioEnabled,
            negativePrompt: videoSettings?.negativePrompt || conversation.video_negative_prompt || undefined,
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

          console.log("\n========== [VIDEO GENERATION REQUEST] ==========");
          console.log("Model:", conversation.model_model_id);
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

          // Generar video
          const generatedVideo = await generateVideo(
            conversation.model_model_id,
            videoInput,
            videoConfig,
            onProgress,
            labels
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

          // Guardar respuesta del modelo en la base de datos
          const [modelResult] = await pool.execute<ResultSetHeader>(
            `INSERT INTO messages (conversation_id, role, content_type, content, video_url, video_mime_type, video_file_size, video_duration, video_has_audio, video_aspect_ratio)
             VALUES (?, 'model', 'video', '', ?, ?, ?, ?, ?, ?)`,
            [
              id,
              uploadResult.url,
              generatedVideo.mimeType,
              uploadResult.fileSize,
              generatedVideo.duration,
              generatedVideo.hasAudio ? 1 : 0,
              videoConfig.aspectRatio,
            ]
          );

          const modelMessageId = modelResult.insertId;

          // Enviar evento de video generado
          sendEvent({
            type: "video",
            videoUrl: uploadResult.url,
            mimeType: generatedVideo.mimeType,
            duration: generatedVideo.duration,
            hasAudio: generatedVideo.hasAudio,
            aspectRatio: videoConfig.aspectRatio,
            fileSize: uploadResult.fileSize,
          });

          // Enviar evento de finalización
          sendEvent({
            type: "complete",
            id: modelMessageId,
            videoUrl: uploadResult.url,
            duration: generatedVideo.duration,
            hasAudio: generatedVideo.hasAudio,
            aspectRatio: videoConfig.aspectRatio,
          });

          controllerClosed = true;
          controller.close();

        } catch (error) {
          console.error("[Video] Error generating video:", error);
          const errorMessage = error instanceof Error ? error.message : "Error desconocido";

          // Guardar mensaje de error
          const [modelResult] = await pool.execute<ResultSetHeader>(
            `INSERT INTO messages (conversation_id, role, content_type, content)
             VALUES (?, 'model', 'text', ?)`,
            [id, `Error generando video: ${errorMessage}`]
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
