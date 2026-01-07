import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { uploadImageToS3, generateUploadFileName, isS3Configured } from "@/lib/s3";

interface ProjectAccessRow extends RowDataPacket {
  id: number;
}

// POST - Upload a new image to S3 and register in project_uploads
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (!isS3Configured()) {
      return NextResponse.json(
        { error: "S3 no configurado" },
        { status: 500 }
      );
    }

    const { id: projectId } = await params;

    // Verificar que el usuario tiene acceso al proyecto
    const isAdmin = session.user.role === "admin";

    if (!isAdmin) {
      const [projectAccess] = await pool.execute<ProjectAccessRow[]>(
        `SELECT pu.id FROM project_users pu
         WHERE pu.project_id = ? AND pu.user_id = ?`,
        [projectId, session.user.id]
      );

      if (projectAccess.length === 0) {
        return NextResponse.json(
          { error: "Proyecto no encontrado o sin acceso" },
          { status: 404 }
        );
      }
    }

    // Obtener la imagen del body
    const body = await request.json();
    const { imageData, fileName: originalFileName } = body as {
      imageData: string; // base64 with data: prefix
      fileName?: string;
    };

    if (!imageData) {
      return NextResponse.json(
        { error: "No se proporcionó imagen" },
        { status: 400 }
      );
    }

    // Extraer el mime type y el base64 puro
    const matches = imageData.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      return NextResponse.json(
        { error: "Formato de imagen inválido" },
        { status: 400 }
      );
    }

    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");

    // Determinar extensión del archivo
    const extensionMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    const extension = extensionMap[mimeType] || "jpg";

    // Generar nombre único para el archivo
    const s3FileName = generateUploadFileName(Number(projectId), extension);

    console.log("[Upload] Uploading image to S3:", {
      projectId,
      userId: session.user.id,
      mimeType,
      size: buffer.length,
      fileName: s3FileName,
    });

    // Subir a S3
    const uploadResult = await uploadImageToS3(buffer, s3FileName, mimeType);

    // Registrar en la base de datos
    const [insertResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO project_uploads (project_id, user_id, image_url, original_filename, file_size, mime_type)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        session.user.id,
        uploadResult.url,
        originalFileName || s3FileName,
        uploadResult.fileSize,
        mimeType,
      ]
    );

    console.log("[Upload] Image registered:", {
      id: insertResult.insertId,
      url: uploadResult.url,
    });

    return NextResponse.json({
      id: insertResult.insertId,
      image_url: uploadResult.url,
      file_size: uploadResult.fileSize,
      mime_type: mimeType,
    });
  } catch (error) {
    console.error("Error uploading image:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
