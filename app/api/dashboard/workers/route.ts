import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Queue } from "bullmq";
import { isRedisConfigured, createRedisConnection } from "@/lib/redis";
import { STREAM_QUEUE_NAME, type StreamJobData } from "@/lib/queue";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    if (!isRedisConfigured()) {
      return NextResponse.json({
        configured: false,
        queue: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
        activeJobs: [],
        failedJobs: [],
      });
    }

    const connection = createRedisConnection();

    try {
      const queue = new Queue<StreamJobData>(STREAM_QUEUE_NAME, {
        connection: connection as never,
      });

      const counts = await queue.getJobCounts(
        "waiting",
        "active",
        "completed",
        "failed",
        "delayed"
      );

      const activeJobsRaw = await queue.getJobs(["active"]);
      const activeJobs = activeJobsRaw.map((job) => ({
        id: job.id,
        model: job.data.modelId,
        conversationId: job.data.conversationId,
        generationType: job.data.generationType,
        qualityTier: job.data.qualityTier,
        user: job.data.labels?.user_name || "—",
        worker: job.data.workerName || "—",
        startedAt: job.processedOn || null,
      }));

      const failedJobsRaw = await queue.getJobs(["failed"], 0, 9);
      const failedJobs = failedJobsRaw.map((job) => ({
        id: job.id,
        model: job.data.modelId,
        error: job.failedReason || "Unknown error",
        failedAt: job.finishedOn || null,
      }));

      // Get connected workers via Redis CLIENT LIST
      // BullMQ names worker connections as "bull:<base64-encoded-queue-name>"
      // and they use the blocking command "bzpopmin"
      const queueNameB64 = Buffer.from(STREAM_QUEUE_NAME).toString("base64");
      const clientList = await connection.client("LIST") as string;
      const workerCount = clientList
        .split("\n")
        .filter((line) => line.includes(`name=bull:${queueNameB64}`) && line.includes("cmd=bzpopmin"))
        .length;

      await queue.close();

      return NextResponse.json({
        configured: true,
        workers: workerCount,
        queue: {
          waiting: counts.waiting || 0,
          active: counts.active || 0,
          completed: counts.completed || 0,
          failed: counts.failed || 0,
          delayed: counts.delayed || 0,
        },
        activeJobs,
        failedJobs,
      });
    } finally {
      await connection.quit();
    }
  } catch (error) {
    console.error("Error fetching worker stats:", error);
    return NextResponse.json(
      { error: "Error al obtener estado de workers" },
      { status: 500 }
    );
  }
}
