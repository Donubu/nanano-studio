"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import NextImage from "next/image";
import { useNavigation } from "@/contexts/navigation-context";
import {
  X, Loader2, Download, Sparkles, Settings2, User,
  ChevronDown, ChevronUp, History, Zap, AlertCircle, Wand2, Image as ImageIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// Model configuration - matches cost-calculator.ts
type TopazModelType = "standard" | "generative";

interface TopazModelConfig {
  shortCode: string;
  type: TopazModelType;
  async: boolean;
  maxMP: number;
  description: string;
}

const TOPAZ_MODELS: Record<string, TopazModelConfig> = {
  // Standard Models
  "Standard V2": {
    shortCode: "std",
    type: "standard",
    async: false,
    maxMP: 512,
    description: "Default, mejor para imágenes de alta calidad",
  },
  "High Fidelity V2": {
    shortCode: "hifi",
    type: "standard",
    async: false,
    maxMP: 512,
    description: "Preserva grano/ruido original para estética",
  },
  "Low Resolution V2": {
    shortCode: "lowres",
    type: "standard",
    async: false,
    maxMP: 512,
    description: "Para imágenes comprimidas o de baja calidad",
  },
  "CGI": {
    shortCode: "cgi",
    type: "standard",
    async: false,
    maxMP: 512,
    description: "Optimizado para arte digital y CGI",
  },
  "Text Refine": {
    shortCode: "text",
    type: "standard",
    async: false,
    maxMP: 512,
    description: "Optimizado para imágenes con texto",
  },
  // Generative Models
  "Wonder": {
    shortCode: "wonder",
    type: "generative",
    async: true,
    maxMP: 128,
    description: "Para fotos antiguas, caras pequeñas, ruido pesado",
  },
  "Redefine": {
    shortCode: "redefine",
    type: "generative",
    async: true,
    maxMP: 128,
    description: "Añade definición y detalle, modo realista o creativo",
  },
  "Recovery V2": {
    shortCode: "recovery",
    type: "generative",
    async: true,
    maxMP: 128,
    description: "Para fotos viejas y de baja calidad (<1MP)",
  },
};

type TopazModel = keyof typeof TOPAZ_MODELS;
type TopazScaleFactor = 2 | 3 | 4 | 5 | 6;

interface TopazParameters {
  // Standard model parameters
  sharpen?: number;
  denoise?: number;
  detail?: number;
  minorDeblur?: number;
  minorDenoise?: number;
  fixCompression?: number;
  // Generative model parameters
  creativity?: number;
  texture?: number;
  // Common parameters
  faceEnhancement?: boolean;
  faceEnhancementStrength?: number;
  outputFormat?: "jpeg" | "png" | "tiff";
}

interface TopazEdit {
  id: number;
  result_url: string;
  model: string;
  scale_factor: number;
  output_width: number;
  output_height: number;
  credits_consumed: number;
  created_at: string;
}

interface EstimateResult {
  outputWidth: number;
  outputHeight: number;
  outputMegapixels: number;
  creditsRequired: number;
}

interface ProcessResult {
  url: string;
  editId: number;
  creditsConsumed: number;
  processingTimeMs: number;
  outputWidth: number;
  outputHeight: number;
  fileSize: number;
}

interface TopazStudioProps {
  imageUrl: string;
  messageId: number;
  imageDimensions: { width: number; height: number };
  onClose: () => void;
}

const SCALE_FACTORS: TopazScaleFactor[] = [2, 3, 4, 5, 6];

export function TopazStudio({ imageUrl, messageId, imageDimensions, onClose }: TopazStudioProps) {
  // Model and scale
  const [selectedModel, setSelectedModel] = useState<TopazModel>("Standard V2");
  const [scaleFactor, setScaleFactor] = useState<TopazScaleFactor>(2);

  // Get model config
  const modelConfig = useMemo(() => TOPAZ_MODELS[selectedModel], [selectedModel]);
  const isGenerativeModel = modelConfig?.type === "generative";

  // Standard model parameters
  const [sharpen, setSharpen] = useState(0);
  const [denoise, setDenoise] = useState(0);
  const [detail, setDetail] = useState(0);
  const [minorDeblur, setMinorDeblur] = useState(0);
  const [minorDenoise, setMinorDenoise] = useState(0);
  const [fixCompression, setFixCompression] = useState(0);

  // Generative model parameters
  const [creativity, setCreativity] = useState(3);
  const [texture, setTexture] = useState(2);

  // Common parameters
  const [faceEnhancement, setFaceEnhancement] = useState(false);
  const [faceStrength, setFaceStrength] = useState(0.8);
  const [outputFormat, setOutputFormat] = useState<"jpeg" | "png" | "tiff">("png");

  // UI state
  const [activeTab, setActiveTab] = useState<"config" | "history">("config");
  const [showEnhancement, setShowEnhancement] = useState(true);
  const [showFaceEnhancement, setShowFaceEnhancement] = useState(false);

  // Processing state
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessResult | null>(null);

  // History
  const [history, setHistory] = useState<TopazEdit[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Face enhancement disabled for generative models with high creativity
  const faceEnhancementDisabled = isGenerativeModel && creativity >= 3;

  // Find existing processed version for current model/scale
  const existingEdit = useMemo(() => {
    return history.find(
      edit => edit.model === selectedModel && edit.scale_factor === scaleFactor
    );
  }, [history, selectedModel, scaleFactor]);

  // Get scales that have been generated for current model
  const generatedScales = useMemo(() => {
    const scales = new Set<number>();
    history.forEach(edit => {
      if (edit.model === selectedModel) {
        scales.add(edit.scale_factor);
      }
    });
    return scales;
  }, [history, selectedModel]);

  // Get models that have any generated version
  const generatedModels = useMemo(() => {
    const models = new Set<string>();
    history.forEach(edit => {
      models.add(edit.model);
    });
    return models;
  }, [history]);

  // Fetch estimate when parameters change
  useEffect(() => {
    const fetchEstimate = async () => {
      try {
        const params = new URLSearchParams({
          width: String(imageDimensions.width),
          height: String(imageDimensions.height),
          scaleFactor: String(scaleFactor),
          model: selectedModel,
        });

        const response = await fetch(`/api/images/topaz-studio/estimate?${params}`);
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
  }, [imageDimensions.width, imageDimensions.height, scaleFactor, selectedModel]);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const response = await fetch(`/api/images/topaz-studio/history/${messageId}`);
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

  // Register with navigation system (handles Escape and browser back)
  const navigation = useNavigation();
  useEffect(() => {
    // Register layer so Escape closes Topaz Studio
    navigation.registerLayer(onClose);
  }, [navigation, onClose]);

  // Process image
  const handleProcess = async () => {
    if (!estimate || processing) return;

    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const parameters: TopazParameters = {
        outputFormat,
        faceEnhancement: faceEnhancementDisabled ? false : faceEnhancement,
        faceEnhancementStrength: faceEnhancement && !faceEnhancementDisabled ? faceStrength : undefined,
      };

      if (isGenerativeModel) {
        // Generative model parameters
        parameters.creativity = creativity;
        parameters.texture = texture;
      } else {
        // Standard model parameters
        if (sharpen > 0) parameters.sharpen = sharpen;
        if (denoise > 0) parameters.denoise = denoise;
        if (detail > 0) parameters.detail = detail;
        if (minorDeblur > 0) parameters.minorDeblur = minorDeblur;
        if (minorDenoise > 0) parameters.minorDenoise = minorDenoise;
        if (fixCompression > 0) parameters.fixCompression = fixCompression;
      }

      const response = await fetch("/api/images/topaz-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          messageId,
          width: imageDimensions.width,
          height: imageDimensions.height,
          scaleFactor,
          model: selectedModel,
          parameters,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Error procesando imagen");
      }

      const data = await response.json();
      setResult(data);
      fetchHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setProcessing(false);
    }
  };

  // Download image
  const handleDownload = async (url: string, suffix: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      const fileName = url.split("/").pop() || `topaz-${suffix}.${outputFormat}`;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Error downloading:", err);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Group models by type
  const standardModels = Object.entries(TOPAZ_MODELS).filter(([, config]) => config.type === "standard");
  const generativeModels = Object.entries(TOPAZ_MODELS).filter(([, config]) => config.type === "generative");

  return (
    <div className="fixed inset-0 bg-black/95 z-[60] flex" onClick={onClose}>
      <div
        className="flex flex-1 max-h-screen overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: Image Preview */}
        <div className="flex-1 flex flex-col p-6 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Sparkles className="h-6 w-6 text-purple-400" />
              <h2 className="text-xl font-semibold text-white">Topaz Studio</h2>
              {modelConfig?.async && (
                <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">
                  Async
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="h-5 w-5 text-white" />
            </button>
          </div>

          {/* Image display */}
          <div className="flex-1 flex items-center justify-center bg-black/50 rounded-xl overflow-hidden relative">
            <div className="relative w-full h-full">
              <NextImage
                src={result?.url || existingEdit?.result_url || imageUrl}
                alt="Preview"
                fill
                className="object-contain"
                sizes="(max-width: 1280px) 60vw, 800px"
                unoptimized
                priority
              />
            </div>
            {processing && (
              <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                <div className="text-center">
                  <Loader2 className="h-12 w-12 text-purple-400 animate-spin mx-auto mb-4" />
                  <p className="text-white font-medium">Procesando con {selectedModel}...</p>
                  <p className="text-sm text-gray-400 mt-2">
                    {modelConfig?.async ? "Esto puede tomar varios minutos" : "Esto puede tomar unos segundos"}
                  </p>
                </div>
              </div>
            )}
            {existingEdit && !result && !processing && (
              <div className="absolute top-3 left-3 bg-green-600/90 text-white text-xs px-2 py-1 rounded">
                Ya procesado
              </div>
            )}
          </div>

          {/* Image info */}
          <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
            <div className="flex items-center gap-4">
              <span>Original: {imageDimensions.width} × {imageDimensions.height}</span>
              {(result || existingEdit) ? (
                <span className="text-green-400">
                  → {result?.outputWidth || existingEdit?.output_width} × {result?.outputHeight || existingEdit?.output_height}
                </span>
              ) : estimate && (
                <span className="text-purple-400">
                  → {estimate.outputWidth} × {estimate.outputHeight} ({estimate.outputMegapixels.toFixed(1)} MP)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownload(imageUrl, "original")}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Original
              </Button>
              {(result || existingEdit) && (
                <Button
                  size="sm"
                  onClick={() => handleDownload(result?.url || existingEdit!.result_url, `${scaleFactor}x`)}
                  className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
                >
                  <Download className="h-4 w-4" />
                  {scaleFactor}x
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
              onClick={() => setActiveTab("config")}
              className={cn(
                "flex-1 py-3 text-sm font-medium transition-colors",
                activeTab === "config"
                  ? "text-purple-400 border-b-2 border-purple-400"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Configuración
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={cn(
                "flex-1 py-3 text-sm font-medium transition-colors relative",
                activeTab === "history"
                  ? "text-purple-400 border-b-2 border-purple-400"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Historial
              {history.length > 0 && (
                <span className="ml-1.5 text-xs bg-purple-600 text-white px-1.5 py-0.5 rounded-full">
                  {history.length}
                </span>
              )}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeTab === "config" ? (
              <>
            {/* Model Selection */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Modelo</Label>
              <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v as TopazModel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[70]">
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    Standard (Rápido)
                  </div>
                  {standardModels.map(([model, config]) => (
                    <SelectItem key={model} value={model}>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span>{model}</span>
                          {generatedModels.has(model) && (
                            <span className="w-2 h-2 bg-green-500 rounded-full" />
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{config.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-t mt-1 pt-2">
                    Generativo (Creativo)
                  </div>
                  {generativeModels.map(([model, config]) => (
                    <SelectItem key={model} value={model}>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span>{model}</span>
                          <span className="text-xs bg-amber-500/20 text-amber-500 px-1 rounded">async</span>
                          {generatedModels.has(model) && (
                            <span className="w-2 h-2 bg-green-500 rounded-full" />
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{config.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Scale Factor */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Escala</Label>
              <div className="flex gap-2">
                {SCALE_FACTORS.map((factor) => {
                  const isGenerated = generatedScales.has(factor);
                  return (
                    <button
                      key={factor}
                      onClick={() => setScaleFactor(factor)}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-sm font-medium transition-colors relative",
                        scaleFactor === factor
                          ? "bg-purple-600 text-white"
                          : isGenerated
                            ? "bg-green-600/20 text-green-400 border border-green-500/50 hover:bg-green-600/30"
                            : "bg-accent hover:bg-accent/80 text-foreground"
                      )}
                    >
                      {factor}x
                      {isGenerated && scaleFactor !== factor && (
                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Model-specific Parameters */}
            <Collapsible open={showEnhancement} onOpenChange={setShowEnhancement}>
              <CollapsibleTrigger className="flex items-center justify-between w-full py-2">
                <div className="flex items-center gap-2">
                  {isGenerativeModel ? (
                    <Wand2 className="h-4 w-4 text-purple-400" />
                  ) : (
                    <Zap className="h-4 w-4 text-blue-400" />
                  )}
                  <span className="text-sm font-medium">
                    {isGenerativeModel ? "Parámetros Generativos" : "Parámetros de Enhancement"}
                  </span>
                </div>
                {showEnhancement ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-2">
                {isGenerativeModel ? (
                  // Generative model parameters
                  <>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Creatividad</span>
                        <span className="text-muted-foreground">{creativity}</span>
                      </div>
                      <Slider
                        value={[creativity]}
                        onValueChange={([v]) => setCreativity(v)}
                        min={1}
                        max={6}
                        step={1}
                      />
                      <p className="text-xs text-muted-foreground">
                        Bajo = más fiel al original, Alto = más creativo
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Textura</span>
                        <span className="text-muted-foreground">{texture}</span>
                      </div>
                      <Slider
                        value={[texture]}
                        onValueChange={([v]) => setTexture(v)}
                        min={1}
                        max={5}
                        step={1}
                      />
                      <p className="text-xs text-muted-foreground">
                        Cantidad de textura/detalle generado
                      </p>
                    </div>
                    {creativity >= 3 && (
                      <div className="bg-amber-500/10 text-amber-400 text-xs px-3 py-2 rounded-lg">
                        Face Enhancement desactivado con creatividad ≥3
                      </div>
                    )}
                  </>
                ) : (
                  // Standard model parameters
                  <>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Sharpen</span>
                        <span className="text-muted-foreground">{sharpen.toFixed(2)}</span>
                      </div>
                      <Slider
                        value={[sharpen]}
                        onValueChange={([v]) => setSharpen(v)}
                        min={0}
                        max={1}
                        step={0.05}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Denoise</span>
                        <span className="text-muted-foreground">{denoise.toFixed(2)}</span>
                      </div>
                      <Slider
                        value={[denoise]}
                        onValueChange={([v]) => setDenoise(v)}
                        min={0}
                        max={1}
                        step={0.05}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Detail</span>
                        <span className="text-muted-foreground">{detail.toFixed(2)}</span>
                      </div>
                      <Slider
                        value={[detail]}
                        onValueChange={([v]) => setDetail(v)}
                        min={0}
                        max={1}
                        step={0.05}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Minor Deblur</span>
                        <span className="text-muted-foreground">{minorDeblur.toFixed(2)}</span>
                      </div>
                      <Slider
                        value={[minorDeblur]}
                        onValueChange={([v]) => setMinorDeblur(v)}
                        min={0}
                        max={1}
                        step={0.05}
                      />
                      <p className="text-xs text-muted-foreground">
                        Contrarresta suavizado del denoise
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Minor Denoise</span>
                        <span className="text-muted-foreground">{minorDenoise.toFixed(2)}</span>
                      </div>
                      <Slider
                        value={[minorDenoise]}
                        onValueChange={([v]) => setMinorDenoise(v)}
                        min={0}
                        max={1}
                        step={0.05}
                      />
                      <p className="text-xs text-muted-foreground">
                        Reduce ruido adicional sin perder detalle
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Fix Compression</span>
                        <span className="text-muted-foreground">{fixCompression.toFixed(2)}</span>
                      </div>
                      <Slider
                        value={[fixCompression]}
                        onValueChange={([v]) => setFixCompression(v)}
                        min={0}
                        max={1}
                        step={0.05}
                      />
                      <p className="text-xs text-muted-foreground">
                        Reduce artefactos de compresión JPEG
                      </p>
                    </div>
                  </>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* Face Enhancement */}
            <Collapsible open={showFaceEnhancement} onOpenChange={setShowFaceEnhancement}>
              <CollapsibleTrigger className="flex items-center justify-between w-full py-2">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Face Enhancement</span>
                  {faceEnhancementDisabled && (
                    <span className="text-xs text-amber-400">(desactivado)</span>
                  )}
                </div>
                {showFaceEnhancement ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="face-enhance" className="text-sm">Activar</Label>
                  <Switch
                    id="face-enhance"
                    checked={faceEnhancement && !faceEnhancementDisabled}
                    onCheckedChange={setFaceEnhancement}
                    disabled={faceEnhancementDisabled}
                  />
                </div>
                {faceEnhancement && !faceEnhancementDisabled && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Intensidad</span>
                      <span className="text-muted-foreground">{faceStrength.toFixed(1)}</span>
                    </div>
                    <Slider
                      value={[faceStrength]}
                      onValueChange={([v]) => setFaceStrength(v)}
                      min={0}
                      max={1}
                      step={0.1}
                    />
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* Output Format */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Formato de salida</Label>
              <Select value={outputFormat} onValueChange={(v) => setOutputFormat(v as "jpeg" | "png" | "tiff")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[70]">
                  <SelectItem value="png">PNG (sin pérdida)</SelectItem>
                  <SelectItem value="jpeg">JPEG (comprimido)</SelectItem>
                  <SelectItem value="tiff">TIFF (profesional)</SelectItem>
                </SelectContent>
              </Select>
            </div>

              </>
            ) : (
              /* History Tab */
              <div className="space-y-3">
                {loadingHistory ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : history.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No hay imágenes procesadas</p>
                    <p className="text-xs mt-1">Las imágenes aparecerán aquí después de procesarlas</p>
                  </div>
                ) : (
                  history.map((edit) => {
                    const date = new Date(edit.created_at);
                    const formattedDate = date.toLocaleDateString("es-CL", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    const megapixels = (edit.output_width * edit.output_height) / 1_000_000;

                    return (
                      <div
                        key={edit.id}
                        className="p-3 rounded-lg bg-card border border-border hover:border-purple-500/30 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{edit.model}</span>
                            <span className="text-xs bg-purple-600 text-white px-1.5 py-0.5 rounded">
                              {edit.scale_factor}x
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">{formattedDate}</span>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <div className="flex justify-between">
                            <span>Resolución</span>
                            <span>{edit.output_width} × {edit.output_height}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Megapíxeles</span>
                            <span>{megapixels.toFixed(1)} MP</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Créditos</span>
                            <span>{edit.credits_consumed}</span>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownload(edit.result_url, `${edit.scale_factor}x`)}
                          className="w-full mt-2"
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Descargar
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Footer: Credits & Process Button */}
          <div className="border-t border-border/50 p-4 space-y-3">
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {estimate && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Créditos estimados</span>
                <span className="font-semibold text-purple-400">{estimate.creditsRequired}</span>
              </div>
            )}

            {result && (
              <div className="text-sm text-green-700 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg font-medium">
                Procesado en {(result.processingTimeMs / 1000).toFixed(1)}s • {result.creditsConsumed} créditos
              </div>
            )}

            <Button
              onClick={handleProcess}
              disabled={processing || !estimate || !!error}
              className="w-full gap-2 bg-purple-600 hover:bg-purple-700"
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Procesar con {selectedModel}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
