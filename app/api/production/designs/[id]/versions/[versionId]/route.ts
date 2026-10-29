// Una versión del design.
//
//   PATCH /api/production/designs/[id]/versions/[versionId]  { label?, notes? }
//   POST  /api/production/designs/[id]/versions/[versionId]  { action: "restore" }
//         vuelve el design a esa versión (antes guarda un respaldo pre_restore).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { restoreDesignVersion, updateDesignVersionNotes } from "@/lib/production/design-versions";

const patchSchema = z.object({
  label: z.string().max(150).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

const postSchema = z.object({ action: z.literal("restore") });

async function ids(params: Promise<{ id: string; versionId: string }>) {
  const p = await params;
  const designId = Number(p.id);
  const versionId = Number(p.versionId);
  return Number.isFinite(designId) && Number.isFinite(versionId) ? { designId, versionId } : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const i = await ids(params);
    if (!i) return NextResponse.json({ error: "Ids inválidos" }, { status: 400 });
    const parsed = await parseBody(request, patchSchema);
    if (parsed.error) return parsed.error;
    const { label, notes } = parsed.data;
    await updateDesignVersionNotes({ ...i, label, notes });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error actualizando versión:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const i = await ids(params);
    if (!i) return NextResponse.json({ error: "Ids inválidos" }, { status: 400 });
    const parsed = await parseBody(request, postSchema);
    if (parsed.error) return parsed.error;
    const result = await restoreDesignVersion({ ...i, userId: Number(session.user.id) });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error restaurando versión:", error);
    return NextResponse.json({ error: (error as Error).message || "Error interno del servidor" }, { status: 500 });
  }
}
