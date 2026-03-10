import dotenv from "dotenv";
import path from "path";

// Load .env.local for local development (no-op if file doesn't exist)
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import mysql from "mysql2/promise";
import { STREAM_QUEUE_NAME, StreamJobData, StreamJobEvent, IMAGEN_QUEUE_NAME, ImagenJobData, ImagenJobEvent, jobChannel } from "@/lib/queue";
import { sendMessageStream, sendMessage, ChatMessage, GeneratedImage, GroundingData, generateConversationTitle, Labels, GenerationSettings } from "@/lib/google-ai";
import { generateImagen, ImagenAspectRatio, ImagenResolution, Labels as ImagenLabels } from "@/lib/google-ai-imagen";
import { generateXaiImage, XaiImageAspectRatio, XaiImageResolution } from "@/lib/xai-image";
import { generateKlingImage, KlingImageConfig } from "@/lib/kling-image";
import { uploadToS3, generateFileName } from "@/lib/s3";
import { calculateEstimatedCost } from "@/lib/cost-calculator";
import { ResultSetHeader, RowDataPacket } from "mysql2";

// ============================================
// CONFIG
// ============================================

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 3;

// Redis options for pub/sub connections inside jobs
const REDIS_PUB_OPTIONS = {
  keepAlive: 30000,
  connectTimeout: 30000,
  retryStrategy(times: number) { return Math.min(times * 500, 15000); },
};
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
  const pubRedis = new Redis(REDIS_URL, REDIS_PUB_OPTIONS);
  const channel = jobChannel(job.id!);

  const publish = (event: StreamJobEvent) => {
    pubRedis.publish(channel, JSON.stringify(event));
  };

  console.log(`\n========== [${WORKER_NAME}] Job ${job.id} ==========`);
  console.log(`  Model: ${data.modelId} (${data.backend || "default"})`);
  console.log(`  Type: ${data.generationType} | Quality: ${data.qualityTier}`);
  console.log(`  Conversation: ${data.conversationId} | User: ${data.labels?.user_name || "—"}`);
  console.log(`  Project: ${data.labels?.project_name || "—"}`);
  if (data.settings.imageConfig) {
    console.log(`  Image: ${data.settings.imageConfig.aspectRatio || "—"} @ ${data.settings.imageConfig.imageSize || "—"}`);
  }
  if (data.settings.googleSearchEnabled) console.log(`  Google Search: enabled`);
  if (data.settings.googleImageSearchEnabled) console.log(`  Image Search: enabled`);
  console.log(`  Temperature: ${data.settings.temperature ?? "—"} | TopP: ${data.settings.topP ?? "—"} | MaxTokens: ${data.settings.maxOutputTokens ?? "—"}`);
  console.log(`  Content: ${data.content.substring(0, 100)}${data.content.length > 100 ? "..." : ""}`);
  console.log(`  Messages: ${data.messages.length} | NeedsTitle: ${data.needsTitle}`);
  console.log(`==========================================\n`);

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

  // Generate title before completing (so the SSE connection is still open)
  if (data.needsTitle && !data.skipUserMessage) {
    try {
      const title = await generateConversationTitle(data.content, data.labels);
      await pool.execute("UPDATE conversations SET title = ? WHERE id = ?", [title, data.conversationId]);
      publish({ type: "title", title });
      console.log(`[${WORKER_NAME}] Generated title: ${title}`);
    } catch (err) {
      console.error(`[${WORKER_NAME}] Error generating title:`, err);
    }
  }

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
}

// ============================================
// IMAGEN JOB PROCESSOR
// ============================================

async function processImagenJob(job: Job<ImagenJobData>): Promise<void> {
  const { data } = job;
  const pubRedis = new Redis(REDIS_URL, REDIS_PUB_OPTIONS);
  const channel = jobChannel(job.id!);

  const publish = (event: ImagenJobEvent) => {
    pubRedis.publish(channel, JSON.stringify(event));
  };

  console.log(`\n========== [${WORKER_NAME}] Imagen Job ${job.id} ==========`);
  console.log(`  Model: ${data.modelId} (${data.backend || "default"})`);
  console.log(`  Resolution: ${data.resolution} | Aspect: ${data.aspectRatio}`);
  console.log(`  Images: ${data.numberOfImages}`);
  console.log(`  Conversation: ${data.conversationId} | User: ${data.labels?.user_name || "—"}`);
  console.log(`  Prompt: ${data.content.substring(0, 100)}${data.content.length > 100 ? "..." : ""}`);
  console.log(`==========================================\n`);

  await job.updateData({ ...data, workerName: WORKER_NAME });

  try {
    const labels: ImagenLabels = data.labels;

    const onProgress = (progress: { status: string; message: string }) => {
      const retryMatch = progress.message.match(/Reintentando \((\d+)\/(\d+)\).*?(\d+)s/);
      if (retryMatch) {
        publish({
          type: "retry",
          attempt: parseInt(retryMatch[1]),
          maxAttempts: parseInt(retryMatch[2]),
          delaySeconds: parseInt(retryMatch[3]),
        });
      }
    };

    // Generate images using the appropriate provider
    let generatedImages: Array<{ data: Buffer; mimeType: string; seed?: number }>;

    if (data.backend === "kling" || data.modelId.includes("kling-omni-image")) {
      // Kling Omni Image
      const klingResults = await generateKlingImage(
        data.modelId,
        data.content,
        {
          aspectRatio: data.aspectRatio as KlingImageConfig["aspectRatio"],
          resolution: (data.resolution?.toLowerCase() || "1k") as KlingImageConfig["resolution"],
          numberOfImages: data.numberOfImages,
        },
        onProgress,
      );
      generatedImages = klingResults;
    } else if (data.backend === "xai") {
      // xAI Grok Imagine Image
      const xaiResults = await generateXaiImage(
        data.modelId,
        data.content,
        {
          aspectRatio: data.aspectRatio as XaiImageAspectRatio,
          resolution: (data.resolution?.toLowerCase() || "1k") as XaiImageResolution,
          numberOfImages: data.numberOfImages,
          imageUrls: data.referenceImageUrls || undefined,
        },
        onProgress,
      );
      generatedImages = xaiResults;
    } else {
      // Google Imagen 4
      const imagenResults = await generateImagen(
        data.modelId,
        data.content,
        {
          aspectRatio: data.aspectRatio as ImagenAspectRatio,
          resolution: data.resolution as ImagenResolution,
          negativePrompt: data.negativePrompt,
          numberOfImages: data.numberOfImages,
          seed: data.seed,
        },
        onProgress,
        labels,
        data.backend
      );
      generatedImages = imagenResults;
    }

    if (generatedImages.length === 0) {
      throw new Error("No se genero ninguna imagen");
    }

    const costPerImage = calculateEstimatedCost(
      {
        cost_input_per_million: 0,
        cost_output_per_million: 0,
        cost_image_1k: data.costImage1k,
        cost_image_2k: data.costImage2k,
        cost_image_4k: data.costImage4k,
        cost_video_per_second: 0,
      },
      {
        tokensInput: 0,
        tokensOutput: 0,
        imageGenerated: true,
        imageSize: data.resolution,
        videoSeconds: 0,
      }
    );

    const imageMessages: Array<{ id: number; imageUrl: string }> = [];
    let totalCost = 0;

    for (let i = 0; i < generatedImages.length; i++) {
      const generatedImage = generatedImages[i];

      const extension = generatedImage.mimeType.split("/")[1] || "png";
      const fileName = generateFileName(data.conversationId, extension);
      const uploadResult = await uploadToS3(
        generatedImage.data,
        fileName,
        generatedImage.mimeType,
        "generated"
      );

      const [modelResult] = await pool.execute<ResultSetHeader>(
        `INSERT INTO messages (conversation_id, role, content_type, quality_tier, model_id, generation_seed, content, image_url, image_mime_type, estimated_cost)
         VALUES (?, 'model', 'image', ?, ?, ?, '', ?, ?, ?)`,
        [
          data.conversationId,
          data.qualityTier,
          data.modelDbId,
          generatedImage.seed ?? null,
          uploadResult.url,
          generatedImage.mimeType,
          costPerImage,
        ]
      );

      totalCost += costPerImage;
      imageMessages.push({ id: modelResult.insertId, imageUrl: uploadResult.url });

      publish({
        type: "image",
        imageUrl: uploadResult.url,
        mimeType: generatedImage.mimeType,
        seed: generatedImage.seed,
        estimatedCost: costPerImage,
        imageIndex: i,
      });
    }

    await pool.execute(
      `UPDATE conversations SET total_estimated_cost = total_estimated_cost + ? WHERE id = ?`,
      [totalCost, data.conversationId]
    );

    // Generate title before completing
    if (data.needsTitle) {
      try {
        const title = await generateConversationTitle(data.content, data.labels);
        await pool.execute("UPDATE conversations SET title = ? WHERE id = ?", [title, data.conversationId]);
        publish({ type: "title", title });
        console.log(`[${WORKER_NAME}] Generated title: ${title}`);
      } catch (err) {
        console.error(`[${WORKER_NAME}] Error generating title:`, err);
      }
    }

    publish({
      type: "complete",
      id: imageMessages[0].id,
      imageUrl: imageMessages[0].imageUrl,
      seed: generatedImages[0].seed,
      estimatedCost: totalCost,
      imageMessages,
    });

  } catch (error) {
    console.error(`[${WORKER_NAME}] Imagen job error:`, error);
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";

    try {
      const [modelResult] = await pool.execute<ResultSetHeader>(
        `INSERT INTO messages (conversation_id, role, content_type, content)
         VALUES (?, 'model', 'error', ?)`,
        [data.conversationId, `Error generando imagen: ${errorMessage}`]
      );
      publish({ type: "error", message: errorMessage, id: modelResult.insertId });
    } catch (dbErr) {
      console.error(`[${WORKER_NAME}] Error saving error:`, dbErr);
      publish({ type: "error", message: errorMessage });
    }

    throw error;
  } finally {
    pubRedis.disconnect();
  }
}

// ============================================
// START WORKER
// ============================================

console.log(`[${WORKER_NAME}] Starting with concurrency=${CONCURRENCY}, redis=${REDIS_URL}`);

const worker = new Worker<StreamJobData>(
  STREAM_QUEUE_NAME,
  processStreamJob,
  {
    connection: new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      keepAlive: 30000,
      connectTimeout: 30000,
      retryStrategy(times: number) { return Math.min(times * 500, 15000); },
    }) as never,
    concurrency: CONCURRENCY,
    lockDuration: 120000,      // 2 min lock (default 30s too short for long generations)
    lockRenewTime: 30000,      // Renew lock every 30s (default is lockDuration/2)
    stalledInterval: 120000,   // Check stalled jobs every 2 min
  }
);

worker.on("completed", (job) => {
  console.log(`[${WORKER_NAME}] ✓ Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[${WORKER_NAME}] ✗ Job ${job?.id} failed: ${err.message}`);
});

worker.on("error", (err) => {
  console.error(`[${WORKER_NAME}] Stream error:`, err);
});

// Imagen worker (same process, separate queue)
const imagenWorker = new Worker<ImagenJobData>(
  IMAGEN_QUEUE_NAME,
  processImagenJob,
  {
    connection: new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      keepAlive: 30000,
      connectTimeout: 30000,
      retryStrategy(times: number) { return Math.min(times * 500, 15000); },
    }) as never,
    concurrency: CONCURRENCY,
    lockDuration: 300000,      // 5 min lock (4K images can take several minutes)
    lockRenewTime: 60000,      // Renew lock every 60s
    stalledInterval: 300000,   // Check stalled jobs every 5 min
  }
);

imagenWorker.on("completed", (job) => {
  console.log(`[${WORKER_NAME}] ✓ Imagen job ${job.id} completed`);
});

imagenWorker.on("failed", (job, err) => {
  console.error(`[${WORKER_NAME}] ✗ Imagen job ${job?.id} failed: ${err.message}`);
});

imagenWorker.on("error", (err) => {
  console.error(`[${WORKER_NAME}] Imagen error:`, err);
});

console.log(`[${WORKER_NAME}] Ready and waiting for jobs (stream + imagen)...`);

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[Worker] SIGTERM received, shutting down...");
  await worker.close();
  await imagenWorker.close();
  await pool.end();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[Worker] SIGINT received, shutting down...");
  await worker.close();
  await imagenWorker.close();
  await pool.end();
  process.exit(0);
});
