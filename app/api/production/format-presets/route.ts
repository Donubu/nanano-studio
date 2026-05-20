import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface FormatPresetRow extends RowDataPacket {
  id: number;
  channel: string;
  group_name: string | null;
  name: string;
  width: number;
  height: number;
  orientation: "horizontal" | "vertical" | "square";
  file_size_max_kb: number | null;
  is_system: number;
  client_id: number | null;
  sort_order: number;
}

// GET - List format presets. Returns all system presets + custom presets for a client.
// Query params:
//   - channel: filter by channel
//   - client_id: include client-specific custom presets
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const channel = searchParams.get("channel");
    const clientId = searchParams.get("client_id");

    const where: string[] = [];
    const values: (string | number)[] = [];

    if (clientId) {
      where.push("(is_system = 1 OR client_id = ?)");
      values.push(Number(clientId));
    } else {
      where.push("is_system = 1");
    }
    if (channel) {
      where.push("channel = ?");
      values.push(channel);
    }

    const [rows] = await pool.execute<FormatPresetRow[]>(
      `SELECT id, channel, group_name, name, width, height, orientation,
              file_size_max_kb, is_system, client_id, sort_order
         FROM production_format_presets
        WHERE ${where.join(" AND ")}
        ORDER BY channel ASC, sort_order ASC, name ASC`,
      values
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error listando format_presets:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
