"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  MessageSquare,
  ImageIcon,
  Video,
  Music,
  AudioLines,
  LayoutGrid,
  Search,
  ChevronLeft,
  ChevronRight,
  Calendar,
  ArrowRightLeft,
  Eye,
  Trash2,
} from "lucide-react";

interface Conversation {
  id: number;
  title: string;
  generation_type: string;
  project_id: number | null;
  project_title: string | null;
  client_id: number | null;
  client_name: string | null;
  user_id: number;
  user_name: string;
  user_email: string;
  model_display_name: string | null;
  message_count: number;
  asset_count: number;
  estimated_cost: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface FilterOption {
  id: number;
  name: string;
}

interface Asset {
  id: number;
  role: string;
  content: string | null;
  content_type: string;
  image_url: string | null;
  video_url: string | null;
  audio_url: string | null;
  music_url: string | null;
  created_at: string;
}

interface ApiResponse {
  data: Conversation[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  filters: {
    projects: FilterOption[];
    clients: FilterOption[];
    users: FilterOption[];
  };
}

export default function ConversationsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(0);
  const limit = 50;

  // Move modal state
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [movingConversation, setMovingConversation] = useState<Conversation | null>(null);
  const [targetProjectId, setTargetProjectId] = useState<string>("");
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState("");

  // Assets preview modal state
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewConversation, setPreviewConversation] = useState<Conversation | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);

  const fetchConversations = useCallback(async () => {
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

      const res = await fetch(`/api/dashboard/conversations?${params}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch (err) {
      console.error("Error fetching conversations:", err);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, projectFilter, clientFilter, userFilter, debouncedSearch, includeDeleted, page]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

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

  const formatDate = (dateStr: string) => {
    const [datePart, timePart] = dateStr.split(" ");
    const [year, month, day] = datePart.split("-");
    const [hour, minute] = (timePart || "00:00:00").split(":");
    const monthNames = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return `${day} ${monthNames[parseInt(month)]} ${year}, ${hour}:${minute}`;
  };

  const formatCost = (cost: number | string | null | undefined) => {
    const numCost = Number(cost) || 0;
    if (numCost === 0) return "$0.00";
    if (numCost < 0.01) return `$${numCost.toFixed(4)}`;
    if (numCost < 1) return `$${numCost.toFixed(3)}`;
    return `$${numCost.toFixed(2)}`;
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "image": return <ImageIcon className="h-4 w-4 text-purple-400" />;
      case "video": return <Video className="h-4 w-4 text-orange-400" />;
      case "audio": return <Music className="h-4 w-4 text-green-400" />;
      case "audio_hd": return <AudioLines className="h-4 w-4 text-emerald-400" />;
      case "music": return <Music className="h-4 w-4 text-teal-400" />;
      case "full": return <LayoutGrid className="h-4 w-4 text-indigo-400" />;
      default: return <MessageSquare className="h-4 w-4 text-blue-400" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "image": return "Imagen";
      case "video": return "Video";
      case "audio": return "Audio";
      case "audio_hd": return "Audio HD";
      case "music": return "Música";
      case "full": return "Estudio";
      default: return "Texto";
    }
  };

  const handleOpenMove = (conv: Conversation) => {
    setMovingConversation(conv);
    setTargetProjectId("");
    setMoveError("");
    setMoveDialogOpen(true);
  };

  const handleMove = async () => {
    if (!movingConversation || !targetProjectId) return;

    setMoving(true);
    setMoveError("");

    try {
      const res = await fetch(`/api/conversations/${movingConversation.id}/move`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: parseInt(targetProjectId) }),
      });

      if (res.ok) {
        setMoveDialogOpen(false);
        setMovingConversation(null);
        fetchConversations();
      } else {
        const error = await res.json();
        setMoveError(error.error || "Error al mover la conversación");
      }
    } catch {
      setMoveError("Error de conexión");
    } finally {
      setMoving(false);
    }
  };

  const handleOpenPreview = async (conv: Conversation) => {
    setPreviewConversation(conv);
    setPreviewDialogOpen(true);
    setLoadingAssets(true);

    try {
      const res = await fetch(`/api/dashboard/conversations/${conv.id}/assets`);
      if (res.ok) {
        setAssets(await res.json());
      }
    } catch (err) {
      console.error("Error fetching assets:", err);
    } finally {
      setLoadingAssets(false);
    }
  };

  const totalPages = data ? Math.ceil(data.pagination.total / limit) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-primary" />
          Conversaciones
        </h1>
        <p className="text-muted-foreground">
          Administrar y mover conversaciones entre proyectos
        </p>
      </div>

      {/* Filters */}
      <Card className="bg-card border-border/50">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por título, usuario..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-muted border-border/50"
              />
            </div>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[150px] bg-muted border-border/50">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="text">Texto</SelectItem>
                <SelectItem value="image">Imagen</SelectItem>
                <SelectItem value="video">Video</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
                <SelectItem value="audio_hd">Audio HD</SelectItem>
                <SelectItem value="music">Música</SelectItem>
                <SelectItem value="full">Estudio</SelectItem>
              </SelectContent>
            </Select>

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

            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="w-[160px] bg-muted border-border/50">
                <SelectValue placeholder="Usuario" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {data?.filters.users.map((u) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

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

      {/* Stats bar */}
      {data && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span><strong className="text-foreground">{data.pagination.total}</strong> conversaciones</span>
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 bg-muted/30">
                      <TableHead className="w-[80px]">Tipo</TableHead>
                      <TableHead>Título</TableHead>
                      <TableHead>Proyecto</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Usuario</TableHead>
                      <TableHead className="text-center">Msgs</TableHead>
                      <TableHead className="text-center">Assets</TableHead>
                      <TableHead className="text-right">Costo</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead className="w-[100px]">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((conv) => (
                      <TableRow
                        key={conv.id}
                        className={`border-border/30 ${conv.deleted_at ? "opacity-50" : ""}`}
                      >
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {getTypeIcon(conv.generation_type)}
                            <span className="text-xs text-muted-foreground">
                              {getTypeLabel(conv.generation_type)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[250px] truncate text-sm font-medium" title={conv.title}>
                            {conv.title}
                          </div>
                          {conv.model_display_name && (
                            <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                              {conv.model_display_name}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {conv.project_title || (
                              <span className="text-muted-foreground italic">Sin proyecto</span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{conv.client_name || "-"}</span>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{conv.user_name}</div>
                          <div className="text-xs text-muted-foreground">{conv.user_email}</div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-sm">{conv.message_count}</span>
                        </TableCell>
                        <TableCell className="text-center">
                          {conv.asset_count > 0 ? (
                            <span className="text-sm text-purple-400 font-medium">{conv.asset_count}</span>
                          ) : (
                            <span className="text-sm text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={`text-sm ${Number(conv.estimated_cost) > 0 ? "text-green-400" : "text-muted-foreground"}`}>
                            {formatCost(conv.estimated_cost)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {formatDate(conv.created_at)}
                          </div>
                          {conv.deleted_at && (
                            <div className="text-xs text-red-400 flex items-center gap-1">
                              <Trash2 className="h-3 w-3" />
                              Eliminado
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {conv.asset_count > 0 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleOpenPreview(conv)}
                                title="Ver assets"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            )}
                            {!conv.deleted_at && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-primary hover:text-primary"
                                onClick={() => handleOpenMove(conv)}
                                title="Mover a otro proyecto"
                              >
                                <ArrowRightLeft className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
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
                  <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page === 0}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Página {page + 1} de {totalPages}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={!data.pagination.hasMore}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center p-8">
              <MessageSquare className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium mb-2">Sin conversaciones</h3>
              <p className="text-muted-foreground text-sm max-w-md">
                No se encontraron conversaciones con los filtros seleccionados.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Move Dialog */}
      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              Mover conversación
            </DialogTitle>
            <DialogDescription>
              Cambiar el proyecto de la conversación. Todos los mensajes y assets se moverán automáticamente.
            </DialogDescription>
          </DialogHeader>

          {movingConversation && (
            <div className="space-y-4 py-4">
              {/* Current info */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <div className="text-sm font-medium">{movingConversation.title}</div>
                <div className="text-xs text-muted-foreground">
                  {getTypeLabel(movingConversation.generation_type)} · {movingConversation.message_count} mensajes · {movingConversation.asset_count} assets
                </div>
                <div className="text-xs text-muted-foreground">
                  Proyecto actual: <strong>{movingConversation.project_title || "Sin proyecto"}</strong>
                </div>
              </div>

              {/* Target project selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Nuevo proyecto destino</label>
                <select
                  className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                  value={targetProjectId}
                  onChange={(e) => setTargetProjectId(e.target.value)}
                >
                  <option value="">Seleccionar proyecto...</option>
                  {data?.filters.projects
                    .filter((p) => p.id !== movingConversation.project_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>
              </div>

              {moveError && (
                <div className="bg-red-500/10 text-red-400 p-3 rounded-lg text-sm border border-red-500/20">
                  {moveError}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleMove} disabled={moving || !targetProjectId}>
              {moving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Mover conversación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assets Preview Dialog */}
      <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
        <DialogContent className="bg-card border-border/50 max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              Assets de la conversación
            </DialogTitle>
            {previewConversation && (
              <DialogDescription>
                {previewConversation.title} · {previewConversation.asset_count} assets
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="py-4">
            {loadingAssets ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : assets.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {assets.map((asset) => (
                  <div key={asset.id} className="relative group rounded-lg overflow-hidden border border-border/30 bg-muted/30">
                    {asset.image_url && (
                      <a href={asset.image_url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={asset.image_url}
                          alt={asset.content || "Generated image"}
                          className="w-full h-32 object-cover hover:opacity-80 transition-opacity"
                        />
                      </a>
                    )}
                    {asset.video_url && (
                      <a href={asset.video_url} target="_blank" rel="noopener noreferrer" className="block">
                        <div className="w-full h-32 flex items-center justify-center bg-muted/50 hover:bg-muted/70 transition-colors">
                          <Video className="h-8 w-8 text-orange-400" />
                        </div>
                      </a>
                    )}
                    {asset.audio_url && (
                      <div className="p-3">
                        <audio controls src={asset.audio_url} className="w-full h-8" preload="none" />
                      </div>
                    )}
                    {asset.music_url && (
                      <div className="p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <Music className="h-4 w-4 text-teal-400" />
                          <span className="text-xs text-muted-foreground">Música</span>
                        </div>
                        <audio controls src={asset.music_url} className="w-full h-8" preload="none" />
                      </div>
                    )}
                    {asset.content && (
                      <div className="p-2">
                        <p className="text-xs text-muted-foreground line-clamp-2" title={asset.content}>
                          {asset.content.substring(0, 100)}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                No se encontraron assets en esta conversación
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
