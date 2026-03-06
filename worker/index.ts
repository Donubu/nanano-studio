import dotenv from "dotenv";
import path from "path";

// Load .env.local for local development (no-op if file doesn't exist)
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import mysql from "mysql2/promise";
import { STREAM_QUEUE_NAME, StreamJobData, StreamJobEvent, jobChannel } from "@/lib/queue";
import { sendMessageStream, sendMessage, ChatMessage, GeneratedImage, GroundingData, generateConversationTitle, Labels, GenerationSettings } from "@/lib/google-ai";
import { uploadToS3, generateFileName } from "@/lib/s3";
import { calculateEstimatedCost } from "@/lib/cost-calculator";
import { ResultSetHeader, RowDataPacket } from "mysql2";

// ============================================
// CONFIG
// ============================================

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 3;
import os from "os";
const WORKER_NAME = process.env.WORKER_NAME || os.hostname() || `worker-${process.pid}`;

// ============================================
// DB POOL (independent from Next.js)
// ============================================

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 50,
  timezone: "-03:00",
  dateStrings: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 10000,
});

pool.on("connection", (connection) => {
  connection.query("SET time_zone = 'America/Santiago'");
});

// ============================================
// HELPERS
// ============================================

async function saveGeneratedImage(image: GeneratedImage, conversationId: string): Promise<{ url: string; fileSize: number }> {
  const extension = image.mimeType.split("/")[1] || "png";
  const fileName = generateFileName(conversationId, extension);
  const buffer = Buffer.from(image.data, "base64");
  const result = await uploadToS3(buffer, fileName, image.mimeType, "generated");
  return { url: result.url, fileSize: result.fileSize };
}

// ============================================
// JOB PROCESSOR
// ============================================

async function processStreamJob(job: Job<StreamJobData>): Promise<void> {
  const { data } = job;
  const pubRedis = new Redis(REDIS_URL);
  const channel = jobChannel(job.id!);

  const publish = (event: StreamJobEvent) => {
    pubRedis.publish(channel, JSON.stringify(event));
  };

  console.log(`[${WORKER_NAME}] Processing job ${job.id} - model: ${data.modelId}, type: ${data.generationType}`);

  // Store worker name in job data so dashboard can show which worker handles it
  await job.updateData({ ...data, workerName: WORKER_NAME });

  try {
    const messagesToSend: ChatMessage[] = data.messages.map((m) => ({
      role: m.role as "user" | "model",
      content: m.content,
      imageUrl: m.imageUrl,
      imageMimeType: m.imageMimeType,
      files: m.files?.map((f) => ({
        dataUrl: f.dataUrl,
        mimeType: f.mimeType,
        name: f.name,
        type: f.type as "image" | "document" | "audio",
      })),
    }));

    const labels: Labels = data.labels;

    interface SavedImage {
      url: string;
      fileSize: number;
      mimeType: string;
    }
    let savedImages: SavedImage[] = [];
    let imageUploadPromises: Promise<void>[] = [];
    let groundingData: GroundingData | null = null;
    let fullResponse = "";

    // Non-streaming path (image search or image generation)
    if (data.settings.googleImageSearchEnabled) {
      const result = await sendMessage(
        data.modelId,
        messagesToSend,
        data.systemInstruction || null,
        data.settings as GenerationSettings,
        labels,
        data.backend
      );

      fullResponse = result.text;
      groundingData = result.groundingData || null;

      if (result.text) {
        publish({ type: "chunk", text: result.text });
      }

      if (groundingData) {
        publish({
          type: "grounding",
          sources: groundingData.sources,
          searchEntryPointHtml: groundingData.searchEntryPointHtml,
          webSearchQueries: groundingData.webSearchQueries,
          imageSearchQueries: groundingData.imageSearchQueries,
        });
      }

      for (const img of result.images) {
        try {
          const saved = await saveGeneratedImage(img, data.conversationId);
          savedImages.push({ url: saved.url, fileSize: saved.fileSize, mimeType: img.mimeType });
          publish({ type: "image", imageUrl: saved.url, mimeType: img.mimeType, imageIndex: savedImages.length - 1 });
        } catch (err) {
          console.error("[Worker] Error saving image (non-stream):", err);
        }
      }

      await saveResultsToDB(data, fullResponse, result.tokenCount, savedImages, groundingData, publish);
      return;
    }

    // Streaming path — wrap in a promise so we wait for onComplete/onError before returning
    await new Promise<void>((resolveJob, rejectJob) => {
      sendMessageStream(
        data.modelId,
        messagesToSend,
        data.systemInstruction || null,
        data.settings as GenerationSettings,
        {
          onChunk: (text) => {
            fullResponse += text;
            publish({ type: "chunk", text });
          },
          onRetry: (info) => {
            fullResponse = "";
            savedImages = [];
            imageUploadPromises = [];
            groundingData = null;
            publish({
              type: "retry",
              attempt: info.attempt,
              maxAttempts: info.maxAttempts,
              delaySeconds: Math.round(info.delayMs / 1000),
              error: info.error.substring(0, 200),
            });
          },
          onGrounding: (gData: GroundingData) => {
            groundingData = gData;
            publish({
              type: "grounding",
              sources: gData.sources,
              searchEntryPointHtml: gData.searchEntryPointHtml,
              webSearchQueries: gData.webSearchQueries,
              imageSearchQueries: gData.imageSearchQueries,
            });
          },
          onImage: async (image: GeneratedImage) => {
            const imageIndex = imageUploadPromises.length;
            const uploadPromise = (async () => {
              try {
                const saved = await saveGeneratedImage(image, data.conversationId);
                savedImages[imageIndex] = { url: saved.url, fileSize: saved.fileSize, mimeType: image.mimeType };
                publish({ type: "image", imageUrl: saved.url, mimeType: image.mimeType, imageIndex });
              } catch (err) {
                console.error(`[Worker] Error saving image ${imageIndex}:`, err);
              }
            })();
            imageUploadPromises.push(uploadPromise);
          },
          onComplete: async (text, tokenCount, images) => {
            try {
              if (imageUploadPromises.length > 0) {
                await Promise.all(imageUploadPromises);
              }

              // Fallback: images arrived in onComplete instead of onImage
              if (imageUploadPromises.length === 0 && images && images.length > 0) {
                for (const img of images) {
                  try {
                    const saved = await saveGeneratedImage(img, data.conversationId);
                    savedImages.push({ url: saved.url, fileSize: saved.fileSize, mimeType: img.mimeType });
                  } catch (err) {
                    console.error("[Worker] Error saving final image:", err);
                  }
                }
              }

              await saveResultsToDB(data, text, tokenCount, savedImages, groundingData, publish);
              resolveJob();
            } catch (err) {
              rejectJob(err);
            }
          },
          onError: async (error) => {
            console.error("[Worker] Stream error:", error);
            const errorMessage = `Error al generar respuesta: ${error.message}`;
            try {
              const [modelResult] = await pool.execute<ResultSetHeader>(
                `INSERT INTO messages (conversation_id, role, content_type, content) VALUES (?, 'model', 'error', ?)`,
                [data.conversationId, errorMessage]
              );
              if (!data.skipUserMessage && data.userMessageId) {
                await pool.execute(`UPDATE messages SET ignore_in_context = 1 WHERE id = ?`, [data.userMessageId]);
              }
              publish({ type: "error", message: error.message, id: modelResult.insertId });
            } catch (dbErr) {
              console.error("[Worker] Error saving error:", dbErr);
              publish({ type: "error", message: error.message });
            }
            rejectJob(error);
          },
        },
        labels,
        undefined, // no abort signal in worker
        data.backend
      ).catch(rejectJob);
    });
  } catch (error) {
    console.error("[Worker] Job error:", error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    // Try to save error and notify client (may already be done by onError)
    try {
      publish({ type: "error", message: errorMessage });
    } catch {
      // pubRedis might already be disconnected, ignore
    }
    // Re-throw so BullMQ marks job as failed
    throw error;
  } finally {
    pubRedis.disconnect();
  }
}

// ============================================
// SAVE RESULTS TO DB
// ============================================

async function saveResultsToDB(
  data: StreamJobData,
  text: string,
  tokenCount: { input: number; output: number },
  savedImages: Array<{ url: string; fileSize: number; mimeType: string }>,
  groundingData: GroundingData | null,
  publish: (event: StreamJobEvent) => void
): Promise<void> {
  const validImages = savedImages.filter((img) => img.url);
  const hasImages = validImages.length > 0;
  const hasText = !!text;
  const imageAspectRatioToSave = hasImages ? (data.effectiveImageAspectRatio || null) : null;
  const imageSizeToSave = hasImages ? (data.effectiveImageSize || null) : null;

  let totalEstimatedCost = 0;
  let modelMessageId = 0;
  const imageMessages: Array<{ id: number; imageUrl: string }> = [];

  // Save text message
  if (hasText) {
    const textCost = calculateEstimatedCost(data.effectiveCosts, {
      tokensInput: tokenCount.input,
      tokensOutput: tokenCount.output,
      imageGenerated: false,
      imageSize: null,
      videoSeconds: null,
    });
    totalEstimatedCost += textCost;
    const [modelResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO messages (conversation_id, role, content_type, quality_tier, content, tokens_input, tokens_output, estimated_cost, grounding_data)
       VALUES (?, 'model', 'text', ?, ?, ?, ?, ?, ?)`,
      [data.conversationId, data.qualityTier, text, tokenCount.input, tokenCount.output, textCost, groundingData ? JSON.stringify(groundingData) : null]
    );
    modelMessageId = modelResult.insertId;
  }

  // Save each image as separate message
  for (let i = 0; i < validImages.length; i++) {
    const img = validImages[i];
    const isFirstMessage = !hasText && i === 0;
    const imageCost = calculateEstimatedCost(data.effectiveCosts, {
      tokensInput: isFirstMessage ? tokenCount.input : 0,
      tokensOutput: isFirstMessage ? tokenCount.output : 0,
      imageGenerated: true,
      imageSize: imageSizeToSave,
      videoSeconds: null,
    });
    totalEstimatedCost += imageCost;
    const [imgResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO messages (conversation_id, role, content_type, quality_tier, content, image_url, image_mime_type, image_file_size, image_aspect_ratio, image_size, tokens_input, tokens_output, estimated_cost)
       VALUES (?, 'model', 'image', ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.conversationId, data.qualityTier, img.url, img.mimeType, img.fileSize, imageAspectRatioToSave, imageSizeToSave,
        isFirstMessage ? tokenCount.input : 0, isFirstMessage ? tokenCount.output : 0, imageCost]
    );
    imageMessages.push({ id: imgResult.insertId, imageUrl: img.url });
    if (isFirstMessage) modelMessageId = imgResult.insertId;
  }

  // Empty response fallback
  if (!hasText && validImages.length === 0) {
    const textCost = calculateEstimatedCost(data.effectiveCosts, {
      tokensInput: tokenCount.input,
      tokensOutput: tokenCount.output,
      imageGenerated: false,
      imageSize: null,
      videoSeconds: null,
    });
    totalEstimatedCost += textCost;
    const [modelResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO messages (conversation_id, role, content_type, quality_tier, content, tokens_input, tokens_output, estimated_cost)
       VALUES (?, 'model', 'text', ?, '', ?, ?, ?)`,
      [data.conversationId, data.qualityTier, tokenCount.input, tokenCount.output, textCost]
    );
    modelMessageId = modelResult.insertId;
  }

  // Update conversation totals
  await pool.execute(
    `UPDATE conversations SET total_tokens_input = total_tokens_input + ?, total_tokens_output = total_tokens_output + ?, total_estimated_cost = total_estimated_cost + ? WHERE id = ?`,
    [tokenCount.input, tokenCount.output, totalEstimatedCost, data.conversationId]
  );

  const [totalsResult] = await pool.execute<RowDataPacket[]>(
    `SELECT total_tokens_input, total_tokens_output, total_estimated_cost FROM conversations WHERE id = ?`,
    [data.conversationId]
  );

  // Publish complete event
  publish({
    type: "complete",
    id: modelMessageId,
    tokens: tokenCount,
    totalTokens: {
      input: totalsResult[0]?.total_tokens_input || 0,
      output: totalsResult[0]?.total_tokens_output || 0,
    },
    estimatedCost: totalEstimatedCost,
    totalCost: Number(totalsResult[0]?.total_estimated_cost) || 0,
    imageUrl: validImages.length === 1 ? validImages[0].url : null,
    imageMessages: imageMessages.length > 0 ? imageMessages : undefined,
  });

  // Generate title (fire-and-forget)
  if (data.needsTitle && !data.skipUserMessage) {
    generateConversationTitle(data.content, data.labels)
      .then(async (title) => {
        await pool.execute("UPDATE conversations SET title = ? WHERE id = ?", [title, data.conversationId]);
        console.log("[Worker] Generated title:", title);
      })
      .catch((err) => console.error("[Worker] Error generating title:", err));
  }
}

// ============================================
// START WORKER
// ============================================

console.log(`[Worker] Starting with concurrency=${CONCURRENCY}, redis=${REDIS_URL}`);

const worker = new Worker<StreamJobData>(
  STREAM_QUEUE_NAME,
  processStreamJob,
  {
    connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false }) as never,
    concurrency: CONCURRENCY,
  }
);

worker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("[Worker] Error:", err);
});

console.log("[Worker] Ready and waiting for jobs...");

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[Worker] SIGTERM received, shutting down...");
  await worker.close();
  await pool.end();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[Worker] SIGINT received, shutting down...");
  await worker.close();
  await pool.end();
  process.exit(0);
});
