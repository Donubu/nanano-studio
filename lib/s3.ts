import { Storage } from "@google-cloud/storage";

// Lazy initialization to support worker process where env vars load after module init
let storageClient: Storage | null = null;
function getStorageClient(): Storage {
  if (!storageClient) {
    // Auto-detects credentials from GOOGLE_APPLICATION_CREDENTIALS env var or VM metadata
    storageClient = new Storage();
  }
  return storageClient;
}

function getBucket() { return process.env.GCS_BUCKET || ""; }
function getFolder() { return (process.env.GCS_FOLDER || "").replace(/^\/+|\/+$/g, ""); }
function getBaseUrl() {
  // Allow override for future CDN domain, otherwise use direct GCS URL
  return (process.env.GCS_BASE_URL || `https://storage.googleapis.com/${getBucket()}`).replace(/\/+$/, "");
}

export interface UploadResult {
  url: string;
  key: string;
  fileSize: number;
}

/**
 * Sube un archivo a GCS y retorna la URL pública
 */
export async function uploadToS3(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  subfolder: string = "generated"
): Promise<UploadResult> {
  const bucket = getBucket();
  const folder = getFolder();
  const baseUrl = getBaseUrl();

  // Construir la key (ruta) en GCS — misma estructura que S3
  const key = folder
    ? `${folder}/${subfolder}/${fileName}`
    : `${subfolder}/${fileName}`;

  console.log("[GCS] Uploading to bucket:", bucket);
  console.log("[GCS] Key:", key);
  console.log("[GCS] File size:", buffer.length, "bytes");

  const file = getStorageClient().bucket(bucket).file(key);
  await file.save(buffer, {
    contentType: mimeType,
    metadata: {
      cacheControl: "public, max-age=31536000", // Cache por 1 año
    },
  });

  const url = `${baseUrl}/${key}`;
  console.log("[GCS] Upload successful, URL:", url);

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
 * Sube un video a GCS
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
 * Sube una imagen subida por usuario a GCS
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
 * Sube un audio a GCS
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
 * Sube musica temporal a GCS (para preview antes de guardar)
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
 * Sube musica final a GCS
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
 * Verifica si GCS está configurado
 */
export function isS3Configured(): boolean {
  return !!process.env.GCS_BUCKET;
}

/**
 * Extrae la key desde una URL de GCS o CloudFront (legacy)
 */
export function extractS3KeyFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    // Remove leading slash
    const path = urlObj.pathname.replace(/^\//, "");
    // For GCS URLs: storage.googleapis.com/BUCKET/key — remove bucket prefix
    const bucket = getBucket();
    if (path.startsWith(`${bucket}/`)) {
      return path.substring(bucket.length + 1);
    }
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Elimina un archivo de GCS
 */
export async function deleteFromS3(key: string): Promise<boolean> {
  try {
    await getStorageClient().bucket(getBucket()).file(key).delete();
    return true;
  } catch (error) {
    console.error("[GCS] Error deleting file:", error);
    return false;
  }
}
