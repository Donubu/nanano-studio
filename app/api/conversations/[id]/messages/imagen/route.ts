import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { generateImagen, isImagenConfigured, ImagenAspectRatio, ImagenResolution, Labels } from "@/lib/google-ai-imagen";
import { uploadToS3, generateFileName, isS3Configured } from "@/lib/s3";
import { generateConversationTitle } from "@/lib/google-ai";
import { calculateEstimatedCost } from "@/lib/cost-calculator";

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
  // Cost fields from model
  cost_image_1k: number;
  cost_image_2k: number;
  cost_image_4k: number;
  model_api_backend: string | null;
}

// POST - Generar imagen con Imagen 4 (SSE stream con retry feedback)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (!isImagenConfigured()) {
      return NextResponse.json({ error: "API de Imagen no configurada" }, { status: 500 });
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
      generation_type_override?: "text" | "image" | "video" | "audio";
    };

    const effectiveQualityTier: QualityTier = quality_tier === "hq" ? "hq" : "normal";

    if (!content || content.trim() === "") {
      return NextResponse.json({ error: "El prompt de la imagen es requerido" }, { status: 400 });
    }

    // Obtener conversacion con configuracion de imagen y costos del modelo
    const isAdmin = session.user.role === "admin";
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT c.*, m.model_id as model_model_id, m.supports_image_generation, m.api_backend as model_api_backend, p.title as project_name,
              m.cost_image_1k, m.cost_image_2k, m.cost_image_4k
       FROM conversations c
       JOIN models m ON c.model_id = m.id
       LEFT JOIN projects p ON c.project_id = p.id
       WHERE c.id = ? ${isAdmin ? "" : "AND c.user_id = ?"} AND c.deleted_at IS NULL`,
      isAdmin ? [id] : [id, session.user.id]
    );

    if (conversations.length === 0) {
      return NextResponse.json({ error: "Conversacion no encontrada" }, { status: 404 });
    }

    const conversation = conversations[0];

    // Crear el stream SSE inmediatamente para enviar headers rápido
    const encoder = new TextEncoder();
    let controllerClosed = false;
    let heartbeat: ReturnType<typeof setInterval>;

    const stream = new ReadableStream({
      async start(controller) {

        // Heartbeat cada 10s para mantener la conexión viva
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
          let effectiveModelDbId = conversation.model_id;
          let effectiveBackend = conversation.model_api_backend || undefined;
          let effectiveCostImage1k = Number(conversation.cost_image_1k) || 0;
          let effectiveCostImage2k = Number(conversation.cost_image_2k) || 0;
          let effectiveCostImage4k = Number(conversation.cost_image_4k) || 0;
          const generationType = generation_type_override || conversation.generation_type || "image";
          if (generation_type_override) {
            console.log(`[Imagen] Using generation_type_override: ${generation_type_override} (conversation type: ${conversation.generation_type})`);
          }

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
              console.log(`[Imagen] Using model from config: ${effectiveModelId} (${effectiveBackend || 'default'})`);
            }
          }

          // Verificar que el modelo es Imagen 4
          if (!effectiveModelId.includes("imagen-4")) {
            sendEvent({ type: "error", message: "El modelo seleccionado no es Imagen 4" });
            clearInterval(heartbeat);
            controllerClosed = true;
            controller.close();
            return;
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

          // Configuracion de generacion de imagen (usa request settings, fallback a conversation settings)
          const aspectRatio: ImagenAspectRatio = (imageSettings?.aspectRatio ||
            conversation.image_aspect_ratio || "16:9") as ImagenAspectRatio;
          const resolution: ImagenResolution = (imageSettings?.resolution ||
            conversation.image_size || "1K") as ImagenResolution;

          // Number of images to generate (clamp 1-4)
          const numberOfImages = Math.min(4, Math.max(1, imageSettings?.numberOfImages || 1));

          const backendLabel = effectiveBackend === 'vertex' ? 'Vertex AI' : effectiveBackend === 'gemini' ? 'Gemini API' : (process.env.GOOGLE_GENAI_USE_VERTEXAI === "true" ? "Vertex AI" : "Gemini API");
          console.log(`\n========== [IMAGEN 4 GENERATION REQUEST] (${backendLabel}) ==========`);
          console.log("Model:", effectiveModelId);
          console.log("Quality tier:", effectiveQualityTier);
          console.log("Aspect Ratio:", aspectRatio);
          console.log("Resolution:", resolution);
          console.log("Number of images:", numberOfImages);
          console.log("Prompt:", content);
          if (imageSettings?.negativePrompt) {
            console.log("Negative Prompt:", imageSettings.negativePrompt);
          }
          if (imageSettings?.seed) {
            console.log("User-provided Seed:", imageSettings.seed);
          }
          console.log("====================================================\n");

          // Enviar el ID del mensaje del usuario
          sendEvent({ type: "user_message", id: userMessageId });

          // Callback de retry para notificar al usuario
          const onProgress = (progress: { status: string; message: string }) => {
            // Detectar si es un mensaje de retry y enviar con formato correcto para el frontend
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

          // Generar imagen
          const generatedImages = await generateImagen(
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

          // Process each generated image
          for (let i = 0; i < generatedImages.length; i++) {
            const generatedImage = generatedImages[i];

            // Upload to S3
            const extension = generatedImage.mimeType.split("/")[1] || "png";
            const fileName = generateFileName(id, extension);
            const uploadResult = await uploadToS3(
              generatedImage.data,
              fileName,
              generatedImage.mimeType,
              "generated"
            );

            // Save to DB
            const [modelResult] = await pool.execute<ResultSetHeader>(
              `INSERT INTO messages (conversation_id, role, content_type, quality_tier, model_id, generation_seed, content, image_url, image_mime_type, estimated_cost)
               VALUES (?, 'model', 'image', ?, ?, ?, '', ?, ?, ?)`,
              [
                id,
                effectiveQualityTier,
                effectiveModelDbId,
                generatedImage.seed,
                uploadResult.url,
                generatedImage.mimeType,
                costPerImage,
              ]
            );

            totalCost += costPerImage;
            imageMessages.push({ id: modelResult.insertId, imageUrl: uploadResult.url });

            // Send SSE event for this image
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
            `UPDATE conversations
             SET total_estimated_cost = total_estimated_cost + ?
             WHERE id = ?`,
            [totalCost, id]
          );

          // Send completion event with all image messages
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

          // Generar titulo después de completar exitosamente (fire-and-forget)
          // Se genera aquí para no competir por cuota API con la llamada principal
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

          // Guardar mensaje de error (con content_type 'error' para excluirlo del historial)
          try {
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
          } catch (dbError) {
            console.error("[Imagen] Error saving error message:", dbError);
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
    console.error("[Imagen] Error en endpoint de imagen:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
