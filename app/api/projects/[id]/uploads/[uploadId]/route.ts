import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { deleteFromS3, extractS3KeyFromUrl } from "@/lib/s3";

interface UploadRow extends RowDataPacket {
  id: number;
  project_id: number;
  user_id: number;
  image_url: string;
}

// DELETE - Delete an uploaded image
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; uploadId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: projectId, uploadId } = await params;

    // Get the upload record
    const [uploads] = await pool.execute<UploadRow[]>(
      `SELECT id, project_id, user_id, image_url FROM project_uploads WHERE id = ? AND project_id = ?`,
      [uploadId, projectId]
    );

    if (uploads.length === 0) {
      return NextResponse.json(
        { error: "Upload no encontrado" },
        { status: 404 }
      );
    }

    const upload = uploads[0];

    // Verify user has permission (admin or owner)
    const isAdmin = session.user.role === "admin";
    const isOwner = upload.user_id === Number(session.user.id);

    if (!isAdmin && !isOwner) {
      return NextResponse.json(
        { error: "No autorizado para eliminar este archivo" },
        { status: 403 }
      );
    }

    // Extract S3 key from URL and delete from S3
    const s3Key = extractS3KeyFromUrl(upload.image_url);
    if (s3Key) {
      await deleteFromS3(s3Key);
    }

    // Delete from database
    await pool.execute<ResultSetHeader>(
      `DELETE FROM project_uploads WHERE id = ?`,
      [uploadId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting upload:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
