import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { uploadToS3 } from "@/lib/s3";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const folder = (formData.get("folder") as string) || "logos";

    if (!file) {
      return NextResponse.json(
        { error: "No se proporcionó archivo" },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Generar nombre único
    const ext = path.extname(file.name).slice(1) || "bin";
    const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

    // Subir a S3
    const result = await uploadToS3(
      buffer,
      filename,
      file.type || "application/octet-stream",
      folder
    );

    return NextResponse.json({ url: result.url, filename });
  } catch (error) {
    console.error("Error uploading file:", error);
    return NextResponse.json(
      { error: "Error al subir archivo" },
      { status: 500 }
    );
  }
}
