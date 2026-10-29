// Una versión del design.
//
//   PATCH /api/production/designs/[id]/versions/[versionId]
//         { status?, review_notes?, label?, notes? }
//         status cambia el estado de aprobación (queda quién y cuándo).
//   POST  /api/production/designs/[id]/versions/[versionId]  { action: "restore" }
//         vuelve el design a esa versión (antes guarda un respaldo pre_restore).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import {
  DESIGN_VERSION_STATUSES,
  restoreDesignVersion,
  reviewDesignVersion,
  updateDesignVersionNotes,
} from "@/lib/production/design-versions";

const patchSchema = z.object({
  status: z.enum(DESIGN_VERSION_STATUSES as [string, ...string[]]).optional(),
  review_notes: z.string().max(4000).optional().nullable(),
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
    const { status, review_notes, label, notes } = parsed.data;
    if (label !== undefined || notes !== undefined) await updateDesignVersionNotes({ ...i, label, notes });
    let version = null;
    if (status) {
      version = await reviewDesignVersion({ ...i, userId: Number(session.user.id), status: status as (typeof DESIGN_VERSION_STATUSES)[number], reviewNotes: review_notes });
      if (!version) return NextResponse.json({ error: "Versión no encontrada" }, { status: 404 });
    }
    return NextResponse.json(version ?? { ok: true });
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
