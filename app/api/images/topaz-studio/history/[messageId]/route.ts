import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";

interface TopazEdit {
  id: number;
  message_id: number;
  original_url: string;
  result_url: string;
  model: string;
  scale_factor: number;
  input_width: number;
  input_height: number;
  output_width: number;
  output_height: number;
  output_megapixels: number;
  parameters: Record<string, unknown> | null;
  credits_consumed: number;
  processing_time_ms: number | null;
  output_format: string;
  output_file_size: number | null;
  created_at: string;
}

// GET - Get all Topaz edits for a message
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

    const [rows] = await pool.execute<any[]>(
      `SELECT
        id, message_id, original_url, result_url, model, scale_factor,
        input_width, input_height, output_width, output_height, output_megapixels,
        parameters, credits_consumed, processing_time_ms, output_format, output_file_size,
        created_at
      FROM topaz_edits
      WHERE message_id = ?
      ORDER BY created_at DESC`,
      [messageIdNum]
    );

    // Parse JSON parameters
    const edits: TopazEdit[] = rows.map(row => ({
      ...row,
      parameters: row.parameters ? JSON.parse(row.parameters) : null,
      scale_factor: parseFloat(row.scale_factor),
      output_megapixels: parseFloat(row.output_megapixels),
    }));

    // Calculate totals
    const totalCredits = edits.reduce((sum, edit) => sum + edit.credits_consumed, 0);

    return NextResponse.json({
      messageId: messageIdNum,
      edits,
      totalEdits: edits.length,
      totalCredits,
    });

  } catch (error) {
    console.error("[Topaz Studio History] Error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
