import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

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
 * Sube un video a S3 y retorna la URL de CloudFront
 * Usa el subfolder "videos" para organizar los archivos
 */
export async function uploadVideoToS3(
  buffer: Buffer,
  fileName: string,
  mimeType: string = "video/mp4"
): Promise<UploadResult> {
  return uploadToS3(buffer, fileName, mimeType, "videos");
}

/**
 * Genera un nombre único para un archivo de video
 */
export function generateVideoFileName(
  conversationId: string,
  extension: string = "mp4"
): string {
  return generateFileName(conversationId, extension);
}

/**
 * Sube una imagen subida por usuario a S3
 * Usa el subfolder "uploads" para organizar los archivos
 */
export async function uploadImageToS3(
  buffer: Buffer,
  fileName: string,
  mimeType: string = "image/jpeg"
): Promise<UploadResult> {
  return uploadToS3(buffer, fileName, mimeType, "uploads");
}

/**
 * Sube un audio a S3 y retorna la URL de CloudFront
 * Usa el subfolder "audio" para organizar los archivos
 */
export async function uploadAudioToS3(
  buffer: Buffer,
  fileName: string,
  mimeType: string = "audio/mpeg"
): Promise<UploadResult> {
  return uploadToS3(buffer, fileName, mimeType, "audio");
}

/**
 * Genera un nombre único para un archivo de audio
 */
export function generateAudioFileName(
  conversationId: string,
  extension: string = "mp3"
): string {
  return generateFileName(conversationId, extension);
}

/**
 * Sube musica temporal a S3 (para preview antes de guardar)
 * Usa el subfolder "music/temp" para archivos temporales
 */
export async function uploadTempMusicToS3(
  buffer: Buffer,
  fileName: string,
  mimeType: string = "audio/mpeg"
): Promise<UploadResult> {
  return uploadToS3(buffer, fileName, mimeType, "music/temp");
}

/**
 * Sube musica final a S3
 * Usa el subfolder "music" para archivos permanentes
 */
export async function uploadMusicToS3(
  buffer: Buffer,
  fileName: string,
  mimeType: string = "audio/mpeg"
): Promise<UploadResult> {
  return uploadToS3(buffer, fileName, mimeType, "music");
}

/**
 * Genera un nombre unico para un archivo de musica
 */
export function generateMusicFileName(
  conversationId: string,
  extension: string = "mp3"
): string {
  return generateFileName(conversationId, extension);
}

/**
 * Genera un nombre único para una imagen subida por usuario
 */
export function generateUploadFileName(
  projectId: number,
  extension: string = "jpg"
): string {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 8);
  return `project_${projectId}_${timestamp}_${randomId}.${extension}`;
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

/**
 * Extrae la key de S3 desde una URL de CloudFront o S3
 */
export function extractS3KeyFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    // Remove leading slash
    let path = urlObj.pathname.replace(/^\//, "");
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Elimina un archivo de S3
 */
export async function deleteFromS3(key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: key,
      })
    );
    return true;
  } catch (error) {
    console.error("[S3] Error deleting file:", error);
    return false;
  }
}
