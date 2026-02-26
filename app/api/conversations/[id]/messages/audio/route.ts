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
import {
  generateChirpAudio,
  isChirpConfigured,
  ChirpProgress,
} from "@/lib/google-cloud-tts";
import { uploadAudioToS3, generateAudioFileName, isS3Configured } from "@/lib/s3";
import { generateConversationTitle, Labels as AILabels } from "@/lib/google-ai";
import { calculateEstimatedCost } from "@/lib/cost-calculator";
import {
  AudioVoiceId,
  AudioSpeaker,
  AudioOutputFormat,
  AudioVoiceConfig,
  AudioSpeakerConfig,
  AudioTTSEngine,
} from "@/types/audio";

type QualityTier = "normal" | "hq" | "chirp";

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number | null;
  model_id: number;
  generation_type: string;
  title: string | null;
  model_model_id: string;
  system_instruction: string | null;
  audio_voice_id: AudioVoiceId;
  audio_style_prompt: string | null;
  audio_multi_speaker: boolean;
  audio_speaker_config: string | null; // JSON string
  audio_output_format: AudioOutputFormat;
  audio_tts_engine: AudioTTSEngine;
  audio_speaking_rate: number;
  audio_locale: string;
  supports_audio_generation: boolean;
  project_name: string | null;
  cost_audio_per_minute: number;
  model_api_backend: string | null;
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

// POST - Generar audio con Gemini TTS o Chirp 3 HD
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
        ttsEngine?: AudioTTSEngine;
        speakingRate?: number;
        locale?: string;
      };
      quality_tier?: QualityTier;
    };

    // Validate quality_tier
    const validTiers: QualityTier[] = ["normal", "hq", "chirp"];
    const effectiveQualityTier: QualityTier = validTiers.includes(quality_tier) ? quality_tier : "normal";
    const isChirpTier = effectiveQualityTier === "chirp";

    // Check appropriate engine is configured
    if (isChirpTier) {
      if (!isChirpConfigured()) {
        return new Response(JSON.stringify({ error: "Google Cloud TTS (Chirp) no configurado" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    } else {
      if (!isAudioConfigured()) {
        return new Response(JSON.stringify({ error: "API de Google AI Audio no configurada" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    console.log("[Audio API] Received audioSettings:", audioSettings);

    if (!content || content.trim() === "") {
      return new Response(JSON.stringify({ error: "El texto para generar audio es requerido" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Validate text length based on engine
    const textBytes = Buffer.byteLength(content, "utf8");
    const maxBytes = isChirpTier ? 5000 : 4000;
    if (textBytes > maxBytes) {
      return new Response(JSON.stringify({
        error: `El texto excede el límite de ${maxBytes} bytes (actual: ${textBytes} bytes)`,
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Obtener conversación con configuración de audio y costos del modelo
    const isAdmin = session.user.role === "admin";
    const [conversations] = await pool.execute<ConversationRow[]>(
      `SELECT c.*, m.model_id as model_model_id, m.supports_audio_generation, m.api_backend as model_api_backend, p.title as project_name,
              m.cost_audio_per_minute
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

    // Verificar que el modelo soporta audio generation
    if (!conversation.supports_audio_generation) {
      return new Response(JSON.stringify({ error: "El modelo seleccionado no soporta generación de audio" }), {
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
          let effectiveCostAudioPerMinute = Number(conversation.cost_audio_per_minute) || 0;
          const generationType = conversation.generation_type || "audio";

          if (conversation.project_id) {
            const [configRows] = await pool.execute<RowDataPacket[]>(`
              SELECT
                pgc.model_normal_id,
                pgc.model_hq_id,
                pgc.model_chirp_id,
                mn.model_id as model_normal_model_id,
                mn.api_backend as mn_api_backend,
                mn.cost_audio_per_minute as mn_cost_audio,
                mh.model_id as model_hq_model_id,
                mh.api_backend as mh_api_backend,
                mh.cost_audio_per_minute as mh_cost_audio,
                mc.model_id as model_chirp_model_id,
                mc.api_backend as mc_api_backend,
                mc.cost_audio_per_minute as mc_cost_audio
              FROM project_generation_config pgc
              LEFT JOIN models mn ON pgc.model_normal_id = mn.id
              LEFT JOIN models mh ON pgc.model_hq_id = mh.id
              LEFT JOIN models mc ON pgc.model_chirp_id = mc.id
              WHERE pgc.project_id = ? AND pgc.generation_type = ? AND pgc.is_enabled = 1
            `, [conversation.project_id, generationType]);

            if (configRows.length > 0) {
              const config = configRows[0];
              if (effectiveQualityTier === "chirp" && config.model_chirp_model_id) {
                effectiveModelId = config.model_chirp_model_id;
                effectiveBackend = config.mc_api_backend || undefined;
                effectiveCostAudioPerMinute = Number(config.mc_cost_audio) || 0;
                console.log(`[Audio] Using Chirp model from config: ${effectiveModelId} (${effectiveBackend || 'default'})`);
              } else if (effectiveQualityTier === "hq" && config.model_hq_model_id) {
                effectiveModelId = config.model_hq_model_id;
                effectiveBackend = config.mh_api_backend || undefined;
                effectiveCostAudioPerMinute = Number(config.mh_cost_audio) || 0;
                console.log(`[Audio] Using HQ model from config: ${effectiveModelId} (${effectiveBackend || 'default'})`);
              } else if (config.model_normal_model_id) {
                effectiveModelId = config.model_normal_model_id;
                effectiveBackend = config.mn_api_backend || undefined;
                effectiveCostAudioPerMinute = Number(config.mn_cost_audio) || 0;
                console.log(`[Audio] Using Normal model from config: ${effectiveModelId} (${effectiveBackend || 'default'})`);
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

          // Enviar el ID del mensaje del usuario
          sendEvent({ type: "user_message", id: userMessageId });

          // Configuración de generación de audio (usa request settings, fallback a conversation settings)
          const voiceId = audioSettings?.voiceId || conversation.audio_voice_id || "Kore";
          const stylePrompt = audioSettings?.stylePrompt ?? conversation.audio_style_prompt ?? "";
          const multiSpeaker = isChirpTier ? false : (audioSettings?.multiSpeaker ?? conversation.audio_multi_speaker ?? false);
          const outputFormat = audioSettings?.outputFormat || conversation.audio_output_format || "mp3";
          const ttsEngine: AudioTTSEngine = isChirpTier ? "chirp" : (audioSettings?.ttsEngine || conversation.audio_tts_engine || "gemini");
          const speakingRate = audioSettings?.speakingRate ?? (Number(conversation.audio_speaking_rate) || 1.0);
          const locale = audioSettings?.locale || conversation.audio_locale || "en-US";

          // Parse speaker config from conversation if needed
          let speakerConfig: AudioSpeakerConfig | null = audioSettings?.speakerConfig || null;
          if (!speakerConfig && conversation.audio_speaker_config) {
            try {
              speakerConfig = JSON.parse(conversation.audio_speaker_config);
            } catch {
              speakerConfig = null;
            }
          }

          const engineLabel = isChirpTier ? "Chirp 3 HD (Cloud TTS)" : (effectiveBackend === 'vertex' ? 'Vertex AI' : effectiveBackend === 'gemini' ? 'Gemini API' : (process.env.GOOGLE_GENAI_USE_VERTEXAI === "true" ? "Vertex AI" : "Gemini API"));
          console.log(`\n========== [AUDIO GENERATION REQUEST] (${engineLabel}) ==========`);
          console.log("Model:", effectiveModelId);
          console.log("Quality tier:", effectiveQualityTier);
          console.log("TTS Engine:", ttsEngine);
          console.log("Voice ID:", voiceId);
          if (isChirpTier) {
            console.log("Locale:", locale);
            console.log("Speaking rate:", speakingRate);
          } else {
            console.log("Style Prompt:", stylePrompt || "(none)");
            console.log("Multi-speaker:", multiSpeaker);
          }
          console.log("Output format:", outputFormat);
          console.log("Text length:", content.length, "characters,", textBytes, "bytes");
          console.log("================================================\n");

          let generatedAudio;
          let voiceConfig: AudioVoiceConfig | AudioSpeakerConfig;
          let finalAudioBuffer: Buffer;
          let mimeType: string;
          let fileExtension: string;

          if (isChirpTier) {
            // ======== CHIRP 3 HD BRANCH ========
            const onChirpProgress = (progress: ChirpProgress) => {
              sendEvent({
                type: "progress",
                status: progress.status,
                message: progress.message,
              });
            };

            generatedAudio = await generateChirpAudio(
              content,
              {
                voiceId,
                locale,
                speakingRate,
                outputFormat: outputFormat === "wav" ? "linear16" : "mp3",
              },
              onChirpProgress,
              (info) => {
                sendEvent({
                  type: "progress",
                  status: "processing",
                  message: `Reintentando (${info.attempt}/${info.maxAttempts})... Esperando ${Math.round(info.delayMs / 1000)}s`,
                });
              }
            );

            voiceConfig = { voiceId, engine: "chirp" };

            // Chirp returns encoded audio directly - no PCM conversion needed
            finalAudioBuffer = generatedAudio.data;
            mimeType = generatedAudio.mimeType;
            fileExtension = outputFormat === "wav" ? "wav" : "mp3";

          } else {
            // ======== GEMINI TTS BRANCH ========
            const onProgress = (progress: AudioGenerationProgress) => {
              sendEvent({
                type: "progress",
                status: progress.status,
                message: progress.message,
              });
            };

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
                labels,
                effectiveBackend
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
                labels,
                effectiveBackend
              );
              voiceConfig = { voiceId };
            }

            // Convertir audio PCM al formato solicitado
            sendEvent({
              type: "progress",
              status: "processing",
              message: outputFormat === "mp3" ? "Convirtiendo a MP3..." : "Procesando audio...",
            });

            if (outputFormat === "mp3") {
              finalAudioBuffer = await convertPcmToMp3(generatedAudio.data);
              mimeType = "audio/mpeg";
              fileExtension = "mp3";
            } else {
              finalAudioBuffer = convertPcmToWav(generatedAudio.data);
              mimeType = "audio/wav";
              fileExtension = "wav";
            }
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

          clearInterval(heartbeat);
          controllerClosed = true;
          controller.close();

          // Generar título después de completar exitosamente (fire-and-forget)
          // Se genera aquí para no competir por cuota API con la llamada principal
          if (needsTitle) {
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
                console.log("[Audio] Generated title:", title);
              })
              .catch((err) => {
                console.error("[Audio] Error generating title:", err);
              });
          }

        } catch (error) {
          console.error("[Audio] Error generating audio:", error);
          const errorMessage = error instanceof Error ? error.message : "Error desconocido";

          // Guardar mensaje de error (con content_type 'error' para excluirlo del historial)
          try {
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
          } catch (dbError) {
            console.error("[Audio] Error saving error message:", dbError);
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
