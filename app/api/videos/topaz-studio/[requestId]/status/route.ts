import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { uploadToS3 } from "@/lib/s3";
import { getVideoRequestStatus } from "@/lib/topaz-video";

const TOPAZ_API_KEY = process.env.TOPAZ_API_KEY || "";

interface TopazVideoEdit extends RowDataPacket {
  id: number;
  message_id: number;
  topaz_request_id: string;
  original_url: string;
  result_url: string | null;
  model: string;
  model_name: string;
  status: string;
  input_width: number | null;
  input_height: number | null;
  input_duration: number;
  parameters: string | null;
  credits_estimated: number;
  credits_consumed: number | null;
  processing_started_at: Date | null;
  error_message: string | null;
}

/**
 * GET - Poll for video processing status
 * When completed, downloads result and uploads to S3
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (!TOPAZ_API_KEY) {
      return NextResponse.json({ error: "Topaz API no configurada" }, { status: 500 });
    }

    const { requestId } = await params;

    if (!requestId) {
      return NextResponse.json({ error: "requestId requerido" }, { status: 400 });
    }

    // Get the edit record from database
    const [rows] = await pool.execute<TopazVideoEdit[]>(
      `SELECT * FROM topaz_video_edits WHERE topaz_request_id = ?`,
      [requestId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Request no encontrado" }, { status: 404 });
    }

    const edit = rows[0];

    // If already completed or failed, return cached status
    if (edit.status === "completed") {
      return NextResponse.json({
        status: "completed",
        resultUrl: edit.result_url,
        creditsConsumed: edit.credits_consumed,
      });
    }

    if (edit.status === "failed") {
      return NextResponse.json({
        status: "failed",
        error: edit.error_message,
      });
    }

    if (edit.status === "cancelled") {
      return NextResponse.json({
        status: "cancelled",
      });
    }

    // Poll Topaz API for status
    let topazStatus;
    try {
      topazStatus = await getVideoRequestStatus({ apiKey: TOPAZ_API_KEY }, requestId);
    } catch (err) {
      console.error("Error getting Topaz status:", err);
      return NextResponse.json({
        status: edit.status,
        message: "Checking status...",
      });
    }

    // Handle completed status
    if (topazStatus.status === "completed" && topazStatus.downloadUrl) {
      try {
        // Download the processed video from Topaz
        const videoResponse = await fetch(topazStatus.downloadUrl);
        if (!videoResponse.ok) {
          throw new Error("Failed to download processed video");
        }

        const videoBuffer = await videoResponse.arrayBuffer();
        const videoBytes = new Uint8Array(videoBuffer);

        // Generate result filename
        const originalFileName = edit.original_url.split("/").pop() || "video.mp4";
        const lastDotIndex = originalFileName.lastIndexOf(".");
        const baseName = lastDotIndex === -1 ? originalFileName : originalFileName.slice(0, lastDotIndex);
        const resultFileName = `${baseName}--topaz-${edit.model}.mp4`;

        // Get the S3 path from original URL
        const originalUrlObj = new URL(edit.original_url);
        const pathParts = originalUrlObj.pathname.split("/");
        pathParts[pathParts.length - 1] = resultFileName;
        const s3Key = pathParts.slice(1).join("/"); // Remove leading slash

        // Upload to S3
        const uploadResult = await uploadToS3(
          Buffer.from(videoBytes),
          s3Key,
          "video/mp4"
        );
        const resultUrl = uploadResult.url;

        const processingTimeMs = edit.processing_started_at
          ? Date.now() - new Date(edit.processing_started_at).getTime()
          : null;

        // Calculate output dimensions from input + parameters if Topaz doesn't return them
        let outputWidth = topazStatus.outputWidth ? Math.round(Number(topazStatus.outputWidth)) : null;
        let outputHeight = topazStatus.outputHeight ? Math.round(Number(topazStatus.outputHeight)) : null;

        if ((!outputWidth || !outputHeight) && edit.input_width && edit.input_height) {
          // Get scale factor from parameters
          let scaleFactor = 1;
          if (edit.parameters) {
            try {
              const params = JSON.parse(edit.parameters);
              scaleFactor = params.scaleFactor || 1;
            } catch {
              // Ignore parse errors
            }
          }
          outputWidth = edit.input_width * scaleFactor;
          outputHeight = edit.input_height * scaleFactor;
        }

        const outputDuration = topazStatus.outputDuration
          ? Number(topazStatus.outputDuration).toFixed(2)
          : edit.input_duration.toFixed(2);

        // Update database with result - ensure all numbers are integers
        const updateParams = [
          resultUrl,
          outputWidth,
          outputHeight,
          outputDuration,
          Math.round(videoBytes.length),
          topazStatus.creditsUsed ? Math.round(Number(topazStatus.creditsUsed)) : edit.credits_estimated,
          processingTimeMs ? Math.round(Number(processingTimeMs)) : null,
          requestId,
        ];
        console.log("Update params:", updateParams);

        await pool.execute(
          `UPDATE topaz_video_edits SET
            status = 'completed',
            result_url = ?,
            output_width = ?,
            output_height = ?,
            output_duration = ?,
            output_file_size = ?,
            credits_consumed = ?,
            processing_completed_at = NOW(),
            processing_time_ms = ?
          WHERE topaz_request_id = ?`,
          updateParams
        );

        // Update message topaz_video_credits
        await pool.execute(
          `UPDATE messages SET topaz_video_credits = COALESCE(topaz_video_credits, 0) + ? WHERE id = ?`,
          [topazStatus.creditsUsed || edit.credits_estimated, edit.message_id]
        );

        return NextResponse.json({
          status: "completed",
          resultUrl,
          creditsConsumed: topazStatus.creditsUsed || edit.credits_estimated,
          processingTimeMs,
          outputWidth,
          outputHeight,
        });

      } catch (err) {
        console.error("Error saving processed video:", err);

        // Update status to failed
        await pool.execute(
          `UPDATE topaz_video_edits SET status = 'failed', error_message = ? WHERE topaz_request_id = ?`,
          [err instanceof Error ? err.message : "Error saving video", requestId]
        );

        return NextResponse.json({
          status: "failed",
          error: err instanceof Error ? err.message : "Error guardando video procesado",
        });
      }
    }

    // Handle failed status
    if (topazStatus.status === "failed") {
      await pool.execute(
        `UPDATE topaz_video_edits SET status = 'failed', error_message = ? WHERE topaz_request_id = ?`,
        [topazStatus.message || "Processing failed", requestId]
      );

      return NextResponse.json({
        status: "failed",
        error: topazStatus.message || "Error en procesamiento",
      });
    }

    // Still processing
    return NextResponse.json({
      status: "processing",
      progress: topazStatus.progress ? Math.round(Number(topazStatus.progress)) : 0,
      message: topazStatus.message || "Processing...",
    });

  } catch (error) {
    console.error("Error in status check:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    );
  }
}
