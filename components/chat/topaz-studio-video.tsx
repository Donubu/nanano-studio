"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigation } from "@/contexts/navigation-context";
import {
  X, Loader2, Download, Sparkles, History, Zap, AlertCircle,
  Video, Clock, Wand2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  TOPAZ_VIDEO_MODELS,
  TOPAZ_VIDEO_MODEL_GROUPS,
  type TopazVideoModel,
  type TopazVideoParameters,
} from "@/lib/topaz-video";

interface TopazVideoEdit {
  id: number;
  requestId: string;
  resultUrl: string | null;
  model: string;
  modelName: string;
  inputDuration: number;
  outputDuration: number | null;
  outputWidth: number | null;
  outputHeight: number | null;
  outputFileSize: number | null;
  parameters: {
    scaleFactor?: number;
    slowmoFactor?: number;
    denoise?: number;
    sharpen?: number;
    targetFps?: number;
    outputFormat?: string;
  } | null;
  creditsEstimated: number;
  creditsConsumed: number | null;
  status: string;
  errorMessage: string | null;
  processingTimeMs: number | null;
  createdAt: string;
}

interface EstimateResult {
  inputDuration: number;
  outputDuration: number;
  creditsRequired: number;
  estimatedProcessingTime: string;
  modelInfo: {
    name: string;
    description: string;
    supportsUpscale: boolean;
    supportsSlowmo: boolean;
    maxScaleFactor: number;
    maxSlowmoFactor: number;
  };
}

interface TopazStudioVideoProps {
  videoUrl: string;
  messageId: number;
  videoMetadata: {
    duration: number;
    width?: number;
    height?: number;
    fps?: number;
    hasAudio?: boolean;
    aspectRatio?: string;
  };
  onClose: () => void;
}

type ProcessingStep = "idle" | "creating" | "uploading" | "processing" | "completed" | "failed";

const SCALE_FACTORS = [1, 2, 4] as const;
const SLOWMO_FACTORS = [1, 2, 4, 8] as const;

export function TopazStudioVideo({
  videoUrl,
  messageId,
  videoMetadata,
  onClose,
}: TopazStudioVideoProps) {
  // Model and parameters
  const [selectedModel, setSelectedModel] = useState<TopazVideoModel>("prob-4");
  const [scaleFactor, setScaleFactor] = useState<1 | 2 | 4>(1);
  const [slowmoFactor, setSlowmoFactor] = useState<1 | 2 | 4 | 8>(1);
  const [outputFormat, setOutputFormat] = useState<"mp4" | "mov">("mp4");
  const [denoiseStrength, setDenoiseStrength] = useState(50);
  const [sharpenStrength, setSharpenStrength] = useState(50);

  // Get model config
  const modelConfig = useMemo(() => TOPAZ_VIDEO_MODELS[selectedModel], [selectedModel]);

  // UI state
  const [activeTab, setActiveTab] = useState<"config" | "history">("config");

  // Processing state
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [processingStep, setProcessingStep] = useState<ProcessingStep>("idle");
  const [processingProgress, setProcessingProgress] = useState(0);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultDimensions, setResultDimensions] = useState<{ width: number; height: number } | null>(null);

  // History
  const [history, setHistory] = useState<TopazVideoEdit[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Polling ref
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Video player ref
  const videoRef = useRef<HTMLVideoElement>(null);

  // Video dimensions (loaded from video element)
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number }>({
    width: videoMetadata.width || 0,
    height: videoMetadata.height || 0,
  });

  // Find existing processed version for current model with same parameters
  const existingEdit = useMemo(() => {
    return history.find(edit => {
      if (edit.model !== selectedModel || edit.status !== "completed") return false;
      // Compare scale factor (default to 1 if not set)
      const editScale = edit.parameters?.scaleFactor ?? 1;
      if (editScale !== scaleFactor) return false;
      // Compare slowmo factor (default to 1 if not set)
      const editSlowmo = edit.parameters?.slowmoFactor ?? 1;
      if (editSlowmo !== slowmoFactor) return false;
      return true;
    });
  }, [history, selectedModel, scaleFactor, slowmoFactor]);

  // Reset parameters when model changes
  useEffect(() => {
    if (!modelConfig.supportsUpscale) {
      setScaleFactor(1);
    }
    if (!modelConfig.supportsSlowmo) {
      setSlowmoFactor(1);
    }
  }, [modelConfig]);

  // Fetch estimate when parameters change
  useEffect(() => {
    const fetchEstimate = async () => {
      try {
        const params = new URLSearchParams({
          duration: String(videoMetadata.duration),
          model: selectedModel,
          scaleFactor: String(scaleFactor),
          slowmoFactor: String(slowmoFactor),
          width: String(videoDimensions.width),
          height: String(videoDimensions.height),
        });

        const response = await fetch(`/api/videos/topaz-studio/estimate?${params}`);
        if (response.ok) {
          const data = await response.json();
          setEstimate(data);
          setError(null);
        } else {
          const errData = await response.json();
          setError(errData.error);
          setEstimate(null);
        }
      } catch {
        setError("Error calculando estimación");
      }
    };

    fetchEstimate();
  }, [videoMetadata.duration, selectedModel, scaleFactor, slowmoFactor, videoDimensions]);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    if (!messageId) return;
    setLoadingHistory(true);
    try {
      const response = await fetch(`/api/videos/topaz-studio/history/${messageId}`);
      if (response.ok) {
        const data = await response.json();
        setHistory(data.edits || []);
      }
    } catch {
      console.error("Error fetching history");
    } finally {
      setLoadingHistory(false);
    }
  }, [messageId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Register with navigation system
  const navigation = useNavigation();
  useEffect(() => {
    navigation.registerLayer(onClose);
  }, [navigation, onClose]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
      }
    };
  }, []);

  // Poll for status
  const pollStatus = useCallback(async (reqId: string) => {
    try {
      const response = await fetch(`/api/videos/topaz-studio/${reqId}/status`);
      const data = await response.json();

      if (data.status === "completed") {
        setProcessingStep("completed");
        setResultUrl(data.resultUrl);
        setProcessingProgress(100);
        if (data.outputWidth && data.outputHeight) {
          setResultDimensions({ width: data.outputWidth, height: data.outputHeight });
        }
        fetchHistory();
        return; // Stop polling
      }

      if (data.status === "failed") {
        setProcessingStep("failed");
        setError(data.error || "Error en procesamiento");
        return; // Stop polling
      }

      // Still processing
      if (data.progress) {
        setProcessingProgress(data.progress);
      }

      // Continue polling
      pollingRef.current = setTimeout(() => pollStatus(reqId), 5000);
    } catch (err) {
      console.error("Error polling status:", err);
      // Retry after delay
      pollingRef.current = setTimeout(() => pollStatus(reqId), 10000);
    }
  }, [fetchHistory]);

  // Process video
  const handleProcess = async () => {
    if (!estimate || processingStep !== "idle") return;

    setProcessingStep("creating");
    setError(null);
    setResultUrl(null);
    setProcessingProgress(0);

    try {
      // Build parameters
      const parameters: TopazVideoParameters = {
        outputFormat,
      };
      if (modelConfig.supportsUpscale && scaleFactor > 1) {
        parameters.scaleFactor = scaleFactor as 1 | 2 | 4;
      }
      if (modelConfig.supportsSlowmo && slowmoFactor > 1) {
        parameters.slowmoFactor = slowmoFactor as 2 | 4 | 8;
      }
      // Add denoise/sharpen for applicable models
      if (modelConfig.category === "denoise") {
        parameters.denoiseStrength = denoiseStrength;
      }
      if (modelConfig.category === "denoise" || modelConfig.category === "upscaling") {
        parameters.sharpenStrength = sharpenStrength;
      }

      // Create job - use videoDimensions which are loaded from the video element
      const createResponse = await fetch("/api/videos/topaz-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl,
          messageId,
          duration: videoMetadata.duration,
          width: videoDimensions.width || 1920,
          height: videoDimensions.height || 1080,
          fps: videoMetadata.fps || 30,
          model: selectedModel,
          parameters,
        }),
      });

      if (!createResponse.ok) {
        const errData = await createResponse.json();
        throw new Error(errData.error || "Error creando job");
      }

      const createData = await createResponse.json();
      setRequestId(createData.requestId);

      // Upload video through our proxy (needed to get eTag due to CORS)
      setProcessingStep("uploading");
      const videoResponse = await fetch(videoUrl);
      const videoBlob = await videoResponse.blob();

      const formData = new FormData();
      formData.append("uploadUrl", createData.uploadUrl);
      formData.append("video", videoBlob, "video.mp4");

      const uploadProxyResponse = await fetch(`/api/videos/topaz-studio/${createData.requestId}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!uploadProxyResponse.ok) {
        const errData = await uploadProxyResponse.json();
        throw new Error(errData.error || "Error subiendo video");
      }

      const uploadData = await uploadProxyResponse.json();
      const eTag = uploadData.eTag;

      // Signal upload complete with eTag
      const completeResponse = await fetch(`/api/videos/topaz-studio/${createData.requestId}/complete-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eTag }),
      });

      if (!completeResponse.ok) {
        const errData = await completeResponse.json();
        throw new Error(errData.error || "Error completando upload");
      }

      // Start processing
      setProcessingStep("processing");

      // Start polling for status
      pollStatus(createData.requestId);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setProcessingStep("failed");
    }
  };

  // Download video
  const handleDownload = async (url: string, suffix: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      const fileName = url.split("/").pop() || `topaz-video-${suffix}.${outputFormat}`;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Error downloading:", err);
    }
  };

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  // Format date as dd-mm-yyyy HH:mm:ss (sin conversión de timezone)
  const formatDateTime = (dateStr: string) => {
    const str = String(dateStr);
    const [datePart, timePart] = str.includes("T") ? str.split("T") : str.split(" ");
    const [year, month, day] = datePart.split("-");
    const [hours, minutes, seconds] = (timePart || "00:00:00").split(":");
    return `${day}-${month}-${year} ${hours}:${minutes}:${seconds?.split(".")[0] || "00"}`;
  };

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isProcessing = processingStep !== "idle" && processingStep !== "completed" && processingStep !== "failed";

  return (
    <div className="fixed inset-0 bg-black/95 z-[60] flex" onClick={onClose}>
      <div
        className="flex flex-1 max-h-screen overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Video Preview */}
        <div className="flex-1 flex flex-col p-6 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Video className="h-6 w-6 text-purple-400" />
              <h2 className="text-xl font-semibold text-white">Topaz Video Studio</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="h-5 w-5 text-white" />
            </button>
          </div>

          {/* Video display */}
          <div className="flex-1 flex items-center justify-center bg-black/50 rounded-xl overflow-hidden relative">
            <video
              ref={videoRef}
              src={resultUrl || videoUrl}
              className="max-w-full max-h-full object-contain"
              loop
              playsInline
              controls
              onLoadedMetadata={(e) => {
                const video = e.target as HTMLVideoElement;
                if (video.videoWidth && video.videoHeight) {
                  setVideoDimensions({
                    width: video.videoWidth,
                    height: video.videoHeight,
                  });
                }
              }}
            />

            {/* Processing overlay */}
            {isProcessing && (
              <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                <div className="text-center">
                  <Loader2 className="h-12 w-12 text-purple-400 animate-spin mx-auto mb-4" />
                  <p className="text-white font-medium">
                    {processingStep === "creating" && "Creando job..."}
                    {processingStep === "uploading" && "Subiendo video..."}
                    {processingStep === "processing" && `Procesando con ${TOPAZ_VIDEO_MODELS[selectedModel].name}...`}
                  </p>
                  {processingStep === "processing" && processingProgress > 0 && (
                    <div className="mt-4 w-64 mx-auto">
                      <div className="h-2 w-full bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500 transition-all duration-300"
                          style={{ width: `${processingProgress}%` }}
                        />
                      </div>
                      <p className="text-sm text-gray-400 mt-2">{processingProgress}%</p>
                    </div>
                  )}
                  <p className="text-sm text-gray-400 mt-2">
                    Esto puede tomar varios minutos
                  </p>
                </div>
              </div>
            )}
            {existingEdit && !resultUrl && !isProcessing && (
              <div className="absolute top-3 left-3 bg-green-600/90 text-white text-xs px-2 py-1 rounded">
                Ya procesado
              </div>
            )}
          </div>

          {/* Video info */}
          <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                <span>{formatDuration(videoMetadata.duration)}</span>
              </div>
              {videoDimensions.width > 0 && videoDimensions.height > 0 && (
                <span>{videoDimensions.width}×{videoDimensions.height}</span>
              )}
              {estimate && scaleFactor > 1 && videoDimensions.width > 0 && (
                <span className="text-purple-400">
                  → {videoDimensions.width * scaleFactor}×{videoDimensions.height * scaleFactor}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownload(videoUrl, "original")}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Original
              </Button>
              {(resultUrl || existingEdit?.resultUrl) && (
                <Button
                  size="sm"
                  onClick={() => handleDownload(resultUrl || existingEdit!.resultUrl!, "enhanced")}
                  className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
                >
                  <Download className="h-4 w-4" />
                  Enhanced
                  {(resultDimensions || (existingEdit?.outputWidth && existingEdit?.outputHeight)) && (
                    <span className="text-purple-200 text-xs ml-1">
                      ({resultDimensions?.width || existingEdit?.outputWidth}×{resultDimensions?.height || existingEdit?.outputHeight})
                    </span>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Right: Controls */}
        <div className="w-96 bg-sidebar border-l border-border/50 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-border/50">
            <button
              className={cn(
                "flex-1 px-4 py-3 text-sm font-medium transition-colors",
                activeTab === "config"
                  ? "text-purple-400 border-b-2 border-purple-400"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setActiveTab("config")}
            >
              <Sparkles className="h-4 w-4 inline mr-2" />
              Configuración
            </button>
            <button
              className={cn(
                "flex-1 px-4 py-3 text-sm font-medium transition-colors",
                activeTab === "history"
                  ? "text-purple-400 border-b-2 border-purple-400"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setActiveTab("history")}
            >
              <History className="h-4 w-4 inline mr-2" />
              Historial
              {history.length > 0 && (
                <span className="ml-1 text-xs bg-purple-500/20 px-1.5 py-0.5 rounded">
                  {history.length}
                </span>
              )}
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === "config" ? (
              <div className="space-y-6">
                {/* Model Selection */}
                <div className="space-y-2">
                  <Label>Modelo</Label>
                  <Select
                    value={selectedModel}
                    onValueChange={(v) => setSelectedModel(v as TopazVideoModel)}
                    disabled={isProcessing}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[70]">
                      {Object.entries(TOPAZ_VIDEO_MODEL_GROUPS).map(([key, group]) => (
                        <SelectGroup key={key}>
                          <SelectLabel>{group.label}</SelectLabel>
                          {group.models.map((model) => (
                            <SelectItem key={model} value={model}>
                              <div className="flex items-center gap-2">
                                <span>{TOPAZ_VIDEO_MODELS[model].name}</span>
                                {TOPAZ_VIDEO_MODELS[model].recommended && (
                                  <span className="text-xs bg-purple-500/20 text-purple-400 px-1 rounded">
                                    Recomendado
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {modelConfig.description}
                  </p>
                </div>

                {/* Scale Factor */}
                {modelConfig.supportsUpscale && (
                  <div className="space-y-2">
                    <Label>Escala</Label>
                    <div className="flex gap-2">
                      {SCALE_FACTORS.map((factor) => (
                        <Button
                          key={factor}
                          variant={scaleFactor === factor ? "default" : "outline"}
                          size="sm"
                          className={cn(
                            "flex-1",
                            scaleFactor === factor && "bg-purple-600 hover:bg-purple-700"
                          )}
                          onClick={() => setScaleFactor(factor)}
                          disabled={isProcessing || factor > modelConfig.maxScaleFactor}
                        >
                          {factor}x
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Slowmo Factor */}
                {modelConfig.supportsSlowmo && (
                  <div className="space-y-2">
                    <Label>Cámara lenta</Label>
                    <div className="flex gap-2">
                      {SLOWMO_FACTORS.map((factor) => (
                        <Button
                          key={factor}
                          variant={slowmoFactor === factor ? "default" : "outline"}
                          size="sm"
                          className={cn(
                            "flex-1",
                            slowmoFactor === factor && "bg-purple-600 hover:bg-purple-700"
                          )}
                          onClick={() => setSlowmoFactor(factor)}
                          disabled={isProcessing || factor > modelConfig.maxSlowmoFactor}
                        >
                          {factor === 1 ? "Normal" : `${factor}x`}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Denoise Strength - for denoise category models */}
                {modelConfig.category === "denoise" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Reducción de ruido</Label>
                      <span className="text-sm text-muted-foreground">{denoiseStrength}%</span>
                    </div>
                    <Slider
                      value={[denoiseStrength]}
                      onValueChange={([v]) => setDenoiseStrength(v)}
                      min={0}
                      max={100}
                      step={5}
                      disabled={isProcessing}
                      className="w-full"
                    />
                  </div>
                )}

                {/* Sharpen Strength - for denoise and upscaling models */}
                {(modelConfig.category === "denoise" || modelConfig.category === "upscaling") && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Nitidez</Label>
                      <span className="text-sm text-muted-foreground">{sharpenStrength}%</span>
                    </div>
                    <Slider
                      value={[sharpenStrength]}
                      onValueChange={([v]) => setSharpenStrength(v)}
                      min={0}
                      max={100}
                      step={5}
                      disabled={isProcessing}
                      className="w-full"
                    />
                  </div>
                )}

                {/* Output Format */}
                <div className="space-y-2">
                  <Label>Formato de salida</Label>
                  <div className="flex gap-2">
                    {(["mp4", "mov"] as const).map((format) => (
                      <Button
                        key={format}
                        variant={outputFormat === format ? "default" : "outline"}
                        size="sm"
                        className={cn(
                          "flex-1",
                          outputFormat === format && "bg-purple-600 hover:bg-purple-700"
                        )}
                        onClick={() => setOutputFormat(format)}
                        disabled={isProcessing}
                      >
                        {format.toUpperCase()}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Estimate */}
                {estimate && (
                  <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Duración salida</span>
                      <span className="font-medium">{formatDuration(estimate.outputDuration)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Tiempo estimado</span>
                      <span className="font-medium">{estimate.estimatedProcessingTime}</span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-purple-500/20">
                      <span className="text-sm font-medium flex items-center gap-1">
                        <Zap className="h-4 w-4 text-yellow-400" />
                        Créditos
                      </span>
                      <span className="font-bold text-lg">{estimate.creditsRequired}</span>
                    </div>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
                  </div>
                )}

                {/* Existing edit notice */}
                {existingEdit && (
                  <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                    <p className="text-sm text-green-700 dark:text-green-400 font-medium">
                      Ya existe una versión procesada con esta configuración
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full"
                      onClick={() => existingEdit.resultUrl && handleDownload(existingEdit.resultUrl, "enhanced")}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Descargar existente
                    </Button>
                  </div>
                )}

                {/* Process button */}
                <Button
                  className="w-full bg-purple-600 hover:bg-purple-700"
                  size="lg"
                  onClick={handleProcess}
                  disabled={!estimate || isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4 mr-2" />
                      Mejorar Video
                    </>
                  )}
                </Button>

                {/* Result actions */}
                {resultUrl && (
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => handleDownload(resultUrl, "enhanced")}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Descargar resultado
                  </Button>
                )}
              </div>
            ) : (
              /* History Tab */
              <div className="space-y-3">
                {loadingHistory ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : history.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Video className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No hay mejoras anteriores</p>
                  </div>
                ) : (
                  history.map((edit) => (
                    <div
                      key={edit.id}
                      className="p-3 rounded-lg bg-card border border-border hover:border-purple-500/30 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">{edit.modelName}</span>
                        <span className={cn(
                          "text-xs px-2 py-0.5 rounded-full",
                          edit.status === "completed" && "bg-green-500/20 text-green-400",
                          edit.status === "processing" && "bg-yellow-500/20 text-yellow-400",
                          edit.status === "failed" && "bg-red-500/20 text-red-400"
                        )}>
                          {edit.status === "completed" && "Completado"}
                          {edit.status === "processing" && "Procesando"}
                          {edit.status === "failed" && "Error"}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div className="flex justify-between">
                          <span>Duración</span>
                          <span>{formatDuration(edit.outputDuration || edit.inputDuration)}</span>
                        </div>
                        {edit.outputWidth && edit.outputHeight && (
                          <div className="flex justify-between">
                            <span>Resolución</span>
                            <span>{edit.outputWidth}×{edit.outputHeight}</span>
                          </div>
                        )}
                        {edit.outputFileSize && (
                          <div className="flex justify-between">
                            <span>Tamaño</span>
                            <span>{formatFileSize(edit.outputFileSize)}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span>Créditos</span>
                          <span>{edit.creditsConsumed || edit.creditsEstimated}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Fecha</span>
                          <span>{formatDateTime(edit.createdAt)}</span>
                        </div>
                      </div>
                      {edit.status === "completed" && edit.resultUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full mt-2"
                          onClick={() => handleDownload(edit.resultUrl!, edit.modelName)}
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Descargar
                        </Button>
                      )}
                      {edit.status === "failed" && edit.errorMessage && (
                        <p className="text-xs text-red-400 mt-2">{edit.errorMessage}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
