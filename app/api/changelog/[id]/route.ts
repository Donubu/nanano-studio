import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { ResultSetHeader } from "mysql2";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const { version, title, content, image_url } = await request.json();

  if (!version || !title || !content) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  await pool.query<ResultSetHeader>(
    `UPDATE changelogs SET version = ?, title = ?, content = ?, image_url = ? WHERE id = ?`,
    [version, title, content, image_url || null, id]
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;

  await pool.query(`DELETE FROM user_changelog_seen WHERE changelog_id = ?`, [id]);
  await pool.query(`DELETE FROM changelogs WHERE id = ?`, [id]);

  return NextResponse.json({ ok: true });
}
