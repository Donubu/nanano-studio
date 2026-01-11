import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { completeVideoUpload } from "@/lib/topaz-video";

const TOPAZ_API_KEY = process.env.TOPAZ_API_KEY || "";

/**
 * POST - Signal that video upload is complete, start processing
 */
export async function POST(
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

    // Get eTag from request body
    let eTag = "";
    try {
      const body = await request.json();
      eTag = body.eTag || "";
    } catch {
      // Body might be empty, that's ok for now
    }

    // Verify the request exists in our database
    const [rows] = await pool.execute(
      `SELECT id, status FROM topaz_video_edits WHERE topaz_request_id = ?`,
      [requestId]
    );

    const edits = rows as { id: number; status: string }[];
    if (edits.length === 0) {
      return NextResponse.json({ error: "Request no encontrado" }, { status: 404 });
    }

    const edit = edits[0];
    if (edit.status !== "accepted" && edit.status !== "uploading") {
      return NextResponse.json({
        error: `Estado inválido: ${edit.status}. Se esperaba 'accepted' o 'uploading'`
      }, { status: 400 });
    }

    // Signal upload complete to Topaz API
    try {
      await completeVideoUpload({ apiKey: TOPAZ_API_KEY }, requestId, eTag);
    } catch (err) {
      console.error("Error completing upload with Topaz:", err);

      // Update status to failed
      await pool.execute(
        `UPDATE topaz_video_edits SET status = 'failed', error_message = ? WHERE topaz_request_id = ?`,
        [err instanceof Error ? err.message : "Error completing upload", requestId]
      );

      return NextResponse.json({
        error: err instanceof Error ? err.message : "Error señalando upload completo"
      }, { status: 500 });
    }

    // Update status to processing
    await pool.execute(
      `UPDATE topaz_video_edits SET status = 'processing', processing_started_at = NOW() WHERE topaz_request_id = ?`,
      [requestId]
    );

    return NextResponse.json({
      success: true,
      status: "processing",
      message: "Video processing started",
    });

  } catch (error) {
    console.error("Error in complete-upload:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    );
  }
}
