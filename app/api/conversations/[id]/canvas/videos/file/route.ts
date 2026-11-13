import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { attachmentHeader, canvasVideoFiles } from "@/lib/canvas-video-downloads";

// GET ?node=<id> - Un video del canvas como descarga, con su nombre numerado.
// El servidor lo transmite tal cual (sin pasar por la memoria del navegador).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const nodeId = request.nextUrl.searchParams.get("node") || "";
  const list = await canvasVideoFiles(Number(id), { id: Number(session.user.id), isAdmin: session.user.role === "admin" });
  if (!list) return NextResponse.json({ error: "Canvas no encontrado" }, { status: 404 });
  const file = list.files.find((f) => f.nodeId === nodeId);
  if (!file) return NextResponse.json({ error: "Ese video no está listo" }, { status: 404 });
  const res = await fetch(file.url);
  if (!res.ok || !res.body) return NextResponse.json({ error: `No se pudo leer el video (HTTP ${res.status})` }, { status: 502 });
  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("content-type") || "video/mp4",
      ...(res.headers.get("content-length") ? { "Content-Length": res.headers.get("content-length")! } : {}),
      "Content-Disposition": attachmentHeader(file.fileName),
      "Cache-Control": "no-store",
    },
  });
}
