// Guía de marca del cliente (snapshot traído de practicante).
//
//   GET  /api/clients/[id]/brand-guide  → { slug, guide, synced_at }
//   POST /api/clients/[id]/brand-guide  → sincroniza ahora desde practicante
//        usando el slug del cliente y devuelve lo mismo que GET.
//
// Mientras practicante no exponga un endpoint dedicado, la sincronización
// va a /api/external/run (orquestador, que tiene las tools brandbook_<slug>)
// con el prompt de lib/production/brand-guide.ts y pide JSON. Puede tardar
// varios minutos (búsqueda en el brandbook): por eso NO se llama durante una
// generación, solo acá, a pedido.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { callPracticante } from "@/lib/production/banner-designer";
import { brandGuidePrompt, parseBrandGuide, BrandGuide } from "@/lib/production/brand-guide";

export const maxDuration = 300;

interface ClientGuideRow extends RowDataPacket {
  id: number;
  slug: string | null;
  brand_guide_json: string | BrandGuide | null;
  brand_guide_synced_at: Date | string | null;
}

async function loadRow(id: number): Promise<ClientGuideRow | null> {
  const [rows] = await pool.execute<ClientGuideRow[]>(
    "SELECT id, slug, brand_guide_json, brand_guide_synced_at FROM clients WHERE id = ?",
    [id],
  );
  return rows[0] ?? null;
}

function toBody(row: ClientGuideRow) {
  const raw = row.brand_guide_json;
  const guide = raw == null ? null : typeof raw === "string" ? (JSON.parse(raw) as BrandGuide) : raw;
  return { slug: row.slug, guide, synced_at: row.brand_guide_synced_at };
}

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") return null;
  return session;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const row = await loadRow(Number((await params).id));
  if (!row) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  return NextResponse.json(toBody(row));
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const id = Number((await params).id);
    const row = await loadRow(id);
    if (!row) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    if (!row.slug) {
      return NextResponse.json(
        { error: "El cliente no tiene slug. Agrégalo (el mismo que usa en practicante) y vuelve a sincronizar." },
        { status: 400 },
      );
    }

    const { message, promptSuffix } = brandGuidePrompt(row.slug);
    const res = await callPracticante({
      message,
      promptSuffix,
      userEmail: session.user.email ?? process.env.PRACTICANTE_USER_EMAIL ?? "",
    });
    const guide = parseBrandGuide(res.response ?? "");
    if (!guide) {
      const preview = (res.response ?? "").replace(/\s+/g, " ").slice(0, 300);
      return NextResponse.json(
        {
          error: `Practicante no devolvió una guía de marca utilizable para "${row.slug}". ${preview ? `Respuesta: ${preview}` : ""}`,
        },
        { status: 502 },
      );
    }

    await pool.execute(
      "UPDATE clients SET brand_guide_json = ?, brand_guide_synced_at = NOW() WHERE id = ?",
      [JSON.stringify(guide), id],
    );
    const updated = await loadRow(id);
    return NextResponse.json({ ...toBody(updated!), tokenUsage: res.tokenUsage ?? null });
  } catch (error) {
    console.error("Error sincronizando guía de marca:", error);
    return NextResponse.json(
      { error: `No se pudo sincronizar con practicante: ${(error as Error).message}` },
      { status: 502 },
    );
  }
}
