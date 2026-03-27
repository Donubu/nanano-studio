import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface ConversationCheckRow extends RowDataPacket {
  id: number;
  user_id: number;
}

interface ExecutionRow extends RowDataPacket {
  id: number;
  node_id: string;
  node_type: string;
  run_id: string | null;
  model_name: string | null;
  status: string;
  duration_ms: number;
  error_message: string | null;
  output_message_id: number | null;
  created_at: Date;
}

interface StatsRow extends RowDataPacket {
  node_id: string;
  node_type: string;
  total_runs: number;
  avg_duration_ms: number;
  min_duration_ms: number;
  max_duration_ms: number;
  success_count: number;
  error_count: number;
  last_run: Date;
}

interface RunStatsRow extends RowDataPacket {
  run_id: string;
  total_nodes: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  completed_nodes: number;
  error_nodes: number;
  started_at: Date;
}

// GET - Get execution history and stats
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const isAdmin = session.user.role === "admin";

    const [convRows] = await pool.execute<ConversationCheckRow[]>(
      `SELECT id, user_id FROM conversations WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (convRows.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "history"; // history | stats | runs

    if (view === "stats") {
      // Per-node stats
      const [rows] = await pool.execute<StatsRow[]>(
        `SELECT
          node_id, node_type,
          COUNT(*) as total_runs,
          ROUND(AVG(duration_ms)) as avg_duration_ms,
          MIN(duration_ms) as min_duration_ms,
          MAX(duration_ms) as max_duration_ms,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success_count,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
          MAX(created_at) as last_run
        FROM canvas_executions
        WHERE conversation_id = ?
        GROUP BY node_id, node_type
        ORDER BY last_run DESC`,
        [id]
      );
      return NextResponse.json({ stats: rows });
    }

    if (view === "runs") {
      // Run All summaries
      const [rows] = await pool.execute<RunStatsRow[]>(
        `SELECT
          run_id,
          COUNT(*) as total_nodes,
          SUM(duration_ms) as total_duration_ms,
          ROUND(AVG(duration_ms)) as avg_duration_ms,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_nodes,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_nodes,
          MIN(created_at) as started_at
        FROM canvas_executions
        WHERE conversation_id = ? AND run_id IS NOT NULL
        GROUP BY run_id
        ORDER BY started_at DESC
        LIMIT 20`,
        [id]
      );
      return NextResponse.json({ runs: rows });
    }

    // Default: recent execution history
    const limit = searchParams.get("limit") || "50";
    const nodeId = searchParams.get("node_id");

    const whereExtra = nodeId ? "AND node_id = ?" : "";
    const params2 = nodeId ? [id, nodeId, Number(limit)] : [id, Number(limit)];

    const [rows] = await pool.execute<ExecutionRow[]>(
      `SELECT * FROM canvas_executions
       WHERE conversation_id = ? ${whereExtra}
       ORDER BY created_at DESC
       LIMIT ?`,
      params2
    );
    return NextResponse.json({ executions: rows });
  } catch (error) {
    console.error("Error fetching canvas executions:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Record a new execution
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { node_id, node_type, run_id, model_name, status, duration_ms, error_message, output_message_id } = body as {
      node_id: string;
      node_type: string;
      run_id?: string | null;
      model_name?: string | null;
      status: "completed" | "error";
      duration_ms: number;
      error_message?: string | null;
      output_message_id?: number | null;
    };

    await pool.execute(
      `INSERT INTO canvas_executions (conversation_id, node_id, node_type, run_id, model_name, status, duration_ms, error_message, output_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, node_id, node_type, run_id || null, model_name || null, status, duration_ms, error_message || null, output_message_id || null]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error recording canvas execution:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
