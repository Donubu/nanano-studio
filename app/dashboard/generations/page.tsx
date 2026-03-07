"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  FileStack,
  ImageIcon,
  Video,
  Music,
  MessageSquare,
  Search,
  ExternalLink,
  DollarSign,
  Zap,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Trash2,
  Sparkles,
} from "lucide-react";

interface Generation {
  id: number;
  conversation_id: number;
  conversation_title: string;
  project_id: number | null;
  project_name: string | null;
  client_id: number | null;
  client_name: string | null;
  user_id: number;
  user_name: string;
  user_email: string;
  model_id: number | null;
  model_name: string | null;
  content: string | null;
  content_type: string;
  quality_tier: "normal" | "hq" | null;
  generation_seed: number | null;
  tokens_input: number;
  tokens_output: number;
  estimated_cost: number;
  image_url: string | null;
  image_file_size: number | null;
  image_aspect_ratio: string | null;
  video_url: string | null;
  video_file_size: number | null;
  video_duration: number | null;
  audio_url: string | null;
  audio_file_size: number | null;
  audio_duration: number | null;
  music_url: string | null;
  music_file_size: number | null;
  music_duration: number | null;
  created_at: string;
  deleted_at: string | null;
  type: "image" | "video" | "audio" | "music" | "text" | "topaz_image" | "topaz_video";
  // Topaz-specific fields
  original_url?: string;
  result_url?: string;
  input_width?: number;
  input_height?: number;
  output_width?: number;
  output_height?: number;
  scale_factor?: number;
  input_duration?: number;
  credits_consumed?: number;
  output_file_size?: number;
}

interface FilterOption {
  id: number;
  name: string;
}

interface Totals {
  tokens_input: number;
  tokens_output: number;
  estimated_cost: number;
  image_count: number;
  video_count: number;
  audio_count: number;
  music_count: number;
  topaz_image_count?: number;
  topaz_video_count?: number;
  topaz_image_credits?: number;
  topaz_video_credits?: number;
}

interface ApiResponse {
  data: Generation[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  totals: Totals;
  filters: {
    projects: FilterOption[];
    clients: FilterOption[];
  };
}

type TypeFilter = "all" | "image" | "video" | "audio" | "music" | "text" | "topaz_image" | "topaz_video";

export default function GenerationsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const limit = 50;

  const fetchGenerations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (projectFilter !== "all") params.set("project_id", projectFilter);
      if (clientFilter !== "all") params.set("client_id", clientFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (includeDeleted) params.set("include_deleted", "true");
      params.set("limit", String(limit));
      params.set("offset", String(page * limit));

      const res = await fetch(`/api/dashboard/generations?${params}`);
      if (res.ok) {
        const result = await res.json();
        setData(result);
      }
    } catch (err) {
      console.error("Error fetching generations:", err);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, projectFilter, clientFilter, debouncedSearch, includeDeleted, page]);

  useEffect(() => {
    fetchGenerations();
  }, [fetchGenerations]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [typeFilter, projectFilter, clientFilter]);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K";
    return num.toLocaleString();
  };

  const formatCost = (cost: number | string | null | undefined) => {
    const numCost = Number(cost) || 0;
    if (numCost === 0) return "$0.00";
    if (numCost < 0.01) return `$${numCost.toFixed(4)}`;
    if (numCost < 1) return `$${numCost.toFixed(3)}`;
    return `$${numCost.toFixed(2)}`;
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "-";
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
    return bytes + " B";
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "-";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatDate = (dateStr: string) => {
    // Las fechas de MySQL vienen en hora Chile (sin indicador de zona)
    // Formatear directamente sin conversión adicional
    const [datePart, timePart] = dateStr.split(" ");
    const [year, month, day] = datePart.split("-");
    const [hour, minute] = (timePart || "00:00:00").split(":");

    const monthNames = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return `${day} ${monthNames[parseInt(month)]} ${year}, ${hour}:${minute}`;
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "image":
        return <ImageIcon className="h-4 w-4 text-purple-400" />;
      case "video":
        return <Video className="h-4 w-4 text-orange-400" />;
      case "audio":
        return <Music className="h-4 w-4 text-green-400" />;
      case "music":
        return <Music className="h-4 w-4 text-teal-400" />;
      case "topaz_image":
        return <Sparkles className="h-4 w-4 text-purple-400" />;
      case "topaz_video":
        return <Sparkles className="h-4 w-4 text-orange-400" />;
      default:
        return <MessageSquare className="h-4 w-4 text-blue-400" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "image":
        return "Imagen";
      case "video":
        return "Video";
      case "audio":
        return "Audio";
      case "music":
        return "Musica";
      case "topaz_image":
        return "Topaz Img";
      case "topaz_video":
        return "Topaz Vid";
      default:
        return "Texto";
    }
  };

  const totalPages = data ? Math.ceil(data.pagination.total / limit) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileStack className="h-6 w-6 text-primary" />
            Generaciones
          </h1>
          <p className="text-muted-foreground">
            Historial completo de todas las generaciones
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-4">
          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total
              </CardTitle>
              <FileStack className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNumber(data.pagination.total)}</div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Costo Total
              </CardTitle>
              <DollarSign className="h-4 w-4 text-green-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-400">
                {formatCost(data.totals.estimated_cost)}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tokens
              </CardTitle>
              <Zap className="h-4 w-4 text-amber-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNumber(data.totals.tokens_input + data.totals.tokens_output)}</div>
              <p className="text-xs text-muted-foreground">
                In: {formatNumber(data.totals.tokens_input)} / Out: {formatNumber(data.totals.tokens_output)}
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
              <div className="text-2xl font-bold">{data.totals.image_count}</div>
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
              <div className="text-2xl font-bold">{data.totals.video_count}</div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Audios
              </CardTitle>
              <Music className="h-4 w-4 text-green-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.totals.audio_count}</div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Musica
              </CardTitle>
              <Music className="h-4 w-4 text-teal-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.totals.music_count || 0}</div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Topaz Img
              </CardTitle>
              <Sparkles className="h-4 w-4 text-purple-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.totals.topaz_image_count || 0}</div>
              <p className="text-xs text-muted-foreground">
                {formatNumber(data.totals.topaz_image_credits || 0)} créditos
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Topaz Vid
              </CardTitle>
              <Sparkles className="h-4 w-4 text-orange-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.totals.topaz_video_count || 0}</div>
              <p className="text-xs text-muted-foreground">
                {formatNumber(data.totals.topaz_video_credits || 0)} créditos
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="bg-card border-border/50">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por título, contenido o usuario..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-muted border-border/50"
              />
            </div>

            {/* Type filter */}
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
              <SelectTrigger className="w-[160px] bg-muted border-border/50">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="image">Imágenes</SelectItem>
                <SelectItem value="video">Videos</SelectItem>
                <SelectItem value="audio">Audios</SelectItem>
                <SelectItem value="music">Musica</SelectItem>
                <SelectItem value="text">Texto</SelectItem>
                <SelectItem value="topaz_image">Topaz Imagen</SelectItem>
                <SelectItem value="topaz_video">Topaz Video</SelectItem>
              </SelectContent>
            </Select>

            {/* Project filter */}
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-[180px] bg-muted border-border/50">
                <SelectValue placeholder="Proyecto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los proyectos</SelectItem>
                {data?.filters.projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Client filter */}
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-[180px] bg-muted border-border/50">
                <SelectValue placeholder="Cliente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los clientes</SelectItem>
                {data?.filters.clients.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Include deleted toggle */}
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
                className="w-4 h-4 rounded accent-primary"
              />
              <Trash2 className="h-4 w-4" />
              Eliminados
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="bg-card border-border/50">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : data && data.data.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 bg-muted/30">
                      <TableHead className="w-[80px]">Tipo</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Proyecto</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Usuario</TableHead>
                      <TableHead>Modelo</TableHead>
                      <TableHead className="text-right">Tokens / Res</TableHead>
                      <TableHead className="text-right">Costo / Créditos</TableHead>
                      <TableHead className="text-right">Tamaño</TableHead>
                      <TableHead className="w-[60px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((gen) => (
                      <TableRow
                        key={gen.id}
                        className={`border-border/30 ${gen.deleted_at ? "opacity-50" : ""}`}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getTypeIcon(gen.type)}
                            <span className="text-xs text-muted-foreground">
                              {getTypeLabel(gen.type)}
                            </span>
                            {gen.model_name && (
                              <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                                {gen.model_name}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {formatDate(gen.created_at)}
                          </div>
                          {gen.deleted_at && (
                            <div className="text-xs text-red-400 flex items-center gap-1">
                              <Trash2 className="h-3 w-3" />
                              Eliminado
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{gen.project_name || "-"}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{gen.client_name || "-"}</span>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{gen.user_name}</div>
                          <div className="text-xs text-muted-foreground">{gen.user_email}</div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {gen.model_name || "-"}
                          </span>
                        </TableCell>
                        {gen.type === "topaz_image" || gen.type === "topaz_video" ? (
                          <>
                            <TableCell className="text-right">
                              {gen.input_width && gen.input_height && (
                                <div>
                                  <div className="text-xs text-muted-foreground">
                                    {gen.input_width}×{gen.input_height}
                                  </div>
                                  {gen.output_width && gen.output_height && (
                                    <div className="text-sm text-purple-400">
                                      → {gen.output_width}×{gen.output_height}
                                    </div>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm text-purple-400">
                                {gen.credits_consumed || 0}
                              </span>
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="text-right">
                              <div className="text-sm">{formatNumber(gen.tokens_input + gen.tokens_output)}</div>
                              <div className="text-xs text-muted-foreground">
                                {formatNumber(gen.tokens_input)} / {formatNumber(gen.tokens_output)}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={`text-sm ${gen.estimated_cost > 0 ? "text-green-400" : "text-muted-foreground"}`}>
                                {formatCost(gen.estimated_cost)}
                              </span>
                            </TableCell>
                          </>
                        )}
                        <TableCell className="text-right">
                          {gen.type === "image" && (
                            <div>
                              <div className="text-sm">{formatFileSize(gen.image_file_size)}</div>
                              {gen.image_aspect_ratio && (
                                <div className="text-xs text-muted-foreground">{gen.image_aspect_ratio}</div>
                              )}
                            </div>
                          )}
                          {gen.type === "video" && (
                            <div>
                              <div className="text-sm">{formatFileSize(gen.video_file_size)}</div>
                              {gen.video_duration && (
                                <div className="text-xs text-muted-foreground">{formatDuration(gen.video_duration)}</div>
                              )}
                            </div>
                          )}
                          {gen.type === "audio" && (
                            <div>
                              <div className="text-sm">{formatFileSize(gen.audio_file_size)}</div>
                              {gen.audio_duration && (
                                <div className="text-xs text-muted-foreground">{formatDuration(gen.audio_duration)}</div>
                              )}
                            </div>
                          )}
                          {(gen.type === "topaz_image" || gen.type === "topaz_video") && (
                            <div>
                              <div className="text-sm">{formatFileSize(gen.output_file_size || null)}</div>
                              {gen.input_duration && (
                                <div className="text-xs text-muted-foreground">{formatDuration(gen.input_duration)}</div>
                              )}
                            </div>
                          )}
                          {gen.type === "music" && (
                            <div>
                              <div className="text-sm">{formatFileSize(gen.music_file_size)}</div>
                              {gen.music_duration && (
                                <div className="text-xs text-muted-foreground">{formatDuration(gen.music_duration)}</div>
                              )}
                            </div>
                          )}
                          {gen.type === "text" && <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell>
                          {(gen.image_url || gen.video_url || gen.audio_url || gen.music_url || gen.result_url) && (
                            <a
                              href={gen.result_url || gen.image_url || gen.video_url || gen.audio_url || gen.music_url || "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 hover:bg-accent rounded-md inline-flex"
                            >
                              <ExternalLink className="h-4 w-4 text-muted-foreground" />
                            </a>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between p-4 border-t border-border/30">
                <div className="text-sm text-muted-foreground">
                  Mostrando {page * limit + 1} - {Math.min((page + 1) * limit, data.pagination.total)} de {data.pagination.total}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Página {page + 1} de {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={!data.pagination.hasMore}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center p-8">
              <FileStack className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium mb-2">Sin generaciones</h3>
              <p className="text-muted-foreground text-sm max-w-md">
                No se encontraron generaciones con los filtros seleccionados.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
