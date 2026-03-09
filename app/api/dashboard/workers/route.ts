import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Queue } from "bullmq";
import { isRedisConfigured, createRedisConnection } from "@/lib/redis";
import { STREAM_QUEUE_NAME, type StreamJobData, IMAGEN_QUEUE_NAME, type ImagenJobData } from "@/lib/queue";

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
      const streamQueue = new Queue<StreamJobData>(STREAM_QUEUE_NAME, {
        connection: connection as never,
      });
      const imagenQueue = new Queue<ImagenJobData>(IMAGEN_QUEUE_NAME, {
        connection: connection as never,
      });

      // Get counts from both queues
      const [streamCounts, imagenCounts] = await Promise.all([
        streamQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
        imagenQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
      ]);

      const counts = {
        waiting: (streamCounts.waiting || 0) + (imagenCounts.waiting || 0),
        active: (streamCounts.active || 0) + (imagenCounts.active || 0),
        completed: (streamCounts.completed || 0) + (imagenCounts.completed || 0),
        failed: (streamCounts.failed || 0) + (imagenCounts.failed || 0),
        delayed: (streamCounts.delayed || 0) + (imagenCounts.delayed || 0),
      };

      // Active jobs from both queues
      const [streamActiveRaw, imagenActiveRaw] = await Promise.all([
        streamQueue.getJobs(["active"]),
        imagenQueue.getJobs(["active"]),
      ]);

      const mapActiveJob = (job: { id?: string; data: { modelId: string; conversationId: string; generationType?: string; labels?: { user_name?: string; project_name?: string }; workerName?: string }; processedOn?: number }, queueLabel: string) => ({
        id: job.id,
        queue: queueLabel,
        model: job.data.modelId,
        conversationId: job.data.conversationId,
        generationType: job.data.generationType || queueLabel,
        project: job.data.labels?.project_name || "—",
        user: job.data.labels?.user_name || "—",
        worker: job.data.workerName || "—",
        startedAt: job.processedOn || null,
      });

      const activeJobs = [
        ...streamActiveRaw.filter((j) => j?.data).map((j) => mapActiveJob(j, "stream")),
        ...imagenActiveRaw.filter((j) => j?.data).map((j) => mapActiveJob(j as never, "imagen")),
      ];

      // Completed jobs from both queues (most recent 20 combined)
      const [streamCompletedRaw, imagenCompletedRaw] = await Promise.all([
        streamQueue.getJobs(["completed"], 0, 19),
        imagenQueue.getJobs(["completed"], 0, 19),
      ]);

      const mapCompletedJob = (job: { id?: string; data?: { modelId?: string; generationType?: string; labels?: { user_name?: string; project_name?: string }; workerName?: string }; finishedOn?: number; processedOn?: number }, queueLabel: string) => ({
        id: job.id,
        queue: queueLabel,
        model: job.data?.modelId || "—",
        generationType: job.data?.generationType || queueLabel,
        user: job.data?.labels?.user_name || "—",
        project: job.data?.labels?.project_name || "—",
        completedAt: job.finishedOn || null,
        duration: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
      });

      const completedJobs = [
        ...streamCompletedRaw.filter((j) => j?.data).map((j) => mapCompletedJob(j, "stream")),
        ...imagenCompletedRaw.filter((j) => j?.data).map((j) => mapCompletedJob(j as never, "imagen")),
      ]
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
        .slice(0, 20);

      // Failed jobs from both queues (most recent 20 combined)
      const [streamFailedRaw, imagenFailedRaw] = await Promise.all([
        streamQueue.getJobs(["failed"], 0, 19),
        imagenQueue.getJobs(["failed"], 0, 19),
      ]);

      const mapFailedJob = (job: { id?: string; data?: { modelId?: string; generationType?: string; qualityTier?: string; labels?: { user_name?: string; project_name?: string } }; failedReason?: string; finishedOn?: number }, queueLabel: string) => ({
        id: job.id,
        queue: queueLabel,
        model: job.data?.modelId || "—",
        generationType: job.data?.generationType || queueLabel,
        user: job.data?.labels?.user_name || "—",
        project: job.data?.labels?.project_name || "—",
        error: job.failedReason || "Unknown error",
        failedAt: job.finishedOn || null,
      });

      const failedJobs = [
        ...streamFailedRaw.filter((j) => j?.data).map((j) => mapFailedJob(j, "stream")),
        ...imagenFailedRaw.filter((j) => j?.data).map((j) => mapFailedJob(j as never, "imagen")),
      ]
        .sort((a, b) => (b.failedAt || 0) - (a.failedAt || 0))
        .slice(0, 20);

      // Count unique worker processes across both queues
      // Each worker process creates 2 BullMQ Workers (stream + imagen), each with a bzpopmin connection
      // So we count total bzpopmin connections and divide by 2 to get actual worker processes
      const clientList = await connection.client("LIST") as string;
      const clientLines = clientList.split("\n");
      const streamB64 = Buffer.from(STREAM_QUEUE_NAME).toString("base64");
      const imagenB64 = Buffer.from(IMAGEN_QUEUE_NAME).toString("base64");
      const bzpopminCount = clientLines.filter((line) =>
        (line.includes(`name=bull:${streamB64}`) || line.includes(`name=bull:${imagenB64}`))
        && line.includes("cmd=bzpopmin")
      ).length;
      const workerCount = Math.ceil(bzpopminCount / 2);

      await streamQueue.close();
      await imagenQueue.close();

      return NextResponse.json({
        configured: true,
        workers: workerCount,
        queue: counts,
        activeJobs,
        completedJobs,
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
