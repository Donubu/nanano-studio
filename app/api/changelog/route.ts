import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface ChangelogRow extends RowDataPacket {
  id: number;
  version: string;
  title: string;
  content: string;
  image_url: string | null;
  published_at: string;
  seen_count: number;
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const [rows] = await pool.query<ChangelogRow[]>(
    `SELECT c.*,
       (SELECT COUNT(*) FROM user_changelog_seen WHERE changelog_id = c.id) as seen_count
     FROM changelogs c
     ORDER BY c.published_at DESC`
  );

  return NextResponse.json({ changelogs: rows });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { version, title, content, image_url } = await request.json();

  if (!version || !title || !content) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO changelogs (version, title, content, image_url) VALUES (?, ?, ?, ?)`,
    [version, title, content, image_url || null]
  );

  return NextResponse.json({ id: result.insertId });
}
