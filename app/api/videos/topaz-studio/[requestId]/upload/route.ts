import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * POST - Proxy video upload to Topaz S3 and return eTag
 * This is needed because browser CORS doesn't expose the ETag header
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { requestId } = await params;

    if (!requestId) {
      return NextResponse.json({ error: "requestId requerido" }, { status: 400 });
    }

    // Get upload URL and video blob from form data
    const formData = await request.formData();
    const uploadUrl = formData.get("uploadUrl") as string;
    const videoFile = formData.get("video") as File;

    if (!uploadUrl || !videoFile) {
      return NextResponse.json({
        error: "uploadUrl y video son requeridos"
      }, { status: 400 });
    }

    // Validar que la URL sea de Topaz S3 (prevenir SSRF)
    try {
      const url = new URL(uploadUrl);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".amazonaws.com")) {
        return NextResponse.json({ error: "URL de upload no válida" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "URL de upload malformada" }, { status: 400 });
    }

    // Upload to Topaz S3
    const videoBuffer = await videoFile.arrayBuffer();

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: videoBuffer,
      headers: {
        "Content-Type": videoFile.type || "video/mp4",
      },
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error("S3 upload error:", errorText);
      return NextResponse.json({
        error: `Error uploading to S3: ${uploadResponse.status}`
      }, { status: 500 });
    }

    // Get eTag from response headers
    const eTag = uploadResponse.headers.get("etag") || uploadResponse.headers.get("ETag") || "";

    console.log("S3 upload response headers:", Object.fromEntries(uploadResponse.headers.entries()));
    console.log("eTag from S3:", eTag);

    return NextResponse.json({
      success: true,
      eTag: eTag.replace(/"/g, ""), // Remove quotes if present
    });

  } catch (error) {
    console.error("Error in upload proxy:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    );
  }
}
