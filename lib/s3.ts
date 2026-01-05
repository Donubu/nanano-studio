import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Configuración del cliente S3
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET = process.env.AWS_S3_BUCKET || "";
// Limpiar slashes del inicio y final del folder
const FOLDER = (process.env.AWS_S3_FOLDER || "").replace(/^\/+|\/+$/g, "");
// Limpiar protocolo y slashes del dominio CloudFront
const CLOUDFRONT_DOMAIN = (process.env.AWS_CLOUDFRONT_DOMAIN || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");

export interface UploadResult {
  url: string;
  key: string;
  fileSize: number;
}

/**
 * Sube un archivo a S3 y retorna la URL de CloudFront
 */
export async function uploadToS3(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  subfolder: string = "generated"
): Promise<UploadResult> {
  // Construir la key (ruta) en S3
  const key = FOLDER
    ? `${FOLDER}/${subfolder}/${fileName}`
    : `${subfolder}/${fileName}`;

  console.log("[S3] Uploading to bucket:", BUCKET);
  console.log("[S3] Key:", key);
  console.log("[S3] File size:", buffer.length, "bytes");

  // Subir a S3
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      CacheControl: "max-age=31536000", // Cache por 1 año
    })
  );

  // Construir URL de CloudFront
  const url = CLOUDFRONT_DOMAIN
    ? `https://${CLOUDFRONT_DOMAIN}/${key}`
    : `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

  console.log("[S3] Upload successful, URL:", url);

  return {
    url,
    key,
    fileSize: buffer.length,
  };
}

/**
 * Genera un nombre único para el archivo
 */
export function generateFileName(
  conversationId: string,
  extension: string
): string {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 8);
  return `${conversationId}_${timestamp}_${randomId}.${extension}`;
}

/**
 * Verifica si S3 está configurado
 */
export function isS3Configured(): boolean {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_S3_BUCKET
  );
}
