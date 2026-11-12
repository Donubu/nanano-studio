import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listLinkUsage } from "@/lib/canvas-links";

// GET - Dónde se usan los Personajes / Escenas de este canvas como vinculados
// en otros canvas del proyecto (para "Usado en…" y los avisos al borrar).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const { id } = await params;
    const usage = await listLinkUsage(Number(id), {
      id: Number(session.user.id),
      isAdmin: session.user.role === "admin",
    });
    if (!usage) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    return NextResponse.json({ usage });
  } catch (error) {
    console.error("Error listing canvas link usage:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
