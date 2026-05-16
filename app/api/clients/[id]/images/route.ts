import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface ImageRow extends RowDataPacket {
  source: "generation" | "upload";
  id: number;
  url: string;
  created_at: string;
  project_id: number;
  project_title: string;
  conversation_title: string | null;
}

interface CountRow extends RowDataPacket {
  total: number;
}

// GET - Lista de imágenes del cliente (generadas AI + project_uploads) para
// el image picker del editor de templates. Admin ve todo; usuarios solo
// proyectos no-hidden (mismo gate que /api/projects).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: clientIdRaw } = await params;
    const clientId = Number(clientIdRaw);
    if (!Number.isFinite(clientId) || clientId <= 0) {
      return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 60, 1), 200);
    const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);
    const q = searchParams.get("q")?.trim() || "";

    const isAdmin = session.user.role === "admin";
    const userId = session.user.id;

    // Gate por proyecto: admin → cualquier proyecto del cliente; usuario →
    // proyectos no hidden o sus proyectos personales (mismo criterio que
    // /api/projects).
    const projectGate = isAdmin
      ? "p.client_id = ?"
      : "p.client_id = ? AND (p.hidden = 0 OR (p.is_personal = 1 AND p.owner_user_id = ?))";
    const projectGateParams: (string | number)[] = isAdmin
      ? [clientId]
      : [clientId, userId as string | number];

    // Search se aplica sobre el título de la conversación / proyecto /
    // filename del upload. Si q viene vacío no se agrega.
    const generationSearch = q ? "AND (c.title LIKE ? OR p.title LIKE ?)" : "";
    const generationSearchParams = q ? [`%${q}%`, `%${q}%`] : [];
    const uploadSearch = q ? "AND (pu.original_filename LIKE ? OR p.title LIKE ?)" : "";
    const uploadSearchParams = q ? [`%${q}%`, `%${q}%`] : [];

    const unionSql = `
      SELECT
        'generation' AS source,
        m.id AS id,
        m.image_url AS url,
        m.created_at AS created_at,
        p.id AS project_id,
        p.title AS project_title,
        c.title AS conversation_title
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      JOIN projects p ON c.project_id = p.id
      WHERE ${projectGate}
        AND m.role = 'model'
        AND m.image_url IS NOT NULL AND m.image_url != ''
        AND m.deleted_at IS NULL
        AND c.deleted_at IS NULL
        ${generationSearch}

      UNION ALL

      SELECT
        'upload' AS source,
        pu.id AS id,
        pu.image_url AS url,
        pu.created_at AS created_at,
        p.id AS project_id,
        p.title AS project_title,
        NULL AS conversation_title
      FROM project_uploads pu
      JOIN projects p ON pu.project_id = p.id
      WHERE ${projectGate}
        ${uploadSearch}
    `;

    const baseParams: (string | number)[] = [
      ...projectGateParams,
      ...generationSearchParams,
      ...projectGateParams,
      ...uploadSearchParams,
    ];

    const [countRows] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS total FROM (${unionSql}) AS combined`,
      baseParams
    );
    const total = Number(countRows[0]?.total ?? 0);

    const [rows] = await pool.execute<ImageRow[]>(
      `${unionSql} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      baseParams
    );

    const items = rows.map((r) => ({
      source: r.source,
      id: r.id,
      url: r.url,
      created_at: r.created_at,
      project_id: r.project_id,
      project_title: r.project_title,
      conversation_title: r.conversation_title,
    }));

    return NextResponse.json({
      items,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      },
    });
  } catch (error) {
    console.error("Error obteniendo imágenes del cliente:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
