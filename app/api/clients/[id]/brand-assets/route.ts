// POST /api/clients/[id]/brand-assets — trae de practicante el kit de marca
// del cliente (BRAND_ASSETS: logos, íconos y patrones oficiales; sin modelo,
// 1–3 s, sin costo) y lo vuelca al brand kit de la marca en nanano
// (lib/production/brand-assets.ts). Devuelve qué se agregó.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { syncBrandAssets } from "@/lib/production/brand-assets";

interface ClientRow extends RowDataPacket {
  id: number;
  slug: string | null;
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const id = Number((await params).id);
    const [rows] = await pool.execute<ClientRow[]>("SELECT id, slug FROM clients WHERE id = ?", [id]);
    const row = rows[0];
    if (!row) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    if (!row.slug) {
      return NextResponse.json({ error: "El cliente no tiene slug (Clientes → Editar)" }, { status: 400 });
    }
    const result = await syncBrandAssets({
      clientId: id,
      clientSlug: row.slug,
      userEmail: session.user.email ?? process.env.PRACTICANTE_USER_EMAIL ?? "",
      userId: Number(session.user.id),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error trayendo el kit de marca:", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
