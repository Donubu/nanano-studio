import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { uploadToS3 } from "@/lib/s3";

const TOPAZ_API_KEY = process.env.TOPAZ_API_KEY || "";

interface UpscaleRequest {
  imageUrl: string;
  width: number;
  height: number;
}

// Generar la URL de la versión 2x
function get2xUrl(originalUrl: string): string {
  // Insertar --2x antes de la extensión
  // https://static.puer.to/nanano/generated/10_123_abc.png
  // -> https://static.puer.to/nanano/generated/10_123_abc--2x.png
  const lastDotIndex = originalUrl.lastIndexOf(".");
  if (lastDotIndex === -1) {
    return originalUrl + "--2x";
  }
  return originalUrl.slice(0, lastDotIndex) + "--2x" + originalUrl.slice(lastDotIndex);
}

// Extraer el key de S3 de la URL de CloudFront
function getS3KeyFrom2xUrl(url2x: string): string {
  // URL: https://static.puer.to/nanano/generated/10_123_abc--2x.png
  // Key: nanano/generated/10_123_abc--2x.png
  const urlObj = new URL(url2x);
  // Quitar el "/" inicial del pathname
  return urlObj.pathname.slice(1);
}

// Verificar si la imagen 2x ya existe
async function check2xExists(url2x: string): Promise<boolean> {
  try {
    const response = await fetch(url2x, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

// POST - Upscale imagen a 2x
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (!TOPAZ_API_KEY) {
      return NextResponse.json({ error: "Topaz API no configurada" }, { status: 500 });
    }

    const body: UpscaleRequest = await request.json();
    const { imageUrl, width, height } = body;

    if (!imageUrl || !width || !height) {
      return NextResponse.json({ error: "Parámetros requeridos: imageUrl, width, height" }, { status: 400 });
    }

    // Verificar que la imagen no exceda 1920px
    if (width > 1920) {
      return NextResponse.json({ error: "La imagen excede 1920px de ancho" }, { status: 400 });
    }

    const url2x = get2xUrl(imageUrl);

    // Verificar si ya existe la versión 2x
    const exists = await check2xExists(url2x);
    if (exists) {
      return NextResponse.json({ url: url2x, cached: true });
    }

    // Descargar imagen original
    console.log("[Upscale] Descargando imagen original:", imageUrl);
    const originalResponse = await fetch(imageUrl);
    if (!originalResponse.ok) {
      return NextResponse.json({ error: "No se pudo descargar la imagen original" }, { status: 400 });
    }

    const originalBlob = await originalResponse.blob();
    const originalBuffer = Buffer.from(await originalBlob.arrayBuffer());

    // Calcular dimensiones 2x
    const output_width = width * 2;
    const output_height = height * 2;

    console.log("[Upscale] Enviando a Topaz API:", { width, height, output_width, output_height });

    // Crear FormData para Topaz API
    const formData = new FormData();
    formData.append("image", new Blob([originalBuffer]), "image.png");
    formData.append("model", "Standard V2");
    formData.append("output_width", String(output_width));
    formData.append("output_height", String(output_height));

    // Llamar a Topaz API
    const topazResponse = await fetch("https://api.topazlabs.com/image/v1/enhance", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "X-API-Key": TOPAZ_API_KEY,
      },
      body: formData,
    });

    if (!topazResponse.ok) {
      const errorText = await topazResponse.text();
      console.error("[Upscale] Error de Topaz:", topazResponse.status, errorText);
      return NextResponse.json({
        error: "Error al procesar con Topaz API",
        details: errorText
      }, { status: 500 });
    }

    // Obtener el binario de respuesta
    const upscaledBuffer = Buffer.from(await topazResponse.arrayBuffer());
    console.log("[Upscale] Imagen procesada, tamaño:", upscaledBuffer.length, "bytes");

    // Extraer el nombre del archivo para S3
    // URL original: https://static.puer.to/nanano/generated/10_123_abc.png
    // Necesitamos: 10_123_abc--2x.png
    const originalFileName = imageUrl.split("/").pop() || "image.png";
    const lastDotIndex = originalFileName.lastIndexOf(".");
    const fileName2x = lastDotIndex === -1
      ? originalFileName + "--2x.png"
      : originalFileName.slice(0, lastDotIndex) + "--2x" + originalFileName.slice(lastDotIndex);

    // Determinar el subfolder desde la URL original
    // URL: https://static.puer.to/nanano/generated/10_123_abc.png
    // El subfolder es "generated" (ya está en la función uploadToS3)

    // Subir a S3
    console.log("[Upscale] Subiendo a S3:", fileName2x);
    const mimeType = originalBlob.type || "image/png";
    const result = await uploadToS3(upscaledBuffer, fileName2x, mimeType, "generated");

    console.log("[Upscale] Completado:", result.url);

    return NextResponse.json({
      url: result.url,
      cached: false,
      fileSize: result.fileSize
    });

  } catch (error) {
    console.error("[Upscale] Error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
