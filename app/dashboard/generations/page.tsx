"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import NextImage from "next/image";
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
  AudioLines,
  LayoutGrid,
  Workflow,
  List,
  User as UserIcon,
  X,
  Play,
  Pause,
} from "lucide-react";

const OPTIMIZED_IMAGE_HOSTS = new Set(["static.puer.to", "storage.googleapis.com"]);

function isOptimizableHost(url: string): boolean {
  try {
    return OPTIMIZED_IMAGE_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function GridAudioPlayer({
  url,
  sharedRef,
  accentClass,
}: {
  url: string;
  sharedRef: React.MutableRefObject<HTMLAudioElement | null>;
  accentClass: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      // Pausa el audio anterior si era otro
      if (sharedRef.current && sharedRef.current !== el) {
        sharedRef.current.pause();
      }
      sharedRef.current = el;
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        className={`absolute inset-0 m-auto w-12 h-12 rounded-full ${accentClass} text-white shadow-lg flex items-center justify-center hover:scale-105 transition-transform`}
        aria-label={isPlaying ? "Pausar" : "Reproducir"}
      >
        {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
      </button>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={url}
        preload="none"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />
    </>
  );
}

interface Generation {
  id: number;
  conversation_id: number;
  conversation_title: string;
  conversation_generation_type?: string | null;
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
  type: "image" | "video" | "audio" | "audio_hd" | "music" | "text" | "full" | "canvas" | "topaz_image" | "topaz_video";
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

interface ProjectFilterOption {
  id: number;
  name: string;
  client_id: number | null;
  client_name: string | null;
}

interface UserFilterOption {
  id: number;
  name: string | null;
  email: string;
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
    projects: ProjectFilterOption[];
    clients: FilterOption[];
    users?: UserFilterOption[];
  };
}

type TypeFilter = "all" | "image" | "video" | "audio" | "audio_hd" | "music" | "text" | "full" | "canvas" | "topaz_image" | "topaz_video";

export default function GenerationsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [page, setPage] = useState(0);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxDetail, setLightboxDetail] = useState<{
    id: number;
    content: string | null;
    user_prompt: string | null;
    thought: string | null;
  } | null>(null);
  const playingAudioRef = useRef<HTMLAudioElement | null>(null);
  const limit = 50;

  // Items navegables en el modal: media de cualquier tipo o texto (con o sin contenido).
  const previewItems = useMemo(() => {
    if (!data) return [] as Generation[];
    return data.data.filter(
      (g) =>
        g.image_url ||
        g.video_url ||
        g.audio_url ||
        g.music_url ||
        g.result_url ||
        g.original_url ||
        g.type === "text"
    );
  }, [data]);

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const nextLightbox = useCallback(() => {
    setLightboxIndex((i) =>
      i === null ? null : (i + 1) % Math.max(1, previewItems.length)
    );
  }, [previewItems.length]);
  const prevLightbox = useCallback(() => {
    setLightboxIndex((i) =>
      i === null
        ? null
        : (i - 1 + previewItems.length) % Math.max(1, previewItems.length)
    );
  }, [previewItems.length]);

  // Teclado: ESC cierra, flechas navegan
  useEffect(() => {
    if (lightboxIndex === null) return;
    // Pausar audio del grid para evitar que se solape con el del modal
    if (playingAudioRef.current) {
      playingAudioRef.current.pause();
      playingAudioRef.current = null;
    }
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowRight") nextLightbox();
      else if (e.key === "ArrowLeft") prevLightbox();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIndex, closeLightbox, nextLightbox, prevLightbox]);

  // Para items tipo texto: traer el detalle del mensaje. Sirve para resolver el
  // prompt (`prompt_content` del user message anterior) cuando `content` viene vacío,
  // y también para mostrar el pensamiento del modelo si lo guardó.
  useEffect(() => {
    if (lightboxIndex === null) {
      setLightboxDetail(null);
      return;
    }
    const item = previewItems[lightboxIndex];
    if (!item || item.type !== "text") {
      setLightboxDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/messages/${item.id}`);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setLightboxDetail({
          id: item.id,
          content: json.content ?? null,
          user_prompt: json.user_prompt ?? null,
          thought: json.thought ?? null,
        });
      } catch {
        if (!cancelled) setLightboxDetail(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lightboxIndex, previewItems]);

  const fetchGenerations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (projectFilter !== "all") params.set("project_id", projectFilter);
      if (clientFilter !== "all") params.set("client_id", clientFilter);
      if (userFilter !== "all") params.set("user_id", userFilter);
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
  }, [typeFilter, projectFilter, clientFilter, userFilter, debouncedSearch, includeDeleted, page]);

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
  }, [typeFilter, projectFilter, clientFilter, userFilter]);

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
      case "audio_hd":
        return <AudioLines className="h-4 w-4 text-emerald-400" />;
      case "music":
        return <Music className="h-4 w-4 text-teal-400" />;
      case "full":
        return <LayoutGrid className="h-4 w-4 text-indigo-400" />;
      case "canvas":
        return <Workflow className="h-4 w-4 text-cyan-400" />;
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
      case "audio_hd":
        return "Audio HD";
      case "music":
        return "Música";
      case "full":
        return "Estudio";
      case "canvas":
        return "Canvas";
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
                <SelectItem value="audio_hd">Audio HD</SelectItem>
                <SelectItem value="full">Estudio</SelectItem>
                <SelectItem value="canvas">Canvas</SelectItem>
                <SelectItem value="topaz_image">Topaz Imagen</SelectItem>
                <SelectItem value="topaz_video">Topaz Video</SelectItem>
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

            {/* Project filter (con cliente prefijado y filtrado por cliente seleccionado) */}
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-[260px] bg-muted border-border/50">
                <SelectValue placeholder="Proyecto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los proyectos</SelectItem>
                {data?.filters.projects
                  ?.filter((p) =>
                    clientFilter === "all"
                      ? true
                      : String(p.client_id ?? "") === clientFilter
                  )
                  .map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      <span className="text-muted-foreground">
                        {p.client_name || "Sin cliente"}
                      </span>
                      {" — "}
                      <span>{p.name}</span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            {/* User filter */}
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="w-[220px] bg-muted border-border/50">
                <div className="flex items-center gap-2 truncate">
                  <UserIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Usuario" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los usuarios</SelectItem>
                {data?.filters.users?.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name || u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* View toggle */}
            <div className="inline-flex rounded-md border border-border/50 bg-muted overflow-hidden">
              <button
                onClick={() => setViewMode("table")}
                className={`px-2 py-1.5 text-xs flex items-center gap-1 ${viewMode === "table" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                title="Vista tabla"
              >
                <List className="h-4 w-4" /> Tabla
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={`px-2 py-1.5 text-xs flex items-center gap-1 ${viewMode === "grid" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                title="Vista grilla"
              >
                <LayoutGrid className="h-4 w-4" /> Grilla
              </button>
            </div>

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

      {/* Resumen de resultados (refleja los filtros activos) */}
      {data && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground mr-1">
            Resultados ({formatNumber(data.pagination.total)}):
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/60 border border-border/40">
            <ImageIcon className="h-3.5 w-3.5 text-purple-400" />
            <span className="font-medium">{formatNumber(data.totals.image_count)}</span>
            <span className="text-muted-foreground">imágenes</span>
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/60 border border-border/40">
            <Video className="h-3.5 w-3.5 text-orange-400" />
            <span className="font-medium">{formatNumber(data.totals.video_count)}</span>
            <span className="text-muted-foreground">videos</span>
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/60 border border-border/40">
            <Music className="h-3.5 w-3.5 text-green-400" />
            <span className="font-medium">{formatNumber(data.totals.audio_count)}</span>
            <span className="text-muted-foreground">audios</span>
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/60 border border-border/40">
            <Music className="h-3.5 w-3.5 text-teal-400" />
            <span className="font-medium">{formatNumber(data.totals.music_count || 0)}</span>
            <span className="text-muted-foreground">música</span>
          </span>
          {(data.totals.topaz_image_count ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/60 border border-border/40">
              <Sparkles className="h-3.5 w-3.5 text-purple-400" />
              <span className="font-medium">{formatNumber(data.totals.topaz_image_count || 0)}</span>
              <span className="text-muted-foreground">Topaz img</span>
            </span>
          )}
          {(data.totals.topaz_video_count ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/60 border border-border/40">
              <Sparkles className="h-3.5 w-3.5 text-orange-400" />
              <span className="font-medium">{formatNumber(data.totals.topaz_video_count || 0)}</span>
              <span className="text-muted-foreground">Topaz vid</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/60 border border-border/40 ml-auto">
            <DollarSign className="h-3.5 w-3.5 text-green-400" />
            <span className="font-medium text-green-400">{formatCost(data.totals.estimated_cost)}</span>
          </span>
        </div>
      )}

      {/* Table */}
      <Card className="bg-card border-border/50">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : data && data.data.length > 0 ? (
            <>
              {viewMode === "grid" ? (
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {data.data.map((gen) => {
                    const previewUrl =
                      gen.result_url ||
                      gen.image_url ||
                      gen.video_url ||
                      gen.original_url ||
                      null;
                    const isVideo = gen.type === "video" || gen.type === "topaz_video";
                    const audioUrl = gen.audio_url || gen.music_url || null;
                    const isAudio = !previewUrl && !!audioUrl;
                    const previewIndex = previewItems.findIndex((p) => p.id === gen.id && p.type === gen.type);
                    const isClickable = previewIndex >= 0;
                    return (
                      <div
                        key={`${gen.type}-${gen.id}`}
                        role={isClickable ? "button" : undefined}
                        tabIndex={isClickable ? 0 : undefined}
                        onClick={() => isClickable && setLightboxIndex(previewIndex)}
                        onKeyDown={(e) => {
                          if (!isClickable) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setLightboxIndex(previewIndex);
                          }
                        }}
                        aria-disabled={!isClickable}
                        className={`group relative block text-left rounded-lg overflow-hidden border border-border/40 bg-muted hover:border-border transition-colors ${gen.deleted_at ? "opacity-50" : ""} ${isClickable ? "cursor-zoom-in" : "cursor-default"}`}
                      >
                        <div className="aspect-square bg-muted flex items-center justify-center relative overflow-hidden">
                          {previewUrl && !isVideo ? (
                            isOptimizableHost(previewUrl) ? (
                              <NextImage
                                src={previewUrl}
                                alt={gen.content || gen.conversation_title || "preview"}
                                fill
                                sizes="(min-width: 1280px) 16vw, (min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw"
                                className="object-cover"
                                loading="lazy"
                              />
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={previewUrl}
                                alt={gen.content || gen.conversation_title || "preview"}
                                className="absolute inset-0 w-full h-full object-cover"
                                loading="lazy"
                              />
                            )
                          ) : previewUrl && isVideo ? (
                            <video
                              src={previewUrl}
                              className="absolute inset-0 w-full h-full object-cover"
                              muted
                              playsInline
                              preload="metadata"
                              onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                              onMouseLeave={(e) => {
                                e.currentTarget.pause();
                                e.currentTarget.currentTime = 0;
                              }}
                            />
                          ) : isAudio ? (
                            <>
                              <div className={`absolute inset-0 ${gen.type === "music" ? "bg-gradient-to-br from-teal-500/20 to-cyan-500/10" : "bg-gradient-to-br from-green-500/20 to-emerald-500/10"}`} />
                              <GridAudioPlayer
                                url={audioUrl!}
                                sharedRef={playingAudioRef}
                                accentClass={gen.type === "music" ? "bg-teal-500/90" : "bg-green-500/90"}
                              />
                            </>
                          ) : gen.type === "text" ? (
                            <div className="absolute inset-0 p-3 overflow-hidden bg-gradient-to-br from-blue-500/10 to-slate-500/10">
                              {gen.content?.trim() ? (
                                <div className="text-[11px] text-foreground/80 whitespace-pre-wrap line-clamp-[9]">
                                  {gen.content}
                                </div>
                              ) : (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-1">
                                  <MessageSquare className="h-6 w-6" />
                                  <span className="text-[10px]">Texto sin contenido</span>
                                </div>
                              )}
                              <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-muted to-transparent pointer-events-none" />
                            </div>
                          ) : (
                            <div className="text-muted-foreground flex flex-col items-center gap-1">
                              {getTypeIcon(gen.type)}
                              <span className="text-[10px]">{getTypeLabel(gen.type)}</span>
                            </div>
                          )}
                          <div className="absolute top-1 left-1 flex items-center gap-1 pointer-events-none">
                            <div className="bg-black/60 backdrop-blur-sm rounded px-1.5 py-0.5 flex items-center gap-1 text-[10px] text-white">
                              {getTypeIcon(gen.type)}
                              <span>{getTypeLabel(gen.type)}</span>
                            </div>
                            {(gen.conversation_generation_type === "canvas" || gen.conversation_generation_type === "full") && (
                              <div className="bg-black/60 backdrop-blur-sm rounded px-1.5 py-0.5 flex items-center gap-1 text-[10px] text-white">
                                {gen.conversation_generation_type === "canvas" ? (
                                  <Workflow className="h-3 w-3 text-cyan-400" />
                                ) : (
                                  <LayoutGrid className="h-3 w-3 text-indigo-400" />
                                )}
                                <span>{gen.conversation_generation_type === "canvas" ? "Canvas" : "Estudio"}</span>
                              </div>
                            )}
                          </div>
                          {gen.deleted_at && (
                            <div className="absolute top-1 right-1 bg-red-500/80 text-white rounded px-1.5 py-0.5 text-[10px] flex items-center gap-1 pointer-events-none">
                              <Trash2 className="h-3 w-3" /> eliminado
                            </div>
                          )}
                        </div>
                        <div className="p-2 space-y-1">
                          <div className="text-[11px] text-muted-foreground truncate">
                            {gen.client_name || "Sin cliente"}
                            {gen.project_name ? ` · ${gen.project_name}` : ""}
                          </div>
                          <div className="text-xs font-medium truncate" title={gen.content || gen.conversation_title || ""}>
                            {gen.content || gen.conversation_title || "—"}
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span className="truncate">{gen.user_name || gen.user_email}</span>
                            <span className="shrink-0 ml-1">{formatDate(gen.created_at).split(",")[0]}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
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
                            {(gen.conversation_generation_type === "canvas" || gen.conversation_generation_type === "full") && (
                              <span className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {gen.conversation_generation_type === "canvas" ? (
                                  <Workflow className="h-3 w-3 text-cyan-400" />
                                ) : (
                                  <LayoutGrid className="h-3 w-3 text-indigo-400" />
                                )}
                                {gen.conversation_generation_type === "canvas" ? "Canvas" : "Estudio"}
                              </span>
                            )}
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
              )}

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

      {/* Lightbox */}
      {lightboxIndex !== null && previewItems[lightboxIndex] && (() => {
        const current = previewItems[lightboxIndex];
        const isVideo = current.type === "video" || current.type === "topaz_video";
        const isAudio =
          current.type === "audio" ||
          current.type === "audio_hd" ||
          current.type === "music";
        const isText = current.type === "text";
        const url =
          current.result_url ||
          current.video_url ||
          current.image_url ||
          current.audio_url ||
          current.music_url ||
          current.original_url ||
          "";
        return (
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center"
            onClick={closeLightbox}
          >
            {/* Botón cerrar */}
            <button
              onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Flecha izquierda */}
            {previewItems.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); prevLightbox(); }}
                className="absolute left-4 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white"
                aria-label="Anterior"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}

            {/* Flecha derecha */}
            {previewItems.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); nextLightbox(); }}
                className="absolute right-4 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white"
                aria-label="Siguiente"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}

            {/* Contenido */}
            <div
              className="relative max-w-[90vw] max-h-[85vh] flex flex-col items-center gap-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-center">
                {isText ? (
                  (() => {
                    const detail = lightboxDetail && lightboxDetail.id === current.id ? lightboxDetail : null;
                    const responseText = (detail?.content ?? current.content)?.trim() || null;
                    const rawPrompt = detail?.user_prompt?.trim() || null;
                    // Evitar duplicar si el prompt coincide exactamente con la respuesta
                    const promptText = rawPrompt && rawPrompt !== responseText ? rawPrompt : null;
                    const thoughtText = detail?.thought?.trim() || null;
                    const hasAny = !!(promptText || responseText || thoughtText);
                    return (
                      <div className="bg-card border border-border/40 rounded-lg p-6 max-w-[800px] w-[90vw] max-h-[75vh] overflow-auto text-sm text-foreground space-y-4">
                        {promptText && (
                          <div>
                            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Prompt</div>
                            <div className="whitespace-pre-wrap text-muted-foreground/90">{promptText}</div>
                          </div>
                        )}
                        {responseText && (
                          <div>
                            {promptText && (
                              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Respuesta</div>
                            )}
                            <div className="whitespace-pre-wrap">{responseText}</div>
                          </div>
                        )}
                        {thoughtText && (
                          <details className="text-muted-foreground">
                            <summary className="text-[11px] uppercase tracking-wide cursor-pointer hover:text-foreground">
                              Pensamiento del modelo
                            </summary>
                            <div className="whitespace-pre-wrap mt-2 text-xs">{thoughtText}</div>
                          </details>
                        )}
                        {!hasAny && (
                          <span className="text-muted-foreground italic">Sin contenido</span>
                        )}
                      </div>
                    );
                  })()
                ) : isVideo ? (
                  <video
                    src={url}
                    controls
                    autoPlay
                    className="max-w-[90vw] max-h-[75vh] object-contain rounded-lg"
                  />
                ) : isAudio ? (
                  <div className="flex flex-col items-center gap-4 p-12 rounded-lg bg-gradient-to-br from-green-500/20 to-emerald-500/10 min-w-[420px]">
                    <div className="w-24 h-24 rounded-full bg-green-500/30 flex items-center justify-center">
                      {current.type === "music" ? (
                        <Music className="h-10 w-10 text-teal-300" />
                      ) : current.type === "audio_hd" ? (
                        <AudioLines className="h-10 w-10 text-emerald-300" />
                      ) : (
                        <Music className="h-10 w-10 text-green-300" />
                      )}
                    </div>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <audio src={url} controls autoPlay className="w-full" />
                  </div>
                ) : isOptimizableHost(url) ? (
                  <NextImage
                    src={url}
                    alt={current.content || current.conversation_title || "preview"}
                    width={1920}
                    height={1920}
                    sizes="90vw"
                    className="max-w-[90vw] max-h-[75vh] w-auto h-auto object-contain rounded-lg"
                    priority
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={current.content || current.conversation_title || "preview"}
                    className="max-w-[90vw] max-h-[75vh] object-contain rounded-lg"
                  />
                )}
              </div>

              {/* Metadata */}
              <div className="bg-black/60 backdrop-blur-sm rounded-lg px-4 py-3 max-w-[90vw] text-white">
                <div className="flex items-center gap-2 text-xs text-white/70 mb-1">
                  {getTypeIcon(current.type)}
                  <span>{getTypeLabel(current.type)}</span>
                  <span className="opacity-50">·</span>
                  <span>{current.client_name || "Sin cliente"}</span>
                  {current.project_name && (
                    <>
                      <span className="opacity-50">·</span>
                      <span>{current.project_name}</span>
                    </>
                  )}
                  <span className="opacity-50">·</span>
                  <span>{current.user_name || current.user_email}</span>
                  <span className="opacity-50">·</span>
                  <span>{formatDate(current.created_at)}</span>
                  <span className="ml-auto opacity-50">
                    {lightboxIndex + 1} / {previewItems.length}
                  </span>
                </div>
                {(current.content || current.conversation_title) && (
                  <div className="text-sm line-clamp-3">
                    {current.content || current.conversation_title}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-3 text-xs text-white/70">
                  {current.model_name && <span>{current.model_name}</span>}
                  {current.estimated_cost > 0 && (
                    <span className="text-green-400">{formatCost(current.estimated_cost)}</span>
                  )}
                  {!isText && url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-1 hover:text-white"
                    >
                      <ExternalLink className="h-3 w-3" /> Abrir original
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
