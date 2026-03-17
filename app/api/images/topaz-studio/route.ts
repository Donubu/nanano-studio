import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { uploadToS3 } from "@/lib/s3";
import pool from "@/lib/db";
import { ResultSetHeader } from "mysql2";
import sharp from "sharp";
import {
  calculateTopazStudioCredits,
  getTopazModelShortCode,
  TopazModel,
  TopazScaleFactor,
  TopazParameters,
  TOPAZ_MODELS,
} from "@/lib/cost-calculator";

const TOPAZ_API_KEY = process.env.TOPAZ_API_KEY || "";

interface TopazStudioRequest {
  imageUrl: string;
  messageId: number;
  width: number;
  height: number;
  scaleFactor: TopazScaleFactor;
  model: TopazModel;
  parameters?: TopazParameters;
}

// Generate the processed filename
function getProcessedFileName(originalUrl: string, scaleFactor: number, model: TopazModel, format: string): string {
  const originalFileName = originalUrl.split("/").pop() || "image.png";
  const lastDotIndex = originalFileName.lastIndexOf(".");
  const baseName = lastDotIndex === -1 ? originalFileName : originalFileName.slice(0, lastDotIndex);
  const modelShortCode = getTopazModelShortCode(model);
  return `${baseName}--topaz-${scaleFactor}x-${modelShortCode}.${format}`;
}

// Check if processed version already exists
async function checkProcessedExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

// Get the CloudFront URL for a processed file
function getProcessedUrl(originalUrl: string, fileName: string): string {
  const urlObj = new URL(originalUrl);
  const pathParts = urlObj.pathname.split("/");
  pathParts[pathParts.length - 1] = fileName;
  return `${urlObj.origin}${pathParts.join("/")}`;
}

// POST - Process image with Topaz Studio
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    if (!TOPAZ_API_KEY) {
      return NextResponse.json({ error: "Topaz API no configurada" }, { status: 500 });
    }

    const body: TopazStudioRequest = await request.json();
    const { imageUrl, messageId, width, height, scaleFactor, model, parameters = {} } = body;

    // Validate required fields
    if (!imageUrl || !messageId || !width || !height || !scaleFactor || !model) {
      return NextResponse.json({
        error: "Parámetros requeridos: imageUrl, messageId, width, height, scaleFactor, model"
      }, { status: 400 });
    }

    // Validate model
    if (!TOPAZ_MODELS[model]) {
      return NextResponse.json({
        error: `Modelo inválido: ${model}. Modelos disponibles: ${Object.keys(TOPAZ_MODELS).join(", ")}`
      }, { status: 400 });
    }

    // Calculate credits and validate dimensions
    let creditsInfo;
    try {
      creditsInfo = calculateTopazStudioCredits(width, height, scaleFactor, model);
    } catch (err) {
      return NextResponse.json({
        error: err instanceof Error ? err.message : "Error calculando dimensiones"
      }, { status: 400 });
    }

    const outputFormat = parameters.outputFormat || "png";

    // Generate filename and check if already exists
    const processedFileName = getProcessedFileName(imageUrl, scaleFactor, model, outputFormat);
    const processedUrl = getProcessedUrl(imageUrl, processedFileName);

    const exists = await checkProcessedExists(processedUrl);
    if (exists) {
      // Check if we have a record in the database
      const [existingRows] = await pool.execute<any[]>(
        "SELECT * FROM topaz_edits WHERE message_id = ? AND result_url = ? LIMIT 1",
        [messageId, processedUrl]
      );

      if (existingRows.length > 0) {
        return NextResponse.json({
          url: processedUrl,
          editId: existingRows[0].id,
          creditsConsumed: existingRows[0].credits_consumed,
          processingTimeMs: existingRows[0].processing_time_ms,
          outputWidth: existingRows[0].output_width,
          outputHeight: existingRows[0].output_height,
          megapixels: existingRows[0].output_megapixels,
          fileSize: existingRows[0].output_file_size,
          cached: true,
        });
      }
    }

    // Download original image
    console.log("[Topaz Studio] Descargando imagen original:", imageUrl);
    const originalResponse = await fetch(imageUrl);
    if (!originalResponse.ok) {
      return NextResponse.json({ error: "No se pudo descargar la imagen original" }, { status: 400 });
    }

    const originalBlob = await originalResponse.blob();
    const originalBuffer = Buffer.from(await originalBlob.arrayBuffer());

    // Detect actual image dimensions from the downloaded file (frontend values can be unreliable)
    const metadata = await sharp(originalBuffer).metadata();
    const actualWidth = metadata.width || width;
    const actualHeight = metadata.height || height;

    if (actualWidth !== width || actualHeight !== height) {
      console.log(`[Topaz Studio] Dimensiones corregidas: frontend=${width}x${height}, real=${actualWidth}x${actualHeight}`);
    }

    // Recalculate with actual dimensions
    let actualCreditsInfo;
    try {
      actualCreditsInfo = calculateTopazStudioCredits(actualWidth, actualHeight, scaleFactor, model);
    } catch (err) {
      return NextResponse.json({
        error: err instanceof Error ? err.message : "Error calculando dimensiones reales"
      }, { status: 400 });
    }

    const { credits: actualCredits, outputWidth: actualOutputWidth, outputHeight: actualOutputHeight, megapixels: actualMegapixels } = actualCreditsInfo;

    console.log("[Topaz Studio] Enviando a Topaz API:", {
      model,
      scaleFactor,
      inputDimensions: `${actualWidth}x${actualHeight}`,
      outputDimensions: `${actualOutputWidth}x${actualOutputHeight}`,
      megapixels: actualMegapixels,
      credits: actualCredits,
    });

    // Create FormData for Topaz API
    const formData = new FormData();
    formData.append("image", new Blob([originalBuffer]), "image.png");
    formData.append("model", model);
    formData.append("output_width", String(actualOutputWidth));
    formData.append("output_height", String(actualOutputHeight));
    formData.append("output_format", outputFormat);

    // Add optional parameters based on model type
    const modelConfig = TOPAZ_MODELS[model];

    // Generative model parameters (Wonder, Redefine, Recovery V2)
    if (modelConfig.type === "generative") {
      if (parameters.creativity !== undefined) {
        formData.append("creativity", String(parameters.creativity));
      }
      if (parameters.texture !== undefined) {
        formData.append("texture", String(parameters.texture));
      }
    }

    // Standard model parameters
    if (modelConfig.type === "standard") {
      if (parameters.sharpen !== undefined) {
        formData.append("sharpen", String(parameters.sharpen));
      }
      if (parameters.denoise !== undefined) {
        formData.append("denoise", String(parameters.denoise));
      }
      if (parameters.detail !== undefined) {
        formData.append("detail", String(parameters.detail));
      }
      if (parameters.minorDeblur !== undefined) {
        formData.append("minor_deblur", String(parameters.minorDeblur));
      }
      if (parameters.minorDenoise !== undefined) {
        formData.append("minor_denoise", String(parameters.minorDenoise));
      }
      if (parameters.fixCompression !== undefined) {
        formData.append("fix_compression", String(parameters.fixCompression));
      }
    }

    // Face enhancement (available for both types, but disabled for generative with creativity >= 3)
    if (parameters.faceEnhancement) {
      const creativityDisablesFace = modelConfig.type === "generative" &&
        parameters.creativity !== undefined && parameters.creativity >= 3;

      if (!creativityDisablesFace) {
        formData.append("face_enhancement", "true");
        if (parameters.faceEnhancementStrength !== undefined) {
          formData.append("face_enhancement_strength", String(parameters.faceEnhancementStrength));
        }
      }
    }

    if (parameters.cropToFill) {
      formData.append("crop_to_fill", "true");
    }

    // Call Topaz API
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
      console.error("[Topaz Studio] Error de Topaz:", topazResponse.status, errorText);
      return NextResponse.json({
        error: "Error al procesar con Topaz API",
        details: errorText
      }, { status: 500 });
    }

    // Get the binary response
    const processedBuffer = Buffer.from(await topazResponse.arrayBuffer());
    const processingTimeMs = Date.now() - startTime;
    console.log("[Topaz Studio] Imagen procesada, tamaño:", processedBuffer.length, "bytes, tiempo:", processingTimeMs, "ms");

    // Upload to S3
    console.log("[Topaz Studio] Subiendo a S3:", processedFileName);
    const mimeType = outputFormat === "png" ? "image/png" : outputFormat === "tiff" ? "image/tiff" : "image/jpeg";
    const s3Result = await uploadToS3(processedBuffer, processedFileName, mimeType, "generated");

    console.log("[Topaz Studio] Completado:", s3Result.url);

    // Save to database
    const [insertResult] = await pool.execute<ResultSetHeader>(
      `INSERT INTO topaz_edits (
        message_id, original_url, result_url, model, scale_factor,
        input_width, input_height, output_width, output_height, output_megapixels,
        parameters, credits_consumed, processing_time_ms, output_format, output_file_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        messageId,
        imageUrl,
        s3Result.url,
        model,
        scaleFactor,
        actualWidth,
        actualHeight,
        actualOutputWidth,
        actualOutputHeight,
        actualMegapixels,
        JSON.stringify(parameters),
        actualCredits,
        processingTimeMs,
        outputFormat,
        processedBuffer.length,
      ]
    );

    // Update topaz_credits in messages table (accumulate)
    await pool.execute<ResultSetHeader>(
      "UPDATE messages SET topaz_credits = COALESCE(topaz_credits, 0) + ? WHERE id = ?",
      [actualCredits, messageId]
    );

    return NextResponse.json({
      url: s3Result.url,
      editId: insertResult.insertId,
      creditsConsumed: actualCredits,
      processingTimeMs,
      outputWidth: actualOutputWidth,
      outputHeight: actualOutputHeight,
      megapixels: actualMegapixels,
      fileSize: processedBuffer.length,
      cached: false,
    });

  } catch (error) {
    console.error("[Topaz Studio] Error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
