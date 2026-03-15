/**
 * Video generation types for VEO 3 and VEO 3.1 models
 */

// ============================================
// CONFIGURATION TYPES
// ============================================

export type VideoDuration = number;
export type VideoResolution = "480p" | "720p" | "1080p" | "4K";
export type VideoAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3";
export type PersonGeneration = "allow_adult" | "allow_all" | "dont_allow";

export interface VideoGenerationSettings {
  duration: VideoDuration;
  resolution: VideoResolution;
  aspectRatio: VideoAspectRatio;
  audioEnabled: boolean;
  negativePrompt: string | null;
  personGeneration?: PersonGeneration;
}

// ============================================
// INPUT TYPES
// ============================================

export interface VideoInputFrames {
  firstFrame: string | null;  // Base64 encoded image
  lastFrame: string | null;   // Base64 encoded image
  referenceImages: string[];  // Up to 3 base64 encoded images
}

export interface VideoGenerationRequest {
  prompt: string;
  settings: VideoGenerationSettings;
  frames?: VideoInputFrames;
}

// ============================================
// OUTPUT TYPES
// ============================================

export interface VideoMetadata {
  url: string;
  mimeType: string;
  fileSize: number;
  duration: number;
  hasAudio: boolean;
  width?: number;
  height?: number;
}

export interface VideoMessage {
  video_url: string;
  video_mime_type: string;
  video_file_size: number | null;
  video_duration: number | null;
  video_has_audio: boolean;
}

// ============================================
// PROGRESS TYPES
// ============================================

export type VideoGenerationStatus = "pending" | "processing" | "completed" | "failed";

export interface VideoGenerationProgress {
  status: VideoGenerationStatus;
  message: string;
  progress?: number;
}

// ============================================
// DATABASE ROW TYPES
// ============================================

export interface VideoConversationRow {
  video_duration: number;
  video_resolution: string;
  video_aspect_ratio: string;
  video_audio_enabled: boolean;
  video_negative_prompt: string | null;
}

export interface VideoMessageRow {
  video_url: string | null;
  video_mime_type: string | null;
  video_file_size: number | null;
  video_duration: number | null;
  video_has_audio: boolean;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface VideoGenerationResponse {
  id: number;
  videoUrl: string;
  mimeType: string;
  duration: number;
  hasAudio: boolean;
  fileSize: number;
}

export interface VideoGalleryItem {
  id: number;
  conversation_id: number;
  conversation_user_id: number;
  conversation_title: string;
  video_url: string;
  video_mime_type: string;
  video_file_size: number | null;
  video_duration: number | null;
  video_has_audio: boolean;
  video_aspect_ratio: string;
  created_at: string;
}

// ============================================
// SSE EVENT TYPES
// ============================================

export interface VideoSSEUserMessage {
  type: "user_message";
  id: number;
}

export interface VideoSSEProgress {
  type: "progress";
  status: VideoGenerationStatus;
  message: string;
  progress?: number;
}

export interface VideoSSEVideo {
  type: "video";
  videoUrl: string;
  mimeType: string;
  duration: number;
  hasAudio: boolean;
  fileSize: number;
}

export interface VideoSSEComplete {
  type: "complete";
  id: number;
  videoUrl: string;
}

export interface VideoSSEError {
  type: "error";
  message: string;
}

export type VideoSSEEvent =
  | VideoSSEUserMessage
  | VideoSSEProgress
  | VideoSSEVideo
  | VideoSSEComplete
  | VideoSSEError;
