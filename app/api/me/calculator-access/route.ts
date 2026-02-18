import { NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const userId = (session.user as { id: number }).id;

  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT ai_calculator_access FROM users WHERE id = ?",
    [userId]
  );

  const hasAccess = rows.length > 0 && rows[0].ai_calculator_access === 1;

  return NextResponse.json({ hasAccess });
}
