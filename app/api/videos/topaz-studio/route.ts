import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { ResultSetHeader } from "mysql2";
import {
  TOPAZ_VIDEO_MODELS,
  calculateTopazVideoCredits,
  getTopazVideoModelName,
  createVideoEnhancement,
  acceptVideoRequest,
  type TopazVideoModel,
  type TopazVideoParameters,
} from "@/lib/topaz-video";

const TOPAZ_API_KEY = process.env.TOPAZ_API_KEY || "";

interface TopazVideoStudioRequest {
  videoUrl: string;
  messageId: number;
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  fileSize?: number;
  model: TopazVideoModel;
  parameters?: TopazVideoParameters;
}

/**
 * POST - Create a video enhancement job
 * Returns requestId and uploadUrl for client to upload video
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (!TOPAZ_API_KEY) {
      return NextResponse.json({ error: "Topaz API no configurada" }, { status: 500 });
    }

    const body: TopazVideoStudioRequest = await request.json();
    const {
      videoUrl,
      messageId,
      duration,
      width,
      height,
      fps,
      fileSize,
      model,
      parameters = {},
    } = body;

    // Validate required fields
    if (!videoUrl || !messageId || !duration || !model) {
      return NextResponse.json({
        error: "Parámetros requeridos: videoUrl, messageId, duration, model"
      }, { status: 400 });
    }

    // Validate model
    if (!TOPAZ_VIDEO_MODELS[model]) {
      return NextResponse.json({
        error: `Modelo inválido: ${model}`
      }, { status: 400 });
    }

    // Calculate credits
    const creditsInfo = calculateTopazVideoCredits(duration, model, parameters);
    const { credits, outputDuration } = creditsInfo;

    // Determine container from URL or default to mp4
    const urlLower = videoUrl.toLowerCase();
    let container: "mp4" | "mov" | "avi" | "mkv" | "webm" = "mp4";
    if (urlLower.includes(".mov")) container = "mov";
    else if (urlLower.includes(".avi")) container = "avi";
    else if (urlLower.includes(".mkv")) container = "mkv";
    else if (urlLower.includes(".webm")) container = "webm";

    // Create request with Topaz API
    let topazResponse;
    try {
      topazResponse = await createVideoEnhancement(
        { apiKey: TOPAZ_API_KEY },
        {
          model,
          parameters,
          sourceMetadata: {
            width: width || 1920,
            height: height || 1080,
            duration: duration,
            frameRate: fps || 30,
            fileSize: fileSize || 0,
            container,
          },
        }
      );
    } catch (err) {
      console.error("Error creating Topaz video request:", err);
      return NextResponse.json({
        error: err instanceof Error ? err.message : "Error creando request en Topaz API"
      }, { status: 500 });
    }

    const { requestId, estimatedCredits } = topazResponse;

    // Accept the request to get upload URL
    let acceptResponse;
    try {
      acceptResponse = await acceptVideoRequest(
        { apiKey: TOPAZ_API_KEY },
        requestId
      );
    } catch (err) {
      console.error("Error accepting Topaz video request:", err);
      return NextResponse.json({
        error: err instanceof Error ? err.message : "Error aceptando request en Topaz API"
      }, { status: 500 });
    }

    const { uploadUrl, uploadId, expiresAt } = acceptResponse;

    // Store in database with 'accepted' status
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO topaz_video_edits (
        message_id, topaz_request_id, original_url, model, model_name,
        input_duration, input_width, input_height, input_fps, input_file_size,
        output_duration, parameters, credits_estimated, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted')`,
      [
        messageId,
        requestId,
        videoUrl,
        model,
        getTopazVideoModelName(model),
        duration,
        width || null,
        height || null,
        fps || null,
        fileSize || null,
        outputDuration,
        JSON.stringify(parameters),
        estimatedCredits || credits,
      ]
    );

    return NextResponse.json({
      requestId,
      editId: result.insertId,
      uploadUrl,
      uploadId,
      expiresAt,
      creditsEstimated: estimatedCredits || credits,
      outputDuration,
    });

  } catch (error) {
    console.error("Error in Topaz Video Studio:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    );
  }
}
