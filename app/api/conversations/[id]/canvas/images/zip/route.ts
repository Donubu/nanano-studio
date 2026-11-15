import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { attachmentHeader, canvasImageFiles, fetchChunks } from "@/lib/canvas-video-downloads";
import { zipStream } from "@/lib/zip-stream";

// GET - Todas las imágenes del canvas (propias y vinculadas) en un ZIP sin
// comprimir, en streaming, numeradas en el orden del panel "Imágenes".
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const list = await canvasImageFiles(Number(id), { id: Number(session.user.id), isAdmin: session.user.role === "admin" });
  if (!list) return NextResponse.json({ error: "Canvas no encontrado" }, { status: 404 });
  if (list.files.length === 0) return NextResponse.json({ error: "Este canvas no tiene imágenes" }, { status: 404 });

  const entries = list.files.map((f) => ({ name: f.fileName, data: fetchChunks(f.url) }));
  const iterator = zipStream(entries);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        console.error("[canvas images zip]", error);
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
