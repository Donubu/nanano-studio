import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface TopazVideoEdit extends RowDataPacket {
  id: number;
  message_id: number;
  topaz_request_id: string;
  original_url: string;
  result_url: string | null;
  model: string;
  model_name: string;
  input_duration: number;
  input_width: number | null;
  input_height: number | null;
  output_duration: number | null;
  output_width: number | null;
  output_height: number | null;
  output_file_size: number | null;
  parameters: string | null;
  credits_estimated: number;
  credits_consumed: number | null;
  status: string;
  error_message: string | null;
  processing_time_ms: number | null;
  created_at: Date;
}

/**
 * GET - Get video enhancement history for a message
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { messageId } = await params;
    const messageIdNum = parseInt(messageId);

    if (isNaN(messageIdNum)) {
      return NextResponse.json({ error: "messageId inválido" }, { status: 400 });
    }

    // Get all edits for this message
    const [rows] = await pool.execute<TopazVideoEdit[]>(
      `SELECT * FROM topaz_video_edits WHERE message_id = ? ORDER BY created_at DESC`,
      [messageIdNum]
    );

    // Calculate totals
    const edits = rows.map(edit => ({
      id: edit.id,
      requestId: edit.topaz_request_id,
      originalUrl: edit.original_url,
      resultUrl: edit.result_url,
      model: edit.model,
      modelName: edit.model_name,
      inputDuration: edit.input_duration,
      inputWidth: edit.input_width,
      inputHeight: edit.input_height,
      outputDuration: edit.output_duration,
      outputWidth: edit.output_width,
      outputHeight: edit.output_height,
      outputFileSize: edit.output_file_size,
      parameters: edit.parameters ? JSON.parse(edit.parameters) : null,
      creditsEstimated: edit.credits_estimated,
      creditsConsumed: edit.credits_consumed,
      status: edit.status,
      errorMessage: edit.error_message,
      processingTimeMs: edit.processing_time_ms,
      createdAt: edit.created_at,
    }));

    const totalCredits = edits.reduce((sum, edit) =>
      sum + (edit.creditsConsumed || edit.creditsEstimated), 0
    );

    const completedEdits = edits.filter(e => e.status === "completed").length;
    const processingEdits = edits.filter(e => e.status === "processing").length;

    return NextResponse.json({
      messageId: messageIdNum,
      edits,
      totalEdits: edits.length,
      completedEdits,
      processingEdits,
      totalCredits,
    });

  } catch (error) {
    console.error("Error fetching video history:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    );
  }
}
