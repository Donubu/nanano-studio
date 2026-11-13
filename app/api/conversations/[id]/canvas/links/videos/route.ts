import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listVideoLinkables } from "@/lib/canvas-links";

// GET - Videos de los otros canvas del proyecto que se pueden vincular: los
// finales de cada escena (en orden) y los demás con resultado.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const { id } = await params;
    const canvases = await listVideoLinkables(Number(id), {
      id: Number(session.user.id),
      isAdmin: session.user.role === "admin",
    });
    if (!canvases) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    return NextResponse.json({ canvases });
  } catch (error) {
    console.error("Error listing linkable videos:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
