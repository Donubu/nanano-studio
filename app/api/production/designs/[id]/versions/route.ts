// Versiones de un design (lib/production/design-versions.ts).
//
//   GET  /api/production/designs/[id]/versions
//        → { versions, latest, changed_since_latest }
//   POST /api/production/designs/[id]/versions  { label?, notes? }
//        → congela el estado actual como vN (status en_revision)

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { createDesignVersion, listDesignVersions } from "@/lib/production/design-versions";

const bodySchema = z.object({
  label: z.string().max(150).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

async function designExists(id: number): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>("SELECT id FROM production_designs WHERE id = ? AND deleted_at IS NULL", [id]);
  return rows.length > 0;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const designId = Number((await params).id);
    if (!Number.isFinite(designId)) return NextResponse.json({ error: "Design inválido" }, { status: 400 });
    if (!(await designExists(designId))) return NextResponse.json({ error: "Design no encontrado" }, { status: 404 });
    return NextResponse.json(await listDesignVersions(designId));
  } catch (error) {
    console.error("Error listando versiones:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const designId = Number((await params).id);
    if (!Number.isFinite(designId)) return NextResponse.json({ error: "Design inválido" }, { status: 400 });
    if (!(await designExists(designId))) return NextResponse.json({ error: "Design no encontrado" }, { status: 404 });
    const parsed = await parseBody(request, bodySchema);
    if (parsed.error) return parsed.error;
    const version = await createDesignVersion({
      designId,
      userId: Number(session.user.id),
      label: parsed.data.label,
      notes: parsed.data.notes,
    });
    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    console.error("Error creando versión:", error);
    return NextResponse.json({ error: (error as Error).message || "Error interno del servidor" }, { status: 500 });
  }
}
