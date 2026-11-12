import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveLinks, type LinkRef } from "@/lib/canvas-links";

// POST - Vista resuelta de los nodos vinculados de este canvas.
// Body: { refs: [{ conversationId, nodeId }] }
// No escribe nada: el cliente compara el hash y actualiza sus nodos.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const refs = Array.isArray(body?.refs) ? (body.refs as LinkRef[]) : [];
    const results = await resolveLinks(Number(id), {
      id: Number(session.user.id),
      isAdmin: session.user.role === "admin",
    }, refs);
    if (!results) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    return NextResponse.json({ results });
  } catch (error) {
    console.error("Error resolving canvas links:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
