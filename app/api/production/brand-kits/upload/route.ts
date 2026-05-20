import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { uploadToS3, isS3Configured } from "@/lib/s3";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — brand kit assets are small

// POST - Upload a brand kit asset (logo) to GCS.
// Stores under brand-kits/{clientId}/<timestamp>.<ext> and returns the public
// URL. Brand kit content json keeps just the URL — no DB row is needed since
// the asset is referenced from typography_json / logos_json.
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!isS3Configured()) {
      return NextResponse.json(
        { error: "Storage no configurado (GCS_BUCKET)" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { imageData, clientId } = body as {
      imageData?: string;
      clientId?: number | string;
    };

    if (!imageData) {
      return NextResponse.json(
        { error: "Falta imageData" },
        { status: 400 }
      );
    }

    const matches = imageData.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      return NextResponse.json(
        { error: "Formato base64 inválido (se espera data: URI)" },
        { status: 400 }
      );
    }

    const mimeType = matches[1];
    if (!EXTENSION_BY_MIME[mimeType]) {
      return NextResponse.json(
        { error: `Tipo de archivo no soportado: ${mimeType}` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(matches[2], "base64");
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json(
        { error: "Archivo demasiado grande (máximo 8 MB)" },
        { status: 400 }
      );
    }

    const extension = EXTENSION_BY_MIME[mimeType];
    const safeClient =
      clientId !== undefined && clientId !== null && `${clientId}`.trim() !== ""
        ? String(clientId).replace(/[^a-zA-Z0-9_-]/g, "")
        : "shared";
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const fileName = `${timestamp}_${randomId}.${extension}`;
    const subfolder = `brand-kits/${safeClient}`;

    const result = await uploadToS3(buffer, fileName, mimeType, subfolder);

    return NextResponse.json({
      url: result.url,
      key: result.key,
      fileSize: result.fileSize,
      mimeType,
    });
  } catch (error) {
    console.error("Error subiendo asset de brand kit:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
