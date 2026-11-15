import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { linkableImageFiles } from "@/lib/canvas-links";
import { attachmentHeader, fetchChunks } from "@/lib/canvas-video-downloads";
import { zipStream } from "@/lib/zip-stream";

// GET ?conv=<canvas de origen>&node=<id> - Una imagen de otro canvas del
// proyecto (pestaña "Imágenes" de Vincular) como descarga.
// GET ?conv=<canvas de origen> - Todas sus imágenes en un ZIP sin comprimir.
// Mismo acceso que vincular; la URL sale del canvas guardado, nunca del cliente.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const conv = Number(request.nextUrl.searchParams.get("conv"));
  const node = request.nextUrl.searchParams.get("node");
  if (!Number.isInteger(conv) || conv <= 0) return NextResponse.json({ error: "Falta el canvas de origen" }, { status: 400 });
  const list = await linkableImageFiles(Number(id), { id: Number(session.user.id), isAdmin: session.user.role === "admin" }, conv);
  if (!list) return NextResponse.json({ error: "Canvas no encontrado" }, { status: 404 });

  if (node) {
    const file = list.files.find((f) => f.nodeId === node);
    if (!file) return NextResponse.json({ error: "Esa imagen no está disponible" }, { status: 404 });
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

  if (list.files.length === 0) return NextResponse.json({ error: "Ese canvas no tiene imágenes" }, { status: 404 });
  const iterator = zipStream(list.files.map((f) => ({ name: f.fileName, data: fetchChunks(f.url) })));
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        console.error("[linkable images zip]", error);
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": attachmentHeader(`${list.title} - imágenes.zip`),
      "Cache-Control": "no-store",
    },
  });
}
