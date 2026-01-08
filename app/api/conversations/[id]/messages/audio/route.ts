import { NextRequest } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import {
  generateSingleSpeakerAudio,
  generateMultiSpeakerAudio,
  isAudioConfigured,
  convertPcmToMp3,
  convertPcmToWav,
  AudioGenerationProgress,
  Labels,
} from "@/lib/google-ai-audio";
import { uploadAudioToS3, generateAudioFileName, isS3Configured } from "@/lib/s3";
import { generateConversationTitle, Labels as AILabels } from "@/lib/google-ai";
import { calculateEstimatedCost } from "@/lib/cost-calculator";
import {
  AudioVoiceId,
  AudioSpeaker,
  AudioOutputFormat,
  AudioVoiceConfig,
  AudioSpeakerConfig,
} from "@/types/audio";

type QualityTier = "normal" | "hq";

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number | null;
  model_id: number;
  generation_type: string;
  model_model_id: string;
  system_instruction: string | null;
  audio_voice_id: AudioVoiceId;
  audio_style_prompt: string | null;
  audio_multi_speaker: boolean;
  audio_speaker_config: string | null; // JSON string
  audio_output_format: AudioOutputFormat;
  supports_audio_generation: boolean;
  project_name: string | null;
  cost_audio_per_minute: number;
}

interface AudioLimitRow extends RowDataPacket {
  max_monthly_audio_generations: number;
  current_month_audio_count: number;
  max_monthly_audio_normal: number;
  max_monthly_audio_hq: number;
}

interface MessageRow extends RowDataPacket {
  id: number;
}

// POST - Generar audio con Gemini TTS
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

    if (!isAudioConfigured()) {
      return new Response(JSON.stringify({ error: "API de Google AI Audio no configurada" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!isS3Configured()) {
      return new Response(JSON.stringify({ error: "S3 no configurado para almacenar audio" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { id } = await params;
    const body = await request.json();

    const {
      content,
      audioSettings,
      quality_tier = "normal",
    } = body as {
      content: string;
      audioSettings?: {
        voiceId?: AudioVoiceId;
        stylePrompt?: string;
        multiSpeaker?: boolean;
        speakerConfig?: AudioSpeakerConfig;
        outputFormat?: AudioOutputFormat;
      };
      quality_tier?: QualityTier;
    };

    // Validate quality_tier
    const effectiveQualityTier: QualityTier = quality_tier === "hq" ? "hq" : "normal";

    console.log("[Audio API] Received audioSettings:", audioSettings);

    if (!content || content.trim() === "") {
      return new Response(JSON.stringify({ error: "El texto para generar audio es requerido" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Validar longitud del texto (límite de 4000 bytes)
    const textBytes = Buffer.byteLength(content, "utf8");
    if (textBytes > 4000) {
      return new Response(JSON.stringify({
        error: `El texto excede el límite de 4000 bytes (actual: ${textBytes} bytes)`,
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Obtener conversación con configuración de audio y costos del modelo
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT c.*, m.model_id as model_model_id, m.supports_audio_generation, p.title as project_name,
              m.cost_audio_per_minute
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

    // Get the correct model from project_generation_config based on quality_tier
    let effectiveModelId = conversation.model_model_id;
    let effectiveCostAudioPerMinute = Number(conversation.cost_audio_per_minute) || 0;
    const generationType = conversation.generation_type || "audio";

    if (conversation.project_id) {
      const [configRows] = await pool.execute<RowDataPacket[]>(`
        SELECT
          pgc.model_normal_id,
          pgc.model_hq_id,
          mn.model_id as model_normal_model_id,
          mn.cost_audio_per_minute as mn_cost_audio,
          mh.model_id as model_hq_model_id,
          mh.cost_audio_per_minute as mh_cost_audio
        FROM project_generation_config pgc
        LEFT JOIN models mn ON pgc.model_normal_id = mn.id
        LEFT JOIN models mh ON pgc.model_hq_id = mh.id
        WHERE pgc.project_id = ? AND pgc.generation_type = ? AND pgc.is_enabled = 1
      `, [conversation.project_id, generationType]);

      if (configRows.length > 0) {
        const config = configRows[0];
        if (effectiveQualityTier === "hq" && config.model_hq_model_id) {
          effectiveModelId = config.model_hq_model_id;
          effectiveCostAudioPerMinute = Number(config.mh_cost_audio) || 0;
          console.log(`[Audio] Using HQ model from config: ${effectiveModelId}`);
        } else if (config.model_normal_model_id) {
          effectiveModelId = config.model_normal_model_id;
          effectiveCostAudioPerMinute = Number(config.mn_cost_audio) || 0;
          console.log(`[Audio] Using Normal model from config: ${effectiveModelId}`);
        }
      }
    }

    // Verificar que el modelo soporta audio generation
    if (!conversation.supports_audio_generation) {
      return new Response(JSON.stringify({ error: "El modelo seleccionado no soporta generación de audio" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verificar límite de generaciones de audio mensuales (por calidad)
    if (conversation.project_id && session.user.role !== "admin") {
      const limitColumn = effectiveQualityTier === "hq"
        ? "max_monthly_audio_hq"
        : "max_monthly_audio_normal";

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
              AND m.audio_url IS NOT NULL
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
            error: `Has alcanzado el límite de generaciones de audio ${effectiveQualityTier === 'hq' ? 'HQ' : 'normales'} mensuales para este proyecto`,
            type: "audio_limit",
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
            const titleLabels: AILabels = {
              project_name: conversation.project_name || "sin_proyecto",
              user_name: userIdentifier,
            };
            generateConversationTitle(content, titleLabels)
              .then(async (title) => {
                await pool.execute(
                  "UPDATE conversations SET title = ? WHERE id = ?",
                  [title, id]
                );
                sendEvent({ type: "title", title });
              })
              .catch((err) => {
                console.error("[Audio] Error generating title:", err);
              });
          }

          // Configuración de generación de audio (usa request settings, fallback a conversation settings)
          const voiceId = audioSettings?.voiceId || conversation.audio_voice_id || "Kore";
          const stylePrompt = audioSettings?.stylePrompt ?? conversation.audio_style_prompt ?? "";
          const multiSpeaker = audioSettings?.multiSpeaker ?? conversation.audio_multi_speaker ?? false;
          const outputFormat = audioSettings?.outputFormat || conversation.audio_output_format || "mp3";

          // Parse speaker config from conversation if needed
          let speakerConfig: AudioSpeakerConfig | null = audioSettings?.speakerConfig || null;
          if (!speakerConfig && conversation.audio_speaker_config) {
            try {
              speakerConfig = JSON.parse(conversation.audio_speaker_config);
            } catch {
              speakerConfig = null;
            }
          }

          console.log("\n========== [AUDIO GENERATION REQUEST] ==========");
          console.log("Model:", effectiveModelId);
          console.log("Quality tier:", effectiveQualityTier);
          console.log("Voice ID:", voiceId);
          console.log("Style Prompt:", stylePrompt || "(none)");
          console.log("Multi-speaker:", multiSpeaker);
          console.log("Output format:", outputFormat);
          console.log("Text length:", content.length, "characters,", textBytes, "bytes");
          console.log("================================================\n");

          // Callback de progreso
          const onProgress = (progress: AudioGenerationProgress) => {
            sendEvent({
              type: "progress",
              status: progress.status,
              message: progress.message,
            });
          };

          // Generar audio
          let generatedAudio;
          let voiceConfig: AudioVoiceConfig | AudioSpeakerConfig;

          if (multiSpeaker && speakerConfig && speakerConfig.speakers.length > 0) {
            // Validar que el texto contenga los speakers
            for (const speaker of speakerConfig.speakers) {
              if (!content.includes(`${speaker.name}:`)) {
                throw new Error(
                  `El texto debe contener diálogos del speaker "${speaker.name}" en formato "${speaker.name}: texto"`
                );
              }
            }

            generatedAudio = await generateMultiSpeakerAudio(
              effectiveModelId,
              content,
              {
                speakers: speakerConfig.speakers,
                stylePrompt: stylePrompt || undefined,
              },
              onProgress,
              labels
            );
            voiceConfig = speakerConfig;
          } else {
            generatedAudio = await generateSingleSpeakerAudio(
              effectiveModelId,
              content,
              {
                voiceId,
                stylePrompt: stylePrompt || undefined,
              },
              onProgress,
              labels
            );
            voiceConfig = { voiceId };
          }

          // Convertir audio al formato solicitado
          sendEvent({
            type: "progress",
            status: "processing",
            message: outputFormat === "mp3" ? "Convirtiendo a MP3..." : "Procesando audio...",
          });

          let finalAudioBuffer: Buffer;
          let mimeType: string;
          let fileExtension: string;

          if (outputFormat === "mp3") {
            finalAudioBuffer = await convertPcmToMp3(generatedAudio.data);
            mimeType = "audio/mpeg";
            fileExtension = "mp3";
          } else {
            finalAudioBuffer = convertPcmToWav(generatedAudio.data);
            mimeType = "audio/wav";
            fileExtension = "wav";
          }

          // Guardar audio en S3
          sendEvent({
            type: "progress",
            status: "processing",
            message: "Guardando audio...",
          });

          const audioFileName = generateAudioFileName(id, fileExtension);
          const uploadResult = await uploadAudioToS3(
            finalAudioBuffer,
            audioFileName,
            mimeType
          );

          // Calculate estimated cost for audio generation using effective model cost
          const durationMinutes = generatedAudio.duration / 60;
          const estimatedCost = calculateEstimatedCost(
            {
              cost_input_per_million: 0,
              cost_output_per_million: 0,
              cost_image_1k: 0,
              cost_image_2k: 0,
              cost_image_4k: 0,
              cost_video_per_second: 0,
              cost_audio_per_minute: effectiveCostAudioPerMinute,
            },
            {
              tokensInput: 0,
              tokensOutput: 0,
              imageGenerated: false,
              imageSize: null,
              audioMinutes: durationMinutes,
            }
          );

          // Guardar respuesta del modelo en la base de datos (con quality_tier)
          // Guardamos el content original para permitir restauración de la configuración
          const [modelResult] = await pool.execute<ResultSetHeader>(
            `INSERT INTO messages (conversation_id, role, content_type, quality_tier, content, audio_url, audio_mime_type, audio_file_size, audio_duration, audio_voice_config, estimated_cost)
             VALUES (?, 'model', 'audio', ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              effectiveQualityTier,
              content, // Guardar el texto original para poder restaurarlo luego
              uploadResult.url,
              mimeType,
              uploadResult.fileSize,
              generatedAudio.duration,
              JSON.stringify(voiceConfig),
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

          // Enviar evento de audio generado
          sendEvent({
            type: "audio",
            messageId: modelMessageId,
            content, // Incluir texto original para restauración
            audioUrl: uploadResult.url,
            mimeType,
            fileSize: uploadResult.fileSize,
            duration: generatedAudio.duration,
            voiceConfig,
          });

          // Enviar evento de finalización
          sendEvent({
            type: "complete",
            messageId: modelMessageId,
            estimatedCost,
          });

          controllerClosed = true;
          controller.close();

        } catch (error) {
          console.error("[Audio] Error generating audio:", error);
          const errorMessage = error instanceof Error ? error.message : "Error desconocido";

          // Guardar mensaje de error (con content_type 'error' para excluirlo del historial)
          const [modelResult] = await pool.execute<ResultSetHeader>(
            `INSERT INTO messages (conversation_id, role, content_type, content)
             VALUES (?, 'model', 'error', ?)`,
            [id, `Error generando audio: ${errorMessage}`]
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
    console.error("[Audio] Error en endpoint de audio:", error);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
