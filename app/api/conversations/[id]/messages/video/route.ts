import { NextRequest } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { generateVideo, isVideoConfigured, VideoGenerationConfig, VideoInput, VideoGenerationProgress } from "@/lib/google-ai-video";
import { generateXaiVideo, isXaiVideoConfigured, XaiVideoConfig, validateXaiVideoConfig } from "@/lib/xai-video";
import { generateKlingVideo, isKlingConfigured, KlingVideoConfig, validateKlingVideoConfig, KlingImageInput } from "@/lib/kling-video";
import { generateOpenRouterVideo, isOpenRouterConfigured, OpenRouterVideoConfig, validateOpenRouterVideoConfig, OpenRouterImageInputs } from "@/lib/openrouter-video";
import { uploadVideoToS3, generateVideoFileName, isS3Configured, uploadToS3, generateFileName } from "@/lib/s3";
import { generateConversationTitle, Labels } from "@/lib/google-ai";
import { calculateEstimatedCost } from "@/lib/cost-calculator";
import { acquireSlot, releaseSlot, waitForSlot } from "@/lib/veo-semaphore";
import { isRedisConfigured } from "@/lib/redis";
import { checkClientCreditQuota, CREDIT_ERROR_CODE } from "@/lib/client-credits";

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
  client_name: string | null;
  client_id: number | null;
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

    // Inline asset type for Kling Omni <<<>>> references
    type InlineAsset = {
      assetId: string;
      dataUrl: string;
      mimeType: string;
      type: "image" | "video";
    };

    const {
      content,
      firstFrameImage,
      lastFrameImage,
      referenceImages,
      videoSettings,
      videoInputs,
      quality_tier,
      selected_model_id,
      inlineAssets,
      voiceBindings,
      skip_user_message = false,
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
      selected_model_id?: number;
      inlineAssets?: InlineAsset[];
      voiceBindings?: Record<string, string>;
      skip_user_message?: boolean;
    };

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
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT c.*, m.model_id as model_model_id, m.supports_video_generation, m.api_backend as model_api_backend, p.title as project_name, p.client_id as client_id, cl.name as client_name,
              m.cost_video_per_second
       FROM conversations c
       JOIN models m ON c.model_id = m.id
       LEFT JOIN projects p ON c.project_id = p.id
       LEFT JOIN clients cl ON p.client_id = cl.id
       WHERE c.id = ? AND c.deleted_at IS NULL`,
      [id]
    );

    if (conversations.length === 0) {
      return new Response(JSON.stringify({ error: "Conversación no encontrada" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const conversation = conversations[0];

    // Verificar que el modelo soporta video (skip for "full" mode which uses image model as default)
    if (!conversation.supports_video_generation && conversation.generation_type !== "full" && conversation.generation_type !== "canvas") {
      return new Response(JSON.stringify({ error: "El modelo seleccionado no soporta generación de video" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Cuota mensual del cliente. Admins y usuarios exentos pasan directo.
    if (conversation.client_id) {
      const quota = await checkClientCreditQuota({
        clientId: conversation.client_id,
        userId: Number(session.user.id),
        isAdmin: session.user.role === "admin",
        type: "video",
      });
      if (!quota.ok) {
        return new Response(
          JSON.stringify({
            error: quota.message,
            code: CREDIT_ERROR_CODE,
            limit: quota.limit,
            used: quota.used,
            period: quota.period,
            generation_type: "video",
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
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

        let placeholderId: number | undefined;

        try {
          // Get the correct model from project_generation_config based on quality_tier
          let effectiveModelId = conversation.model_model_id;
          let effectiveModelDbId = conversation.model_id;
          let effectiveBackend = conversation.model_api_backend || undefined;
          let effectiveCostVideoPerSecond = Number(conversation.cost_video_per_second) || 0;
          // For "full" mode, use "video" config since full doesn't have its own model rows
          const generationType = (conversation.generation_type === "full" || conversation.generation_type === "canvas") ? "video" : (conversation.generation_type || "video");

          if (conversation.project_id) {
            const [projectModels] = await pool.execute<RowDataPacket[]>(`
              SELECT
                pgm.model_id,
                pgm.is_default,
                m.model_id as model_model_id,
                m.api_backend as model_api_backend,
                m.cost_video_per_second
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
              effectiveCostVideoPerSecond = Number(chosen.cost_video_per_second) || 0;
              console.log(`[Video] Using model from config: ${effectiveModelId} (${effectiveBackend || 'default'})`);
            }
          }

          // Determine provider
          const isXaiProvider = effectiveBackend === 'xai';
          const isKlingProvider = effectiveBackend === 'kling' || effectiveModelId.includes('kling-v3-omni') || effectiveModelId === 'kling-v2-6';
          const isOpenRouterProvider = effectiveBackend === 'openrouter';

          // Per-user gate for OpenRouter (paid out-of-pocket). Defense-in-depth:
          // generation-config GET already hides these models for non-flagged
          // users, but a hand-crafted request could still target one.
          if (isOpenRouterProvider && session.user.role !== "admin") {
            const [userRows] = await pool.execute<RowDataPacket[]>(
              "SELECT can_use_openrouter FROM users WHERE id = ?",
              [session.user.id]
            );
            const allowed = userRows.length > 0 && Boolean(userRows[0].can_use_openrouter);
            if (!allowed) {
              sendEvent({ type: "error", message: "Tu usuario no tiene acceso a modelos OpenRouter. Solicítalo al administrador." });
              clearInterval(heartbeat);
              controllerClosed = true;
              controller.close();
              return;
            }
          }

          // Validate that the appropriate video API is configured
          if (isKlingProvider) {
            if (!isKlingConfigured()) {
              sendEvent({ type: "error", message: "API de Kling no configurada (falta KLING_ACCESS_KEY / KLING_SECRET_KEY)" });
              clearInterval(heartbeat);
              controllerClosed = true;
              controller.close();
              return;
            }
          } else if (isXaiProvider) {
            if (!isXaiVideoConfigured()) {
              sendEvent({ type: "error", message: "API de xAI Video no configurada (falta XAI_API_KEY)" });
              clearInterval(heartbeat);
              controllerClosed = true;
              controller.close();
              return;
            }
          } else if (isOpenRouterProvider) {
            if (!isOpenRouterConfigured()) {
              sendEvent({ type: "error", message: "API de OpenRouter no configurada (falta OPENROUTER_API_KEY)" });
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

          // Guardar mensaje del usuario (con quality_tier) - skip for parallel variation requests
          let userMessageId: number | null = null;
          if (!skip_user_message) {
            const [userMessageResult] = await pool.execute<ResultSetHeader>(
              `INSERT INTO messages (conversation_id, user_id, role, content_type, quality_tier, content)
               VALUES (?, ?, 'user', 'text', ?, ?)`,
              [id, session.user.id, effectiveQualityTier, content]
            );
            userMessageId = userMessageResult.insertId;

            // Save reference images/frames/assets to message_images for reuse tracking
            try {
              const { uploadToS3 } = await import("@/lib/s3");
              let sortOrder = 0;

              const saveRefImage = async (base64OrUrl: string, mimeType: string = "image/png") => {
                let imgUrl = base64OrUrl;
                if (base64OrUrl.startsWith("data:")) {
                  const base64Data = base64OrUrl.split(",")[1];
                  const ext = mimeType.split("/")[1] || "png";
                  const result = await uploadToS3(
                    Buffer.from(base64Data, "base64"),
                    `conversations/${id}/ref_${userMessageId}_${sortOrder}.${ext}`,
                    mimeType
                  );
                  imgUrl = result.url;
                }
                const fileSize = base64OrUrl.startsWith("data:") ? Buffer.from(base64OrUrl.split(",")[1], "base64").length : null;
                await pool.execute(
                  `INSERT INTO message_images (message_id, image_url, mime_type, file_size, sort_order) VALUES (?, ?, ?, ?, ?)`,
                  [userMessageId, imgUrl, mimeType, fileSize, sortOrder++]
                );
              };

              // Frames
              const firstFrame = videoInputs?.firstFrame || firstFrameImage;
              const lastFrame = videoInputs?.lastFrame || lastFrameImage;
              if (firstFrame) await saveRefImage(firstFrame);
              if (lastFrame) await saveRefImage(lastFrame);

              // Reference images (VEO ingredients)
              const refImgs = referenceImages || videoInputs?.referenceImages;
              if (refImgs) {
                for (const ref of refImgs) {
                  if (ref.image) await saveRefImage(ref.image);
                }
              }

              // Inline assets (Kling)
              if (inlineAssets) {
                for (const asset of inlineAssets) {
                  if (asset.dataUrl) {
                    await saveRefImage(asset.dataUrl, asset.mimeType || "image/png");
                  }
                }
              }
            } catch (err) {
              console.error("Error guardando referencias en message_images:", err);
            }
          }

          // Verificar si necesita generar titulo (aún tiene el titulo por defecto)
          const needsTitle = !skip_user_message && (conversation.title === "Nueva conversación" || !conversation.title);

          // Actualizar timestamp de la conversación
          if (!skip_user_message) {
            await pool.execute(
              "UPDATE conversations SET updated_at = NOW() WHERE id = ?",
              [id]
            );
          }

          // Preparar labels para tracking
          const userIdentifier = session.user.email?.split("@")[0] || "unknown";
          const labels: Labels = {
            project_name: conversation.client_name ? `${conversation.client_name} > ${conversation.project_name}` : conversation.project_name || "sin_proyecto",
            user_name: userIdentifier,
          };

          // Enviar el ID del mensaje del usuario
          if (!skip_user_message && userMessageId) {
            sendEvent({ type: "user_message", id: userMessageId });
          }

          // Callback de progreso
          const onProgress = (progress: VideoGenerationProgress) => {
            sendEvent({
              type: "progress",
              status: progress.status,
              message: progress.message,
              progress: progress.progress,
            });
          };

          // Create placeholder message before generation starts
          const [placeholderResult] = await pool.execute<ResultSetHeader>(
            `INSERT INTO messages (conversation_id, user_id, role, status, content_type, quality_tier, model_id, content, video_aspect_ratio, video_duration, video_has_audio)
             VALUES (?, ?, 'model', 'generating', 'video', ?, ?, '', ?, ?, ?)`,
            [id, session.user.id, effectiveQualityTier, effectiveModelDbId,
             videoSettings?.aspectRatio || conversation.video_aspect_ratio || "16:9",
             videoSettings?.duration || conversation.video_duration || 8,
             (videoSettings?.audioEnabled !== undefined ? videoSettings.audioEnabled : (conversation.video_audio_enabled ?? true)) ? 1 : 0]
          );
          placeholderId = placeholderResult.insertId;
          sendEvent({ type: "placeholders", ids: [placeholderId] });

          let generatedVideo;
          let generatedSeed: number;

          if (isKlingProvider) {
            // ===== Kling Video (v3 Omni + v2.6) =====
            const isKlingV26 = effectiveModelId === 'kling-v2-6';
            const klingMode = (videoSettings?.resolution === "1080p" ? "pro" : "std") as KlingVideoConfig["mode"];
            const klingConfig: KlingVideoConfig = {
              duration: videoSettings?.duration || conversation.video_duration || 5,
              aspectRatio: (videoSettings?.aspectRatio || conversation.video_aspect_ratio || "16:9") as KlingVideoConfig["aspectRatio"],
              mode: klingMode,
              negativePrompt: videoSettings?.negativePrompt || conversation.video_negative_prompt || undefined,
              generateAudio: videoSettings?.audioEnabled !== undefined
                ? videoSettings.audioEnabled
                : (conversation.video_audio_enabled ?? false),
            };

            // Validate Kling-specific config (version-aware)
            const validationError = validateKlingVideoConfig(klingConfig, effectiveModelId);
            if (validationError) {
              sendEvent({ type: "error", message: validationError });
              clearInterval(heartbeat);
              controllerClosed = true;
              controller.close();
              return;
            }

            // Upload per-asset voice bindings to S3 if provided (v3 omni only)
            const voiceBindingUrls: Record<string, string> = {};
            if (!isKlingV26 && voiceBindings && Object.keys(voiceBindings).length > 0) {
              for (const [assetId, audioData] of Object.entries(voiceBindings)) {
                if (audioData.startsWith("http")) {
                  voiceBindingUrls[assetId] = audioData;
                  continue;
                }
                const base64Match = audioData.match(/^data:([^;]+);base64,(.+)$/);
                if (!base64Match) continue;
                const [, mimeType, base64Data] = base64Match;
                const ext = mimeType.split("/")[1] || "mp3";
                const fileName = generateFileName(id, ext);
                const buffer = Buffer.from(base64Data, "base64");
                const result = await uploadToS3(buffer, fileName, mimeType, "voice");
                voiceBindingUrls[assetId] = result.url;
              }
              if (Object.keys(voiceBindingUrls).length > 0) {
                klingConfig.voiceBindings = voiceBindingUrls;
                console.log(`[Kling] ${Object.keys(voiceBindingUrls).length} voice binding(s) uploaded`);
              }
            }

            // Kling requires public URLs for images - upload base64 to S3 if needed
            const klingImages: KlingImageInput[] = [];
            let klingVideoUrl: string | undefined;
            const refImages = referenceImages || videoInputs?.referenceImages;
            const firstFrame = videoInputs?.firstFrame || firstFrameImage;
            const lastFrame = videoInputs?.lastFrame || lastFrameImage;

            const uploadBase64IfNeeded = async (data: string): Promise<string> => {
              if (data.startsWith("http")) return data;
              // Extract base64 data and upload to S3
              const base64Match = data.match(/^data:([^;]+);base64,(.+)$/);
              if (!base64Match) return data;
              const [, mimeType, base64Data] = base64Match;
              const ext = mimeType.split("/")[1] || "png";
              const fileName = generateFileName(id, ext);
              const buffer = Buffer.from(base64Data, "base64");
              const result = await uploadToS3(buffer, fileName, mimeType, "reference");
              return result.url;
            };

            // Handle inline assets (from @ mention system) — v3 omni only
            if (!isKlingV26 && inlineAssets && inlineAssets.length > 0) {
              // Validate Kling asset limits: max 1 video, max 7 images without video, max 4 images with video
              const videoAssets = inlineAssets.filter(a => a.type === "video");
              const imageAssets = inlineAssets.filter(a => a.type === "image");
              if (videoAssets.length > 1) {
                sendEvent({ type: "error", message: "Kling soporta maximo 1 video como input" });
                clearInterval(heartbeat);
                controllerClosed = true;
                controller.close();
                return;
              }
              const maxImages = videoAssets.length > 0 ? 4 : 7;
              if (imageAssets.length > maxImages) {
                sendEvent({ type: "error", message: `Kling soporta maximo ${maxImages} imagenes${videoAssets.length > 0 ? " cuando se incluye un video" : ""}` });
                clearInterval(heartbeat);
                controllerClosed = true;
                controller.close();
                return;
              }
              // Kling: audio not supported with video input
              if (videoAssets.length > 0 && klingConfig.generateAudio) {
                console.log("[Kling] Forcing audio off - video input present");
                klingConfig.generateAudio = false;
              }

              sendEvent({
                type: "progress",
                status: "processing",
                message: `Subiendo ${inlineAssets.length} asset(s)...`,
                progress: 5,
              });
              for (const asset of inlineAssets) {
                const url = await uploadBase64IfNeeded(asset.dataUrl);
                if (asset.type === "video") {
                  // Video assets go to video_url (Kling Omni supports one video input)
                  klingVideoUrl = url;
                } else {
                  klingImages.push({ url });
                }
              }
              console.log(`[Kling] Uploaded ${inlineAssets.length} inline assets for <<<>>> references`);
            }

            if (firstFrame) {
              klingImages.push({ url: await uploadBase64IfNeeded(firstFrame), type: "first_frame" });
            }
            if (lastFrame) {
              klingImages.push({ url: await uploadBase64IfNeeded(lastFrame), type: "end_frame" });
            }
            if (refImages) {
              for (const ref of refImages) {
                klingImages.push({ url: await uploadBase64IfNeeded(ref.image) });
              }
            }

            console.log(`\n========== [VIDEO GENERATION REQUEST] (Kling) ==========`);
            console.log("Model:", effectiveModelId);
            console.log("Mode:", klingConfig.mode, "Duration:", klingConfig.duration);
            console.log("Audio:", klingConfig.generateAudio);
            console.log("Images:", klingImages.map(i => i.type || "reference").join(", ") || "none");
            console.log("Video URL:", klingVideoUrl ? "(set)" : "none");
            console.log("Inline assets:", inlineAssets?.length || 0);
            console.log("Input prompt:", content);
            console.log("================================================\n");

            generatedVideo = await generateKlingVideo(
              effectiveModelId,
              content,
              klingConfig,
              onProgress,
              klingImages.length > 0 ? klingImages : undefined,
              klingVideoUrl,
            );
            generatedSeed = 0; // Kling does not support seeds

          } else if (isXaiProvider) {
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

          } else if (isOpenRouterProvider) {
            // ===== OpenRouter (Seedance 2.0 / 2.0-fast) =====
            generatedSeed = videoSettings?.seed ?? Math.floor(Math.random() * 4294967295);

            const orConfig: OpenRouterVideoConfig = {
              duration: videoSettings?.duration || conversation.video_duration || 8,
              aspectRatio: (videoSettings?.aspectRatio || conversation.video_aspect_ratio || "16:9") as OpenRouterVideoConfig["aspectRatio"],
              resolution: (videoSettings?.resolution || conversation.video_resolution || "720p") as OpenRouterVideoConfig["resolution"],
              generateAudio: videoSettings?.audioEnabled !== undefined
                ? videoSettings.audioEnabled
                : (conversation.video_audio_enabled ?? false),
              seed: generatedSeed,
              negativePrompt: videoSettings?.negativePrompt || conversation.video_negative_prompt || undefined,
            };

            const validationError = validateOpenRouterVideoConfig(orConfig, effectiveModelId);
            if (validationError) {
              sendEvent({ type: "error", message: validationError });
              clearInterval(heartbeat);
              controllerClosed = true;
              controller.close();
              return;
            }

            // OpenRouter requires public URLs for image inputs — upload base64 to S3 first.
            const uploadIfBase64 = async (data: string): Promise<string> => {
              if (data.startsWith("http")) return data;
              const base64Match = data.match(/^data:([^;]+);base64,(.+)$/);
              if (!base64Match) return data;
              const [, mimeType, base64Data] = base64Match;
              const ext = mimeType.split("/")[1] || "png";
              const fileName = generateFileName(id, ext);
              const buffer = Buffer.from(base64Data, "base64");
              const result = await uploadToS3(buffer, fileName, mimeType, "reference");
              return result.url;
            };

            const orImageInputs: OpenRouterImageInputs = {};
            const orFirstFrame = videoInputs?.firstFrame || firstFrameImage;
            const orLastFrame = videoInputs?.lastFrame || lastFrameImage;
            const orRefImages = referenceImages || videoInputs?.referenceImages;
            if (orFirstFrame) orImageInputs.firstFrame = await uploadIfBase64(orFirstFrame);
            if (orLastFrame) orImageInputs.lastFrame = await uploadIfBase64(orLastFrame);
            if (orRefImages && orRefImages.length > 0) {
              orImageInputs.referenceImages = await Promise.all(
                orRefImages.map(async (ref) => ({ image: await uploadIfBase64(ref.image), type: ref.type }))
              );
            }

            console.log(`\n========== [VIDEO GENERATION REQUEST] (OpenRouter) ==========`);
            console.log("Model:", effectiveModelId);
            console.log("Quality tier:", effectiveQualityTier);
            console.log("Config:", JSON.stringify(orConfig, null, 2));
            console.log("Input prompt:", content);
            console.log("Has first frame:", !!orImageInputs.firstFrame);
            console.log("Has last frame:", !!orImageInputs.lastFrame);
            console.log("Reference images count:", orImageInputs.referenceImages?.length || 0);
            console.log("================================================\n");

            generatedVideo = await generateOpenRouterVideo(
              effectiveModelId,
              content,
              orConfig,
              onProgress,
              orImageInputs,
            );

          } else {
            // ===== Google AI (VEO) =====
            const audioEnabled = videoSettings?.audioEnabled !== undefined
              ? videoSettings.audioEnabled
              : (conversation.video_audio_enabled ?? true);

            generatedSeed = videoSettings?.seed ?? Math.floor(Math.random() * 4294967295);

            const videoConfig: VideoGenerationConfig = {
              durationSeconds: ((videoSettings?.duration || conversation.video_duration) as 4 | 6 | 8) || 8,
              resolution: ((videoSettings?.resolution || conversation.video_resolution) as "720p" | "1080p" | "4K") || "720p",
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

            // Acquire VEO semaphore slot (rate limiting across all users)
            let veoSlotId: string | null = null;
            let veoPool: "primary" | "overflow" = "primary";
            if (isRedisConfigured()) {
              const slot = await acquireSlot();
              if (!slot) {
                sendEvent({
                  type: "progress",
                  status: "queued",
                  message: "Esperando slot de generación disponible...",
                  progress: 0,
                });
                const waitedSlot = await waitForSlot(5 * 60 * 1000, 5000, () => {
                  sendEvent({
                    type: "progress",
                    status: "queued",
                    message: "En cola, esperando que termine otra generación...",
                    progress: 0,
                  });
                });
                if (!waitedSlot) {
                  sendEvent({ type: "error", message: "Tiempo de espera agotado. Demasiadas generaciones en curso. Intenta en unos minutos." });
                  clearInterval(heartbeat);
                  controllerClosed = true;
                  controller.close();
                  return;
                }
                veoSlotId = waitedSlot.slotId;
                veoPool = waitedSlot.pool;
              } else {
                veoSlotId = slot.slotId;
                veoPool = slot.pool;
              }
              console.log(`[VEO] Acquired slot: ${veoSlotId} (pool: ${veoPool})`);
            }

            // Auto-release slot after 60s (RPM window) even if generation is still running
            const slotAcquiredAt = Date.now();
            let slotReleased = false;
            const autoReleaseTimer = veoSlotId ? setTimeout(async () => {
              if (!slotReleased && veoSlotId) {
                slotReleased = true;
                await releaseSlot(veoSlotId, veoPool);
                console.log(`[VEO] Auto-released slot after 60s: ${veoSlotId} (pool: ${veoPool})`);
              }
            }, 60000) : null;

            try {
              generatedVideo = await generateVideo(
                effectiveModelId,
                videoInput,
                videoConfig,
                onProgress,
                labels,
                effectiveBackend,
                veoPool
              );
            } finally {
              if (veoSlotId && !slotReleased) {
                slotReleased = true;
                if (autoReleaseTimer) clearTimeout(autoReleaseTimer);
                // If less than 60s elapsed, wait until the minute is up before releasing
                const elapsed = Date.now() - slotAcquiredAt;
                if (elapsed < 60000) {
                  setTimeout(async () => {
                    await releaseSlot(veoSlotId!, veoPool);
                    console.log(`[VEO] Released slot after RPM window: ${veoSlotId} (pool: ${veoPool})`);
                  }, 60000 - elapsed);
                } else {
                  await releaseSlot(veoSlotId, veoPool);
                  console.log(`[VEO] Released slot: ${veoSlotId} (pool: ${veoPool})`);
                }
              }
            }
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

          // Calculate estimated cost. Providers with non-linear pricing
          // (e.g. OpenRouter Seedance, where cost depends on resolution +
          // duration via a token formula) return actualCost on GeneratedVideo
          // and we trust it directly. Otherwise fall back to the standard
          // cost_video_per_second * duration formula.
          const estimatedCost = typeof generatedVideo.actualCost === "number"
            ? generatedVideo.actualCost
            : calculateEstimatedCost(
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

          // Update placeholder message with generated video data
          await pool.execute(
            `UPDATE messages SET status = 'completed', generation_seed = ?, video_url = ?, video_mime_type = ?, video_file_size = ?, video_duration = ?, video_has_audio = ?, video_aspect_ratio = ?, estimated_cost = ? WHERE id = ?`,
            [generatedVideo.seed, uploadResult.url, generatedVideo.mimeType, uploadResult.fileSize, generatedVideo.duration, generatedVideo.hasAudio ? 1 : 0, effectiveAspectRatio, estimatedCost, placeholderId]
          );
          const modelMessageId = placeholderId;

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

          // Generar título antes de cerrar el stream para notificar al frontend
          if (needsTitle) {
            try {
              const title = await generateConversationTitle(content, labels);
              await pool.execute(
                "UPDATE conversations SET title = ? WHERE id = ?",
                [title, id]
              );
              console.log("[Video] Generated title:", title);
              sendEvent({ type: "title", title });
            } catch (err) {
              console.error("[Video] Error generating title:", err);
            }
          }

          clearInterval(heartbeat);
          controllerClosed = true;
          controller.close();

        } catch (error) {
          console.error("[Video] Error generating video:", error);
          const errorMessage = error instanceof Error ? error.message : "Error desconocido";

          // Update placeholder with error or insert new error message
          try {
            const errorVideoAspectRatio = videoSettings?.aspectRatio || conversation.video_aspect_ratio || "16:9";
            const errorVideoDuration = videoSettings?.duration || conversation.video_duration || 8;
            const errorVideoHasAudio = videoSettings?.audioEnabled !== undefined ? videoSettings.audioEnabled : (conversation.video_audio_enabled !== false);
            const errorModelId = conversation.model_id;

            if (placeholderId) {
              await pool.execute(
                `UPDATE messages SET status = 'error', content = ?, model_id = ?, quality_tier = ?, video_aspect_ratio = ?, video_duration = ?, video_has_audio = ? WHERE id = ?`,
                [`Error generando video: ${errorMessage}`, errorModelId, effectiveQualityTier, errorVideoAspectRatio, errorVideoDuration, errorVideoHasAudio, placeholderId]
              );
              sendEvent({ type: "error", message: errorMessage, id: placeholderId });
            } else {
              const [modelResult] = await pool.execute<ResultSetHeader>(
                `INSERT INTO messages (conversation_id, user_id, role, content_type, content, model_id, quality_tier, video_aspect_ratio, video_duration, video_has_audio)
                 VALUES (?, ?, 'model', 'error', ?, ?, ?, ?, ?, ?)`,
                [id, session.user.id, `Error generando video: ${errorMessage}`, errorModelId, effectiveQualityTier, errorVideoAspectRatio, errorVideoDuration, errorVideoHasAudio]
              );
              sendEvent({ type: "error", message: errorMessage, id: modelResult.insertId });
            }
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
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Content-Encoding": "none",
        "X-Accel-Buffering": "no",
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
