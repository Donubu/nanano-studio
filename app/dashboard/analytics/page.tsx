"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Zap,
  DollarSign,
  ImageIcon,
  Video,
  Music,
  MessageSquare,
  TrendingUp,
  TrendingDown,
  Users,
  FolderKanban,
  BarChart3,
  Sparkles,
  Volume2,
  Calculator,
  FileCheck,
  FileClock,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";

interface DailyStat {
  date: string;
  tokensInput: number;
  tokensOutput: number;
  totalTokens: number;
  estimatedCost: number;
  imageCount: number;
  videoCount: number;
  musicCount: number;
  audioCount: number;
  audioHdCount: number;
  messageCount: number;
}

interface ModelBreakdown {
  modelId: number;
  modelName: string;
  tokensInput: number;
  tokensOutput: number;
  estimatedCost: number;
  imageCount: number;
  videoCount: number;
  musicCount: number;
  audioCount: number;
  audioHdCount: number;
  messageCount: number;
}

interface UserBreakdown {
  userId: number;
  userName: string;
  tokensInput: number;
  tokensOutput: number;
  estimatedCost: number;
  imageCount: number;
  videoCount: number;
  musicCount: number;
  audioCount: number;
  audioHdCount: number;
  messageCount: number;
  conversationCount: number;
}

interface ProjectBreakdown {
  projectId: number;
  projectName: string;
  clientName: string | null;
  tokensInput: number;
  tokensOutput: number;
  estimatedCost: number;
  imageCount: number;
  videoCount: number;
  musicCount: number;
  audioCount: number;
  audioHdCount: number;
  conversationCount: number;
}

interface Summary {
  tokensInput: number;
  tokensOutput: number;
  totalTokens: number;
  estimatedCost: number;
  imageCount: number;
  videoCount: number;
  musicCount: number;
  audioCount: number;
  audioHdCount: number;
  messageCount: number;
  conversationCount: number;
  topazImageCredits: number;
  topazVideoCredits: number;
}

interface GenerationType {
  type: string;
  count: number;
  cost: number;
}

interface BudgetStats {
  total: number;
  draft: number;
  accepted: number;
  rejected: number;
  totalAmount: number;
  acceptedAmount: number;
}

interface AnalyticsData {
  dailyStats: DailyStat[];
  modelBreakdown: ModelBreakdown[];
  userBreakdown: UserBreakdown[];
  projectBreakdown: ProjectBreakdown[];
  summaries: {
    "7d": Summary;
    "30d": Summary;
    "all": Summary;
  };
  generationTypes: GenerationType[];
  budgetStats: BudgetStats;
}

const COLORS = ["#8b5cf6", "#06b6d4", "#f59e0b", "#10b981", "#ec4899", "#3b82f6"];
const CHART_COLORS = {
  tokensInput: "#06b6d4",
  tokensOutput: "#ec4899",
  cost: "#10b981",
  images: "#8b5cf6",
  videos: "#f59e0b",
  music: "#2dd4bf",
  audio: "#f472b6",
  audioHd: "#e11d48",
};

type PeriodType = "7" | "30" | "90" | "all";

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodType>("30");

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/analytics?period=${period}`);
      if (res.ok) {
        const result = await res.json();
        setData(result);
      }
    } catch (err) {
      console.error("Error fetching analytics:", err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K";
    return num.toLocaleString();
  };

  const formatCost = (cost: number) => {
    if (cost === 0) return "$0.00";
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    if (cost < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("es-CL", { month: "short", day: "numeric" });
  };

  const getCurrentSummary = (): Summary => {
    if (!data) return { tokensInput: 0, tokensOutput: 0, totalTokens: 0, estimatedCost: 0, imageCount: 0, videoCount: 0, musicCount: 0, audioCount: 0, audioHdCount: 0, messageCount: 0, conversationCount: 0, topazImageCredits: 0, topazVideoCredits: 0 };
    if (period === "7") return data.summaries["7d"];
    if (period === "30") return data.summaries["30d"];
    return data.summaries["all"];
  };

  const getPreviousSummary = (): Summary | null => {
    if (!data || period === "all") return null;
    if (period === "7") return data.summaries["30d"];
    return data.summaries["all"];
  };

  const calculateChange = (current: number, previous: number | null): number | null => {
    if (previous === null || previous === 0) return null;
    return ((current - previous) / previous) * 100;
  };

  const currentSummary = getCurrentSummary();
  const previousSummary = getPreviousSummary();

  const periodLabels: Record<PeriodType, string> = {
    "7": "Últimos 7 días",
    "30": "Últimos 30 días",
    "90": "Últimos 90 días",
    "all": "Todo el tiempo",
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Estadísticas
          </h1>
          <p className="text-muted-foreground">
            Análisis de uso y costos de la plataforma
          </p>
        </div>

        {/* Period Selector */}
        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          {(["7", "30", "90", "all"] as PeriodType[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setPeriod(p)}
              className={period === p ? "bg-background shadow-sm" : ""}
            >
              {p === "all" ? "Todo" : `${p}d`}
            </Button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tokens Totales
            </CardTitle>
            <Zap className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(currentSummary.totalTokens)}</div>
            <p className="text-xs text-muted-foreground">
              In: {formatNumber(currentSummary.tokensInput)} / Out: {formatNumber(currentSummary.tokensOutput)}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Costo Estimado
            </CardTitle>
            <DollarSign className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-400">
              {formatCost(currentSummary.estimatedCost)}
            </div>
            <p className="text-xs text-muted-foreground">
              {periodLabels[period]}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Imágenes
            </CardTitle>
            <ImageIcon className="h-4 w-4 text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currentSummary.imageCount}</div>
            <p className="text-xs text-muted-foreground">Generadas</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Videos
            </CardTitle>
            <Video className="h-4 w-4 text-orange-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currentSummary.videoCount}</div>
            <p className="text-xs text-muted-foreground">Generados</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Música
            </CardTitle>
            <Music className="h-4 w-4 text-teal-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currentSummary.musicCount}</div>
            <p className="text-xs text-muted-foreground">Generadas</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Audio
            </CardTitle>
            <Volume2 className="h-4 w-4 text-pink-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currentSummary.audioCount}</div>
            <p className="text-xs text-muted-foreground">Generados</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Audio HD
            </CardTitle>
            <Volume2 className="h-4 w-4 text-rose-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currentSummary.audioHdCount}</div>
            <p className="text-xs text-muted-foreground">Chirp 3 HD</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Mensajes
            </CardTitle>
            <MessageSquare className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(currentSummary.messageCount)}</div>
            <p className="text-xs text-muted-foreground">Respuestas del modelo</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Conversaciones
            </CardTitle>
            <MessageSquare className="h-4 w-4 text-cyan-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{currentSummary.conversationCount}</div>
            <p className="text-xs text-muted-foreground">Chats activos</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Topaz
            </CardTitle>
            <Sparkles className="h-4 w-4 text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-400">
              {formatNumber(currentSummary.topazImageCredits + currentSummary.topazVideoCredits)}
            </div>
            <p className="text-xs text-muted-foreground">
              Img: {formatNumber(currentSummary.topazImageCredits)} / Vid: {formatNumber(currentSummary.topazVideoCredits)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1: Tokens & Cost over time */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tokens Chart */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              Uso de Tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data?.dailyStats && data.dailyStats.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={data.dailyStats}>
                  <defs>
                    <linearGradient id="colorInput" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.tokensInput} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS.tokensInput} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorOutput" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.tokensOutput} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS.tokensOutput} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    stroke="#666"
                    fontSize={12}
                  />
                  <YAxis stroke="#666" fontSize={12} tickFormatter={formatNumber} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1a1a22", border: "1px solid #333", borderRadius: "8px", color: "#fff" }}
                    labelStyle={{ color: "#fff" }}
                    itemStyle={{ color: "#fff" }}
                    labelFormatter={formatDate}
                    formatter={(value, name) => [
                      formatNumber(Number(value) || 0),
                      name === "tokensInput" ? "Input" : "Output",
                    ]}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="tokensInput"
                    name="Input"
                    stroke={CHART_COLORS.tokensInput}
                    fillOpacity={1}
                    fill="url(#colorInput)"
                  />
                  <Area
                    type="monotone"
                    dataKey="tokensOutput"
                    name="Output"
                    stroke={CHART_COLORS.tokensOutput}
                    fillOpacity={1}
                    fill="url(#colorOutput)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No hay datos para este período
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cost Chart */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-400" />
              Costos por Día
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data?.dailyStats && data.dailyStats.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.dailyStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    stroke="#666"
                    fontSize={12}
                  />
                  <YAxis stroke="#666" fontSize={12} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1a1a22", border: "1px solid #333", borderRadius: "8px", color: "#fff" }}
                    labelStyle={{ color: "#fff" }}
                    itemStyle={{ color: "#fff" }}
                    labelFormatter={formatDate}
                    formatter={(value) => [formatCost(Number(value) || 0), "Costo"]}
                    cursor={{ fill: "rgba(255, 255, 255, 0.1)" }}
                  />
                  <Bar dataKey="estimatedCost" fill={CHART_COLORS.cost} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No hay datos para este período
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2: Generations & Model Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Generations Chart */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-purple-400" />
              Generaciones por Día
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data?.dailyStats && data.dailyStats.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.dailyStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    stroke="#666"
                    fontSize={12}
                  />
                  <YAxis stroke="#666" fontSize={12} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1a1a22", border: "1px solid #333", borderRadius: "8px", color: "#fff" }}
                    labelStyle={{ color: "#fff" }}
                    itemStyle={{ color: "#fff" }}
                    labelFormatter={formatDate}
                    cursor={{ fill: "rgba(255, 255, 255, 0.1)" }}
                  />
                  <Legend />
                  <Bar dataKey="imageCount" name="Imágenes" fill={CHART_COLORS.images} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="videoCount" name="Videos" fill={CHART_COLORS.videos} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="musicCount" name="Música" fill={CHART_COLORS.music} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="audioCount" name="Audio" fill={CHART_COLORS.audio} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="audioHdCount" name="Audio HD" fill={CHART_COLORS.audioHd} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No hay datos para este período
              </div>
            )}
          </CardContent>
        </Card>

        {/* Generation Types Pie */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-400" />
              Distribución por Tipo
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data?.generationTypes && data.generationTypes.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="50%" height={250}>
                  <PieChart>
                    <Pie
                      data={data.generationTypes as Array<{ type: string; count: number; cost: number; [key: string]: unknown }>}
                      dataKey="count"
                      nameKey="type"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                    >
                      {data.generationTypes.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1a1a22", border: "1px solid #333", borderRadius: "8px", color: "#fff" }}
                      labelStyle={{ color: "#fff" }}
                      itemStyle={{ color: "#fff" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-3">
                  {data.generationTypes.map((type, index) => (
                    <div key={type.type} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="capitalize">{type.type === "text" ? "Texto" : type.type === "image" ? "Imagen" : type.type === "video" ? "Video" : type.type === "audio" ? "Audio" : type.type === "audio_hd" ? "Audio HD" : "Música"}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">{type.count}</div>
                        <div className="text-xs text-muted-foreground">{formatCost(type.cost)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                No hay datos para este período
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Calculadora IA Stats */}
      {data?.budgetStats && data.budgetStats.total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Cotizaciones
              </CardTitle>
              <Calculator className="h-4 w-4 text-blue-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.budgetStats.total}</div>
              <p className="text-xs text-muted-foreground">{periodLabels[period]}</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Aceptadas
              </CardTitle>
              <FileCheck className="h-4 w-4 text-green-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-400">{data.budgetStats.accepted}</div>
              <p className="text-xs text-muted-foreground">
                ${data.budgetStats.acceptedAmount.toLocaleString("es-CL")}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pendientes
              </CardTitle>
              <FileClock className="h-4 w-4 text-yellow-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-400">{data.budgetStats.draft}</div>
              <p className="text-xs text-muted-foreground">En borrador</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Monto Total
              </CardTitle>
              <DollarSign className="h-4 w-4 text-cyan-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-cyan-400">
                ${data.budgetStats.totalAmount.toLocaleString("es-CL")}
              </div>
              <p className="text-xs text-muted-foreground">Todas las cotizaciones</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tables Row: Models, Users, Projects */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Model Breakdown */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Por Modelo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data?.modelBreakdown && data.modelBreakdown.length > 0 ? (
                data.modelBreakdown.slice(0, 5).map((model) => (
                  <div key={model.modelId} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div>
                      <div className="font-medium text-sm">{model.modelName}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatNumber(model.tokensInput + model.tokensOutput)} tokens
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-green-400">{formatCost(model.estimatedCost)}</div>
                      <div className="text-xs text-muted-foreground">
                        {[
                          model.imageCount > 0 && `${model.imageCount} img`,
                          model.videoCount > 0 && `${model.videoCount} vid`,
                          model.musicCount > 0 && `${model.musicCount} mus`,
                          model.audioCount > 0 && `${model.audioCount} aud`,
                          model.audioHdCount > 0 && `${model.audioHdCount} hd`,
                        ].filter(Boolean).join(" / ")}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  No hay datos
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* User Breakdown */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-400" />
              Top Usuarios
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data?.userBreakdown && data.userBreakdown.length > 0 ? (
                data.userBreakdown.slice(0, 5).map((user) => (
                  <div key={user.userId} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div>
                      <div className="font-medium text-sm">{user.userName}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatNumber(user.messageCount)} msgs / {user.conversationCount} conv
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[
                          user.imageCount > 0 && `${user.imageCount} img`,
                          user.videoCount > 0 && `${user.videoCount} vid`,
                          user.musicCount > 0 && `${user.musicCount} mus`,
                          user.audioCount > 0 && `${user.audioCount} aud`,
                          user.audioHdCount > 0 && `${user.audioHdCount} hd`,
                        ].filter(Boolean).join(" / ")}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-green-400">{formatCost(user.estimatedCost)}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatNumber(user.tokensInput + user.tokensOutput)} tokens
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  No hay datos
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Project Breakdown */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-yellow-400" />
              Por Proyecto
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data?.projectBreakdown && data.projectBreakdown.length > 0 ? (
                data.projectBreakdown.slice(0, 5).map((project) => (
                  <div key={project.projectId || "no-project"} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div>
                      {project.clientName && (
                        <div className="text-xs text-muted-foreground">{project.clientName}</div>
                      )}
                      <div className="font-medium text-sm">{project.projectName}</div>
                      <div className="text-xs text-muted-foreground">
                        {project.conversationCount} conversaciones
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-green-400">{formatCost(project.estimatedCost)}</div>
                      <div className="text-xs text-muted-foreground">
                        {[
                          project.imageCount > 0 && `${project.imageCount} img`,
                          project.videoCount > 0 && `${project.videoCount} vid`,
                          project.musicCount > 0 && `${project.musicCount} mus`,
                          project.audioCount > 0 && `${project.audioCount} aud`,
                          project.audioHdCount > 0 && `${project.audioHdCount} hd`,
                        ].filter(Boolean).join(" / ")}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  No hay datos
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      
    </div>
  );
}
