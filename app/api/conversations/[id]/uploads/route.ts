import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { uploadToS3 } from "@/lib/s3";

// POST - Upload an external file as a grid item in a full-mode conversation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const conversationId = parseInt(id);

    // Verify conversation exists
    const [convRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, user_id, generation_type FROM conversations WHERE id = ?`,
      [conversationId]
    );
    if (convRows.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const body = await request.json();
    const { dataUrl, mimeType, name, aspectRatio } = body as {
      dataUrl: string;
      mimeType: string;
      name: string;
      aspectRatio?: string;
    };

    if (!dataUrl || !mimeType) {
      return NextResponse.json({ error: "dataUrl y mimeType requeridos" }, { status: 400 });
    }

    const isVideo = mimeType.startsWith("video/");
    const isImage = mimeType.startsWith("image/");

    if (!isVideo && !isImage) {
      return NextResponse.json({ error: "Solo se aceptan imágenes y videos" }, { status: 400 });
    }

    // Upload to GCS
    const base64Data = dataUrl.split(",")[1];
    if (!base64Data) {
      return NextResponse.json({ error: "dataUrl inválido" }, { status: 400 });
    }

    const buffer = Buffer.from(base64Data, "base64");
    const ext = mimeType.split("/")[1] || (isVideo ? "mp4" : "png");
    const fileName = `uploads/conv_${conversationId}_${Date.now()}.${ext}`;
    const subfolder = isVideo ? "videos" : "uploads";

    const uploadResult = await uploadToS3(buffer, fileName, mimeType, subfolder);

    // Create a model message so it appears in the grid
    const contentType = isVideo ? "video" : "image";

    const arColumns = isVideo && aspectRatio ? ", video_aspect_ratio" : (!isVideo && aspectRatio ? ", image_aspect_ratio" : "");
    const arPlaceholder = aspectRatio ? ", ?" : "";
    const arValues = aspectRatio ? [aspectRatio] : [];

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO messages (conversation_id, role, content, content_type, ${
        isVideo
          ? "video_url, video_mime_type, video_file_size"
          : "image_url, image_mime_type, image_file_size"
      }${arColumns})
       VALUES (?, 'model', ?, ?, ?, ?, ?${arPlaceholder})`,
      [
        conversationId,
        `Archivo subido: ${name || "sin nombre"}`,
        contentType,
        uploadResult.url,
        mimeType,
        uploadResult.fileSize,
        ...arValues,
      ]
    );

    const messageId = result.insertId;

    // Update conversation timestamp
    await pool.execute(
      "UPDATE conversations SET updated_at = NOW() WHERE id = ?",
      [conversationId]
    );

    return NextResponse.json({
      id: messageId,
      type: contentType,
      url: uploadResult.url,
      mimeType,
      fileSize: uploadResult.fileSize,
      name: name || "sin nombre",
    });
  } catch (error) {
    console.error("Error uploading file:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
