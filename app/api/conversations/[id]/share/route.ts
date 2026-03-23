import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import crypto from "crypto";

const BASE_URL = process.env.NEXTAUTH_URL || "https://puerto.studio";

// GET - Share status + visit count
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
    const conversationId = parseInt(id);

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT c.share_token, c.shared_at,
        (SELECT COUNT(*) FROM share_visits sv WHERE sv.conversation_id = c.id) as visit_count
       FROM conversations c WHERE c.id = ?`,
      [conversationId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const conv = rows[0];
    const isShared = !!conv.share_token;

    return NextResponse.json({
      is_shared: isShared,
      share_token: conv.share_token || null,
      share_url: isShared ? `${BASE_URL}/share/${conv.share_token}` : null,
      visit_count: conv.visit_count || 0,
      shared_at: conv.shared_at || null,
    });
  } catch (error) {
    console.error("Error getting share status:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Enable sharing (generate token)
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
    const conversationId = parseInt(id);

    // Check conversation exists and get current share state
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, share_token FROM conversations WHERE id = ? AND deleted_at IS NULL`,
      [conversationId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    // If already shared, return existing token
    if (rows[0].share_token) {
      return NextResponse.json({
        share_token: rows[0].share_token,
        share_url: `${BASE_URL}/share/${rows[0].share_token}`,
      });
    }

    // Generate crypto-random token (256 bits)
    const token = crypto.randomBytes(32).toString("base64url");

    await pool.execute<ResultSetHeader>(
      `UPDATE conversations SET share_token = ?, shared_at = NOW() WHERE id = ?`,
      [token, conversationId]
    );

    return NextResponse.json({
      share_token: token,
      share_url: `${BASE_URL}/share/${token}`,
    });
  } catch (error) {
    console.error("Error enabling share:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE - Revoke sharing
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const conversationId = parseInt(id);

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE conversations SET share_token = NULL, shared_at = NULL WHERE id = ?`,
      [conversationId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error revoking share:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
