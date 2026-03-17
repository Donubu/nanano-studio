import { NextRequest } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import {
  generateMusic,
  convertMusicPcmToMp3,
  isMusicConfigured,
  validateMusicConfig,
  buildMusicPromptSummary,
  MusicGenerationProgress,
} from "@/lib/google-ai-music";
import { uploadMusicToS3, generateMusicFileName, isS3Configured } from "@/lib/s3";
import { generateConversationTitle, Labels as AILabels } from "@/lib/google-ai";
import { calculateEstimatedCost } from "@/lib/cost-calculator";
import type { MusicGenerationSettings, WeightedPrompt } from "@/types/music";

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number | null;
  model_id: number;
  generation_type: string;
  title: string | null;
  model_model_id: string;
  system_instruction: string | null;
  supports_music_generation: boolean;
  project_name: string | null;
  client_name: string | null;
  cost_music_per_minute: number;
  // Music settings from conversation
  music_prompts: string | null;
  music_bpm: number;
  music_density: number;
  music_brightness: number;
  music_scale: string;
  music_guidance: number;
  music_generation_mode: string;
  music_duration: number;
  music_mute_bass: boolean;
  music_mute_drums: boolean;
  music_only_bass_and_drums: boolean;
}

// POST - Generar musica con Lyria (SSE stream con preview)
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
      return new Response(JSON.stringify({ error: "S3 no configurado para almacenar musica" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!isMusicConfigured()) {
      return new Response(JSON.stringify({ error: "API de Google AI Music no configurada" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { id } = await params;
    const body = await request.json();

    const {
      musicSettings,
    } = body as {
      musicSettings?: Partial<MusicGenerationSettings>;
    };

    // Obtener conversacion con configuracion de musica
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT c.*, m.model_id as model_model_id, m.supports_music_generation, p.title as project_name, cl.name as client_name,
              m.cost_music_per_minute
       FROM conversations c
       JOIN models m ON c.model_id = m.id
       LEFT JOIN projects p ON c.project_id = p.id
       LEFT JOIN clients cl ON p.client_id = cl.id
       WHERE c.id = ? AND c.deleted_at IS NULL`,
      [id]
    );

    if (conversations.length === 0) {
      return new Response(JSON.stringify({ error: "Conversacion no encontrada" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const conversation = conversations[0];

    if (conversation.generation_type !== "music") {
      return new Response(JSON.stringify({ error: "Esta conversacion no es de tipo music" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!conversation.supports_music_generation) {
      return new Response(JSON.stringify({ error: "El modelo seleccionado no soporta generacion de musica" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get cost from project config if available
    let effectiveCostMusicPerMinute = Number(conversation.cost_music_per_minute) || 0;

    if (conversation.project_id) {
      const [projectModels] = await pool.execute<RowDataPacket[]>(`
        SELECT
          m.cost_music_per_minute
        FROM project_generation_models pgm
        JOIN models m ON pgm.model_id = m.id
        JOIN project_generation_config pgc ON pgc.project_id = pgm.project_id AND pgc.generation_type = pgm.generation_type
        WHERE pgm.project_id = ? AND pgm.generation_type = 'music' AND pgc.is_enabled = 1
        ORDER BY pgm.sort_order ASC
        LIMIT 1
      `, [conversation.project_id]);

      if (projectModels.length > 0) {
        effectiveCostMusicPerMinute = Number(projectModels[0].cost_music_per_minute) || effectiveCostMusicPerMinute;
      }
    }

    // Build settings: merge request settings over conversation defaults
    let conversationPrompts: WeightedPrompt[] = [{ text: "", weight: 1.0 }];
    if (conversation.music_prompts) {
      try {
        conversationPrompts = JSON.parse(conversation.music_prompts);
      } catch { /* use default */ }
    }

    const settings: MusicGenerationSettings = {
      prompts: musicSettings?.prompts || conversationPrompts,
      bpm: musicSettings?.bpm ?? (Number(conversation.music_bpm) || 120),
      density: musicSettings?.density ?? (Number(conversation.music_density) || 0.5),
      brightness: musicSettings?.brightness ?? (Number(conversation.music_brightness) || 0.5),
      scale: (musicSettings?.scale || conversation.music_scale || "UNSPECIFIED") as MusicGenerationSettings["scale"],
      guidance: musicSettings?.guidance ?? (Number(conversation.music_guidance) || 3.5),
      generationMode: (musicSettings?.generationMode || conversation.music_generation_mode || "QUALITY") as MusicGenerationSettings["generationMode"],
      duration: musicSettings?.duration ?? (Number(conversation.music_duration) || 30),
      muteBass: musicSettings?.muteBass ?? Boolean(conversation.music_mute_bass),
      muteDrums: musicSettings?.muteDrums ?? Boolean(conversation.music_mute_drums),
      onlyBassAndDrums: musicSettings?.onlyBassAndDrums ?? Boolean(conversation.music_only_bass_and_drums),
    };

    // Validate settings
    const validationError = validateMusicConfig(settings);
    if (validationError) {
      return new Response(JSON.stringify({ error: validationError }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    let controllerClosed = false;
    let heartbeat: ReturnType<typeof setInterval>;

    const stream = new ReadableStream({
      async start(controller) {
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
          const promptSummary = buildMusicPromptSummary(settings.prompts);

          // Save user message with prompt summary as content
          const [userMessageResult] = await pool.execute<ResultSetHeader>(
            `INSERT INTO messages (conversation_id, user_id, role, content_type, content)
             VALUES (?, ?, 'user', 'text', ?)`,
            [id, session.user.id, promptSummary || "Generar musica"]
          );
          const userMessageId = userMessageResult.insertId;

          const needsTitle = conversation.title === "Nueva conversación" || !conversation.title;

          await pool.execute(
            "UPDATE conversations SET updated_at = NOW() WHERE id = ?",
            [id]
          );

          sendEvent({ type: "user_message", id: userMessageId });

          // Create placeholder message for music generation
          const [placeholderResult] = await pool.execute<ResultSetHeader>(
            `INSERT INTO messages (conversation_id, user_id, role, status, content_type, content)
             VALUES (?, ?, 'model', 'generating', 'music', '')`,
            [id, session.user.id]
          );
          placeholderId = placeholderResult.insertId;
          sendEvent({ type: "placeholders", ids: [placeholderId] });

          console.log(`\n========== [MUSIC GENERATION REQUEST] ==========`);
          console.log("Prompts:", settings.prompts.map(p => `"${p.text}" (${p.weight})`).join(", "));
          console.log("BPM:", settings.bpm, "| Duration:", settings.duration, "s");
          console.log("Density:", settings.density, "| Brightness:", settings.brightness);
          console.log("Scale:", settings.scale, "| Guidance:", settings.guidance);
          console.log("Mode:", settings.generationMode);
          console.log("Mute bass:", settings.muteBass, "| Mute drums:", settings.muteDrums);
          console.log("Only bass+drums:", settings.onlyBassAndDrums);
          console.log("================================================\n");

          // Generate music via Lyria
          const onProgress = (progress: MusicGenerationProgress) => {
            sendEvent({
              type: "progress",
              status: progress.status,
              message: progress.message,
              percent: progress.percent,
            });
          };

          const generatedMusic = await generateMusic(settings, onProgress);

          // Convert PCM to MP3
          sendEvent({
            type: "progress",
            status: "converting",
            message: "Convirtiendo a MP3...",
          });

          const mp3Buffer = await convertMusicPcmToMp3(generatedMusic.data);

          // Upload to S3 (permanent)
          sendEvent({
            type: "progress",
            status: "uploading",
            message: "Subiendo archivo...",
          });

          const musicFileName = generateMusicFileName(id, "mp3");
          const uploadResult = await uploadMusicToS3(
            mp3Buffer,
            musicFileName,
            "audio/mpeg"
          );

          // Calculate cost
          const durationMinutes = generatedMusic.duration / 60;
          const estimatedCost = calculateEstimatedCost(
            {
              cost_input_per_million: 0,
              cost_output_per_million: 0,
              cost_image_1k: 0,
              cost_image_2k: 0,
              cost_image_4k: 0,
              cost_video_per_second: 0,
              cost_music_per_minute: effectiveCostMusicPerMinute,
            },
            {
              tokensInput: 0,
              tokensOutput: 0,
              imageGenerated: false,
              imageSize: null,
              musicMinutes: durationMinutes,
            }
          );

          // Update placeholder message with actual music data
          await pool.execute(
            `UPDATE messages SET status = 'completed', content_type = 'music', content = ?, music_url = ?, music_mime_type = ?, music_file_size = ?, music_duration = ?, music_config = ?, estimated_cost = ?
             WHERE id = ?`,
            [
              promptSummary,
              uploadResult.url,
              "audio/mpeg",
              uploadResult.fileSize,
              generatedMusic.duration,
              JSON.stringify(settings),
              estimatedCost,
              placeholderId,
            ]
          );

          // Update conversation total cost
          await pool.execute(
            `UPDATE conversations SET total_estimated_cost = total_estimated_cost + ? WHERE id = ?`,
            [estimatedCost, id]
          );

          // Send saved event
          sendEvent({
            type: "saved",
            messageId: placeholderId,
            musicUrl: uploadResult.url,
            duration: generatedMusic.duration,
            fileSize: uploadResult.fileSize,
            config: settings,
            estimatedCost,
          });

          clearInterval(heartbeat);
          controllerClosed = true;
          controller.close();

          // Generate title if needed (fire-and-forget)
          if (needsTitle && promptSummary) {
            const userIdentifier = session.user.email?.split("@")[0] || "unknown";
            const titleLabels: AILabels = {
              project_name: conversation.client_name ? `${conversation.client_name} > ${conversation.project_name}` : conversation.project_name || "sin_proyecto",
              user_name: userIdentifier,
            };
            generateConversationTitle(promptSummary, titleLabels)
              .then(async (title) => {
                await pool.execute(
                  "UPDATE conversations SET title = ? WHERE id = ?",
                  [title, id]
                );
                console.log("[Music] Generated title:", title);
              })
              .catch((err) => {
                console.error("[Music] Error generating title:", err);
              });
          }

        } catch (error) {
          console.error("[Music] Error generating music:", error);
          const errorMessage = error instanceof Error ? error.message : "Error desconocido";

          try {
            if (placeholderId) {
              await pool.execute(
                `UPDATE messages SET status = 'error', content_type = 'error', content = ? WHERE id = ?`,
                [`Error generando musica: ${errorMessage}`, placeholderId]
              );
            } else {
              const [modelResult] = await pool.execute<ResultSetHeader>(
                `INSERT INTO messages (conversation_id, user_id, role, content_type, content)
                 VALUES (?, ?, 'model', 'error', ?)`,
                [id, session.user.id, `Error generando musica: ${errorMessage}`]
              );
              placeholderId = modelResult.insertId;
            }

            sendEvent({
              type: "error",
              message: errorMessage,
              id: placeholderId,
            });
          } catch (dbError) {
            console.error("[Music] Error saving error message:", dbError);
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
    console.error("[Music] Error en endpoint de musica:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
