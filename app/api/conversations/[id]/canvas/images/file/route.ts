import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { attachmentHeader, canvasImageFiles } from "@/lib/canvas-video-downloads";

// GET ?key=<clave> - Una imagen del canvas (propia o vinculada) como
// descarga, con su nombre numerado del panel "Imágenes".
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const key = request.nextUrl.searchParams.get("key") || "";
  const list = await canvasImageFiles(Number(id), { id: Number(session.user.id), isAdmin: session.user.role === "admin" });
  if (!list) return NextResponse.json({ error: "Canvas no encontrado" }, { status: 404 });
  const file = list.files.find((f) => f.key === key);
  if (!file) return NextResponse.json({ error: "Esa imagen no está en el canvas" }, { status: 404 });
  const res = await fetch(file.url);
  if (!res.ok || !res.body) return NextResponse.json({ error: `No se pudo leer la imagen (HTTP ${res.status})` }, { status: 502 });
  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("content-type") || "image/png",
      ...(res.headers.get("content-length") ? { "Content-Length": res.headers.get("content-length")! } : {}),
      "Content-Disposition": attachmentHeader(file.fileName),
      "Cache-Control": "no-store",
    },
  });
}
