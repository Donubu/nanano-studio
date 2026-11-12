import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listLinkables } from "@/lib/canvas-links";

// GET - Personajes de otros canvas del mismo proyecto que se pueden vincular
// a este canvas (selector "Vincular de otro canvas").
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const { id } = await params;
    const canvases = await listLinkables(Number(id), {
      id: Number(session.user.id),
      isAdmin: session.user.role === "admin",
    });
    if (!canvases) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    return NextResponse.json({ canvases });
  } catch (error) {
    console.error("Error listing canvas linkables:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
