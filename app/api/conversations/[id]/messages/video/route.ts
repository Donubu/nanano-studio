import { NextRequest } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { generateVideo, isVideoConfigured, VideoGenerationConfig, VideoInput, VideoGenerationProgress } from "@/lib/google-ai-video";
import { generateXaiVideo, isXaiVideoConfigured, XaiVideoConfig, validateXaiVideoConfig } from "@/lib/xai-video";
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

    // Verificar que el modelo soporta video
    if (!conversation.supports_video_generation) {
      return new Response(JSON.stringify({ error: "El modelo seleccionado no soporta generación de video" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Crear el stream de respuesta SSE inmediatamente para enviar headers rápido
    const encoder = new TextEncoder();
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

        const sendEvent = (data: Record<string, unknown>) => {
          if (!controllerClosed) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
            );
          }
        };

        try {
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

          // Determine if this is an xAI model
          const isXaiProvider = effectiveBackend === 'xai';

          // Validate that the appropriate video API is configured
          if (isXaiProvider) {
            if (!isXaiVideoConfigured()) {
              sendEvent({ type: "error", message: "API de xAI Video no configurada (falta XAI_API_KEY)" });
              clearInterval(heartbeat);
              controllerClosed = true;
              controller.close();
              return;
            }
          } else {
            if (!isVideoConfigured()) {
              sendEvent({ type: "error", message: "API de Google AI Video no configurada" });
              clearInterval(heartbeat);
              controllerClosed = true;
              controller.close();
              return;
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

          // Enviar el ID del mensaje del usuario
          sendEvent({ type: "user_message", id: userMessageId });

          // Callback de progreso
          const onProgress = (progress: VideoGenerationProgress) => {
            sendEvent({
              type: "progress",
              status: progress.status,
              message: progress.message,
              progress: progress.progress,
            });
          };

          let generatedVideo;
          let generatedSeed: number;

          if (isXaiProvider) {
            // ===== xAI Grok Imagine Video =====
            const xaiConfig: XaiVideoConfig = {
              duration: videoSettings?.duration || conversation.video_duration || 8,
              aspectRatio: (videoSettings?.aspectRatio || conversation.video_aspect_ratio || "16:9") as XaiVideoConfig["aspectRatio"],
              resolution: (videoSettings?.resolution || conversation.video_resolution || "720p") as XaiVideoConfig["resolution"],
            };

            // Validate xAI-specific config
            const validationError = validateXaiVideoConfig(xaiConfig);
            if (validationError) {
              sendEvent({ type: "error", message: validationError });
              clearInterval(heartbeat);
              controllerClosed = true;
              controller.close();
              return;
            }

            // xAI accepts both public URLs and base64 data URIs for image_url
            const imageUrl = videoInputs?.firstFrame || firstFrameImage || undefined;

            const backendLabel = 'xAI';
            console.log(`\n========== [VIDEO GENERATION REQUEST] (${backendLabel}) ==========`);
            console.log("Model:", effectiveModelId);
            console.log("Quality tier:", effectiveQualityTier);
            console.log("Config:", JSON.stringify(xaiConfig, null, 2));
            console.log("Input prompt:", content);
            console.log("Has image URL:", !!imageUrl);
            if (imageUrl) console.log("Image URL type:", imageUrl.startsWith("http") ? "URL" : "base64", "length:", imageUrl.length);
            console.log("================================================\n");

            generatedVideo = await generateXaiVideo(
              effectiveModelId,
              content,
              xaiConfig,
              onProgress,
              imageUrl,
            );
            generatedSeed = 0; // xAI does not support seeds

          } else {
            // ===== Google AI (VEO) =====
            const audioEnabled = videoSettings?.audioEnabled !== undefined
              ? videoSettings.audioEnabled
              : (conversation.video_audio_enabled ?? true);

            generatedSeed = videoSettings?.seed ?? Math.floor(Math.random() * 4294967295);

            const videoConfig: VideoGenerationConfig = {
              durationSeconds: ((videoSettings?.duration || conversation.video_duration) as 4 | 6 | 8) || 8,
              resolution: ((videoSettings?.resolution || conversation.video_resolution) as "720p" | "1080p") || "720p",
              aspectRatio: ((videoSettings?.aspectRatio || conversation.video_aspect_ratio) as "16:9" | "9:16") || "16:9",
              generateAudio: audioEnabled,
              negativePrompt: videoSettings?.negativePrompt || conversation.video_negative_prompt || undefined,
              seed: generatedSeed,
              personGeneration: "allow_all",
            };

            console.log("[Video API] Final generateAudio value:", videoConfig.generateAudio);

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

            generatedVideo = await generateVideo(
              effectiveModelId,
              videoInput,
              videoConfig,
              onProgress,
              labels,
              effectiveBackend
            );
          }

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

          // Resolve aspect ratio from settings (works for both providers)
          const effectiveAspectRatio = videoSettings?.aspectRatio || conversation.video_aspect_ratio || "16:9";

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
              effectiveAspectRatio,
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
            aspectRatio: effectiveAspectRatio,
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
            aspectRatio: effectiveAspectRatio,
            estimatedCost,
            seed: generatedSeed,
          });

          clearInterval(heartbeat);
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
          try {
            const [modelResult] = await pool.execute<ResultSetHeader>(
              `INSERT INTO messages (conversation_id, role, content_type, content)
               VALUES (?, 'model', 'error', ?)`,
              [id, `Error generando video: ${errorMessage}`]
            );

            sendEvent({
              type: "error",
              message: errorMessage,
              id: modelResult.insertId,
            });
          } catch (dbError) {
            console.error("[Video] Error saving error message:", dbError);
            sendEvent({
              type: "error",
              message: errorMessage,
            });
          }

          clearInterval(heartbeat);
          controllerClosed = true;
          controller.close();
        }
      },
      cancel() {
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
