"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Loader2,
  Users,
  Building2,
  Pencil,
  Trash2,
  UserPlus,
  Cpu,
  Star,
  FileText,
  Save,
  ImageIcon,
  Video,
  Plus,
  X,
  Check,
  Tag,
  MessageSquare,
  BarChart3,
  Settings,
  Zap,
  DollarSign,
  Mic,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  CalendarDays,
  AudioLines,
  Music,
} from "lucide-react";
import { ProjectCalendar } from "@/components/dashboard/project-calendar";
import Image from "next/image";
import { formatDateLocal } from "@/lib/utils";

interface Project {
  id: number;
  title: string;
  description: string | null;
  client_id: number | null;
  client_name: string | null;
  client_logo: string | null;
  status: string;
  hidden: boolean;
  created_at: string;
}

interface ProjectUser {
  id: number;
  user_id: number;
  user_email: string;
  user_name: string | null;
  user_image: string | null;
  role: string;
  // Legacy fields
  max_monthly_image_generations: number;
  max_monthly_video_generations: number;
  // New quality-based limits
  max_monthly_image_normal: number;
  max_monthly_image_hq: number;
  max_monthly_video_normal: number;
  max_monthly_video_hq: number;
  max_monthly_audio_normal: number;
  max_monthly_audio_hq: number;
  max_monthly_text_normal: number;
  max_monthly_text_hq: number;
}

interface User {
  id: number;
  email: string;
  name: string | null;
}

interface Model {
  id: number;
  model_id: string;
  display_name: string;
}

interface ProjectTag {
  id: number;
  name: string;
  color: string;
  usage_count: number;
}

interface ProjectStats {
  totalConversations: number;
  totalImages: number;
  totalVideos: number;
  activeUsers: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalEstimatedCost: number;
}

interface Client {
  id: number;
  name: string;
}

const statusLabels: Record<string, string> = {
  active: "Activo",
  paused: "Pausado",
  completed: "Completado",
  cancelled: "Cancelado",
};

const statusColors: Record<string, string> = {
  active: "bg-green-500/20 text-green-400",
  paused: "bg-yellow-500/20 text-yellow-400",
  completed: "bg-blue-500/20 text-blue-400",
  cancelled: "bg-red-500/20 text-red-400",
};

type TabType = "overview" | "users" | "calendar" | "tags" | "config";

type GenerationType = "text" | "image" | "video" | "audio" | "music";

interface ModelInfo {
  id: number;
  model_id: string;
  display_name: string;
}

interface TypeConfig {
  enabled: boolean;
  model_normal: ModelInfo | null;
  model_hq: ModelInfo | null;
  model_chirp: ModelInfo | null;
}

interface GenerationConfigResponse {
  text: TypeConfig;
  image: TypeConfig;
  video: TypeConfig;
  audio: TypeConfig;
  music: TypeConfig;
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ProjectStats>({
    totalConversations: 0,
    totalImages: 0,
    totalVideos: 0,
    activeUsers: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    totalEstimatedCost: 0,
  });

  // Users state
  const [projectUsers, setProjectUsers] = useState<ProjectUser[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [editingUserLimit, setEditingUserLimit] = useState<number | null>(null);

  // Quota limits state (add form)
  type LimitKey = "text_normal" | "text_hq" | "image_normal" | "image_hq" | "video_normal" | "video_hq" | "audio_normal" | "audio_hq";
  const defaultLimits: Record<LimitKey, string> = {
    text_normal: "0", text_hq: "0",
    image_normal: "10", image_hq: "10",
    video_normal: "10", video_hq: "10",
    audio_normal: "10", audio_hq: "10",
  };
  const [addLimits, setAddLimits] = useState<Record<LimitKey, string>>(defaultLimits);
  const [addUnlimited, setAddUnlimited] = useState<Record<LimitKey, boolean>>({
    text_normal: true, text_hq: true,
    image_normal: false, image_hq: false,
    video_normal: false, video_hq: false,
    audio_normal: false, audio_hq: false,
  });

  // Quota limits state (edit form)
  const [editLimits, setEditLimits] = useState<Record<LimitKey, string>>(defaultLimits);
  const [editUnlimited, setEditUnlimited] = useState<Record<LimitKey, boolean>>({
    text_normal: true, text_hq: true,
    image_normal: false, image_hq: false,
    video_normal: false, video_hq: false,
    audio_normal: false, audio_hq: false,
  });

  // Models state (for config tab selectors)
  const [models, setModels] = useState<Model[]>([]);

  // Tags state
  const [projectTags, setProjectTags] = useState<ProjectTag[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");
  const [editingTag, setEditingTag] = useState<number | null>(null);
  const [editTagName, setEditTagName] = useState("");
  const [editTagColor, setEditTagColor] = useState("");

  // Generation config state
  const [generationConfig, setGenerationConfig] = useState<GenerationConfigResponse>({
    text: { enabled: false, model_normal: null, model_hq: null, model_chirp: null },
    image: { enabled: false, model_normal: null, model_hq: null, model_chirp: null },
    video: { enabled: false, model_normal: null, model_hq: null, model_chirp: null },
    audio: { enabled: false, model_normal: null, model_hq: null, model_chirp: null },
    music: { enabled: false, model_normal: null, model_hq: null, model_chirp: null },
  });
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfigType, setSavingConfigType] = useState<GenerationType | null>(null);

  // Edit project state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    client_id: "",
    status: "active",
    hidden: false,
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const tagColors = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ef4444", "#06b6d4"];

  // Fetch functions
  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data);
        setFormData({
          title: data.title,
          description: data.description || "",
          client_id: data.client_id?.toString() || "",
          status: data.status,
          hidden: !!data.hidden,
        });
      } else if (res.status === 404) {
        router.push("/dashboard/projects");
      }
    } catch (err) {
      console.error("Error fetching project:", err);
    } finally {
      setLoading(false);
    }
  }, [projectId, router]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/stats`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error("Error fetching stats:", err);
    }
  }, [projectId]);

  const fetchProjectUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/users`);
      if (res.ok) {
        const data = await res.json();
        setProjectUsers(data);
      }
    } catch (err) {
      console.error("Error fetching project users:", err);
    } finally {
      setLoadingUsers(false);
    }
  }, [projectId]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      console.error("Error fetching users:", err);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models");
      if (res.ok) {
        const data = await res.json();
        setModels(data);
      }
    } catch (err) {
      console.error("Error fetching models:", err);
    }
  }, []);

  const fetchProjectTags = useCallback(async () => {
    setLoadingTags(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/tags`);
      if (res.ok) {
        const data = await res.json();
        setProjectTags(data);
      }
    } catch (err) {
      console.error("Error fetching tags:", err);
    } finally {
      setLoadingTags(false);
    }
  }, [projectId]);

  const fetchGenerationConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/generation-config`);
      if (res.ok) {
        const data = await res.json();
        setGenerationConfig(data);
      }
    } catch (err) {
      console.error("Error fetching generation config:", err);
    } finally {
      setLoadingConfig(false);
    }
  }, [projectId]);

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const data = await res.json();
        setClients(data);
      }
    } catch (err) {
      console.error("Error fetching clients:", err);
    }
  }, []);

  useEffect(() => {
    fetchProject();
    fetchStats();
    fetchUsers();
    fetchModels();
    fetchClients();
    fetchProjectTags();
    fetchGenerationConfig();
  }, [fetchProject, fetchStats, fetchUsers, fetchModels, fetchClients, fetchProjectTags, fetchGenerationConfig]);

  useEffect(() => {
    if (activeTab === "users") {
      fetchProjectUsers();
    } else if (activeTab === "tags") {
      fetchProjectTags();
    } else if (activeTab === "config") {
      fetchGenerationConfig();
    }
  }, [activeTab, fetchProjectUsers, fetchProjectTags, fetchGenerationConfig]);

  // User handlers
  const handleAddUser = async () => {
    if (!selectedUserId) return;
    setSaving(true);

    try {
      const limitPayload: Record<string, number> = {};
      for (const key of Object.keys(addLimits) as LimitKey[]) {
        limitPayload[`max_monthly_${key}`] = addUnlimited[key] ? 0 : (Number(addLimits[key]) || 10);
      }
      const res = await fetch(`/api/projects/${projectId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: Number(selectedUserId),
          ...limitPayload,
        }),
      });

      if (res.ok) {
        setSelectedUserId("");
        setAddLimits(defaultLimits);
        setAddUnlimited({
          text_normal: true, text_hq: true,
          image_normal: false, image_hq: false,
          video_normal: false, video_hq: false,
          audio_normal: false, audio_hq: false,
        });
        fetchProjectUsers();
        fetchStats();
      } else {
        const data = await res.json();
        alert(data.error || "Error al agregar usuario");
      }
    } catch (err) {
      console.error("Error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateUserLimit = async (userId: number) => {
    setSaving(true);

    try {
      const editPayload: Record<string, number> = {};
      for (const key of Object.keys(editLimits) as LimitKey[]) {
        editPayload[`max_monthly_${key}`] = editUnlimited[key] ? 0 : (Number(editLimits[key]) || 10);
      }
      const res = await fetch(`/api/projects/${projectId}/users`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          ...editPayload,
        }),
      });

      if (res.ok) {
        setEditingUserLimit(null);
        fetchProjectUsers();
      } else {
        const data = await res.json();
        alert(data.error || "Error al actualizar límite");
      }
    } catch (err) {
      console.error("Error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveUser = async (userId: number) => {
    if (!confirm("¿Eliminar este usuario del proyecto?")) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/users?user_id=${userId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchProjectUsers();
        fetchStats();
      }
    } catch (err) {
      console.error("Error:", err);
    }
  };

  // Tag handlers
  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
      });

      if (res.ok) {
        setNewTagName("");
        setNewTagColor("#6366f1");
        fetchProjectTags();
      } else {
        const data = await res.json();
        alert(data.error || "Error al crear etiqueta");
      }
    } catch (err) {
      console.error("Error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateTag = async (tagId: number) => {
    setSaving(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_id: tagId, name: editTagName.trim(), color: editTagColor }),
      });

      if (res.ok) {
        setEditingTag(null);
        fetchProjectTags();
      } else {
        const data = await res.json();
        alert(data.error || "Error al actualizar etiqueta");
      }
    } catch (err) {
      console.error("Error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTag = async (tagId: number) => {
    if (!confirm("¿Eliminar esta etiqueta? Se quitará de todos los mensajes.")) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/tags?tag_id=${tagId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchProjectTags();
      }
    } catch (err) {
      console.error("Error:", err);
    }
  };

  // Generation config handlers
  const handleUpdateGenerationConfig = async (
    type: GenerationType,
    updates: { is_enabled?: boolean; model_normal_id?: number | null; model_hq_id?: number | null; model_chirp_id?: number | null }
  ) => {
    setSavingConfigType(type);

    try {
      const res = await fetch(`/api/projects/${projectId}/generation-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generation_type: type,
          ...updates,
        }),
      });

      if (res.ok) {
        fetchGenerationConfig();
      } else {
        const data = await res.json();
        alert(data.error || "Error al actualizar configuración");
      }
    } catch (err) {
      console.error("Error:", err);
    } finally {
      setSavingConfigType(null);
    }
  };

  // Project handlers
  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          client_id: formData.client_id ? Number(formData.client_id) : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Error al guardar");
        return;
      }

      setIsEditDialogOpen(false);
      fetchProject();
    } catch (err) {
      console.error("Error:", err);
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!confirm("¿Eliminar este proyecto? Esta acción no se puede deshacer.")) return;

    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        router.push("/dashboard/projects");
      } else {
        const data = await res.json();
        alert(data.error || "Error al eliminar");
      }
    } catch (err) {
      console.error("Error:", err);
    }
  };

  const getInitials = (name: string | null) => {
    if (!name) return "U";
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  };

  const formatTokens = (num: number) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M";
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K";
    }
    return num.toString();
  };

  const formatCost = (cost: number) => {
    const numCost = Number(cost) || 0;
    if (numCost === 0) return "$0.00";
    if (numCost < 0.01) return `$${numCost.toFixed(4)}`;
    if (numCost < 1) return `$${numCost.toFixed(3)}`;
    return `$${numCost.toFixed(2)}`;
  };

  const availableUsers = users.filter((u) => !projectUsers.some((pu) => pu.user_id === u.id));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Proyecto no encontrado</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/dashboard/projects")}
            className="mt-1"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{project.title}</h1>
              <Badge className={statusColors[project.status]}>
                {statusLabels[project.status]}
              </Badge>
            </div>
            {project.description && (
              <p className="text-muted-foreground mt-1">{project.description}</p>
            )}
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              {project.client_name && (
                <div className="flex items-center gap-1.5">
                  {project.client_logo ? (
                    <Image
                      src={project.client_logo}
                      alt={project.client_name}
                      width={16}
                      height={16}
                      className="rounded"
                    />
                  ) : (
                    <Building2 className="h-4 w-4" />
                  )}
                  {project.client_name}
                </div>
              )}
              <span>Creado {formatDateLocal(project.created_at)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setIsEditDialogOpen(true)}>
            <Pencil className="h-4 w-4 mr-1.5" />
            Editar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-400 border-red-500/30 hover:bg-red-500/10"
            onClick={handleDeleteProject}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Eliminar
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        <div className="bg-card rounded-xl border border-border/50 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Users className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.activeUsers}</p>
              <p className="text-sm text-muted-foreground">Usuarios</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border/50 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <MessageSquare className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.totalConversations}</p>
              <p className="text-sm text-muted-foreground">Conversaciones</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border/50 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <ImageIcon className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.totalImages}</p>
              <p className="text-sm text-muted-foreground">Imágenes</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border/50 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/10 rounded-lg">
              <Video className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.totalVideos}</p>
              <p className="text-sm text-muted-foreground">Videos</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border/50 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 rounded-lg">
              <Zap className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{formatTokens(stats.totalTokensInput)}</p>
              <p className="text-sm text-muted-foreground">Tokens In</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border/50 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-pink-500/10 rounded-lg">
              <Zap className="h-5 w-5 text-pink-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{formatTokens(stats.totalTokensOutput)}</p>
              <p className="text-sm text-muted-foreground">Tokens Out</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border/50 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <Zap className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{formatTokens(Number(stats.totalTokensInput) + Number(stats.totalTokensOutput))}</p>
              <p className="text-sm text-muted-foreground">Total Tokens</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border/50 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <DollarSign className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-green-400">{formatCost(stats.totalEstimatedCost)}</p>
              <p className="text-sm text-muted-foreground">Costo Est.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border/50">
        <div className="flex gap-1">
          {[
            { id: "overview" as TabType, label: "Resumen", icon: BarChart3 },
            { id: "users" as TabType, label: "Usuarios", icon: Users },
            { id: "calendar" as TabType, label: "Calendario", icon: CalendarDays },
            { id: "tags" as TabType, label: "Etiquetas", icon: Tag },
            { id: "config" as TabType, label: "Configuración", icon: Settings },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="bg-card rounded-xl border border-border/50">
        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="p-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium mb-3 flex items-center gap-2">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  Tipos de Generación
                </h3>
                {(() => {
                  const typeLabels: Record<GenerationType, { label: string; icon: typeof MessageSquare }> = {
                    text: { label: "Texto", icon: MessageSquare },
                    image: { label: "Imagen", icon: ImageIcon },
                    video: { label: "Video", icon: Video },
                    audio: { label: "Audio", icon: Mic },
                    music: { label: "Música", icon: Music },
                  };
                  const enabledTypes = (["text", "image", "video", "audio", "music"] as GenerationType[]).filter(
                    (type) => generationConfig[type]?.enabled
                  );

                  if (enabledTypes.length === 0) {
                    return <p className="text-sm text-muted-foreground">Sin tipos habilitados</p>;
                  }

                  return (
                    <div className="space-y-3">
                      {enabledTypes.map((type) => {
                        const config = generationConfig[type];
                        const { label, icon: Icon } = typeLabels[type];
                        return (
                          <div key={type} className="flex items-start gap-2 text-sm">
                            <Icon className="h-4 w-4 text-primary mt-0.5" />
                            <div>
                              <span className="font-medium">{label}</span>
                              <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                                {config.model_normal && (
                                  <div className="flex items-center gap-1">
                                    <Zap className="h-3 w-3" />
                                    <span>Normal: {config.model_normal.display_name}</span>
                                  </div>
                                )}
                                {config.model_hq && (
                                  <div className="flex items-center gap-1 text-amber-400">
                                    <Sparkles className="h-3 w-3" />
                                    <span>HQ: {config.model_hq.display_name}</span>
                                  </div>
                                )}
                                {config.model_chirp && (
                                  <div className="flex items-center gap-1 text-yellow-500">
                                    <AudioLines className="h-3 w-3" />
                                    <span>Chirp HD: {config.model_chirp.display_name}</span>
                                  </div>
                                )}
                                {!config.model_normal && !config.model_hq && !config.model_chirp && (
                                  <span className="text-yellow-500">Sin modelos asignados</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
              <div>
                <h3 className="font-medium mb-3 flex items-center gap-2">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                  Etiquetas
                </h3>
                {projectTags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin etiquetas creadas</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {projectTags.map((tag) => (
                      <span
                        key={tag.id}
                        className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                      >
                        {tag.name} ({tag.usage_count})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === "users" && (
          <div className="p-6 space-y-4">
            {/* Add user form */}
            <div className="space-y-3">
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="text-sm font-medium mb-1.5 block">Agregar Usuario</label>
                  <select
                    className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                  >
                    <option value="">Seleccionar usuario...</option>
                    {availableUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name || user.email}
                      </option>
                    ))}
                  </select>
                </div>
                <Button onClick={handleAddUser} disabled={!selectedUserId || saving}>
                  <UserPlus className="h-4 w-4 mr-1.5" />
                  Agregar
                </Button>
              </div>
              {selectedUserId && (
                <div className="grid grid-cols-4 gap-3 p-3 rounded-lg bg-muted/50 border border-border/50">
                  {([
                    { key: "text", label: "Texto", icon: <FileText className="h-3.5 w-3.5 text-green-400" />, color: "text-green-400" },
                    { key: "image", label: "Imagen", icon: <ImageIcon className="h-3.5 w-3.5 text-blue-400" />, color: "text-blue-400" },
                    { key: "video", label: "Video", icon: <Video className="h-3.5 w-3.5 text-purple-400" />, color: "text-purple-400" },
                    { key: "audio", label: "Audio", icon: <Mic className="h-3.5 w-3.5 text-orange-400" />, color: "text-orange-400" },
                  ] as const).map(({ key, label, icon }) => (
                    <div key={key} className="space-y-2">
                      <div className="text-xs font-medium flex items-center gap-1.5">{icon} {label}</div>
                      {(["normal", "hq"] as const).map((tier) => {
                        const k = `${key}_${tier}` as LimitKey;
                        return (
                          <div key={tier} className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground w-6 uppercase">{tier}</span>
                            <Input
                              type="number"
                              min="1"
                              value={addLimits[k]}
                              onChange={(e) => setAddLimits(prev => ({ ...prev, [k]: e.target.value }))}
                              className="w-16 h-7 text-xs bg-muted border-border/50"
                              disabled={addUnlimited[k]}
                            />
                            <label className="flex items-center gap-0.5 cursor-pointer text-[10px]">
                              <input
                                type="checkbox"
                                checked={addUnlimited[k]}
                                onChange={(e) => setAddUnlimited(prev => ({ ...prev, [k]: e.target.checked }))}
                                className="w-3 h-3 rounded accent-primary"
                              />
                              <span className="text-muted-foreground">∞</span>
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Users table */}
            {loadingUsers ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : projectUsers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No hay usuarios asignados a este proyecto
              </div>
            ) : (
              <div className="space-y-2">
                {projectUsers.map((pu) => {
                  const isEditing = editingUserLimit === pu.user_id;
                  const limitTypes = [
                    { key: "text", label: "Texto", icon: <FileText className="h-3 w-3 text-green-400" /> },
                    { key: "image", label: "Imagen", icon: <ImageIcon className="h-3 w-3 text-blue-400" /> },
                    { key: "video", label: "Video", icon: <Video className="h-3 w-3 text-purple-400" /> },
                    { key: "audio", label: "Audio", icon: <Mic className="h-3 w-3 text-orange-400" /> },
                  ] as const;

                  const formatLimit = (val: number) => val === 0 ? "∞" : val.toString();

                  return (
                    <div key={pu.id} className="rounded-lg border border-border/50 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={pu.user_image || undefined} />
                            <AvatarFallback className="bg-primary/20 text-primary text-xs">
                              {getInitials(pu.user_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium text-sm">{pu.user_name || pu.user_email}</div>
                            <div className="text-xs text-muted-foreground">{pu.user_email}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {isEditing ? (
                            <>
                              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-green-500/10" onClick={() => handleUpdateUserLimit(pu.user_id)} disabled={saving}>
                                <Check className="h-4 w-4 text-green-400" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingUserLimit(null)}>
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                                setEditingUserLimit(pu.user_id);
                                const newLimits = {} as Record<LimitKey, string>;
                                const newUnlimited = {} as Record<LimitKey, boolean>;
                                for (const t of ["text", "image", "video", "audio"] as const) {
                                  for (const q of ["normal", "hq"] as const) {
                                    const k = `${t}_${q}` as LimitKey;
                                    const dbKey = `max_monthly_${t}_${q}` as keyof ProjectUser;
                                    const val = (pu[dbKey] as number) || 0;
                                    newUnlimited[k] = val === 0;
                                    newLimits[k] = val === 0 ? "10" : val.toString();
                                  }
                                }
                                setEditLimits(newLimits);
                                setEditUnlimited(newUnlimited);
                              }}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-red-500/10" onClick={() => handleRemoveUser(pu.user_id)}>
                                <Trash2 className="h-4 w-4 text-red-400" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Limits grid */}
                      <div className="grid grid-cols-4 gap-3">
                        {limitTypes.map(({ key, label, icon }) => (
                          <div key={key} className="space-y-1">
                            <div className="text-[10px] font-medium flex items-center gap-1 text-muted-foreground">{icon} {label}</div>
                            {(["normal", "hq"] as const).map((tier) => {
                              const k = `${key}_${tier}` as LimitKey;
                              const dbKey = `max_monthly_${key}_${tier}` as keyof ProjectUser;
                              const val = (pu[dbKey] as number) || 0;
                              return (
                                <div key={tier} className="flex items-center gap-1">
                                  <span className="text-[10px] text-muted-foreground w-5 uppercase">{tier}</span>
                                  {isEditing ? (
                                    <>
                                      <Input
                                        type="number"
                                        min="1"
                                        value={editLimits[k]}
                                        onChange={(e) => setEditLimits(prev => ({ ...prev, [k]: e.target.value }))}
                                        className="w-14 h-6 text-xs bg-muted border-border/50 px-1.5"
                                        disabled={editUnlimited[k]}
                                      />
                                      <label className="flex items-center gap-0.5 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={editUnlimited[k]}
                                          onChange={(e) => setEditUnlimited(prev => ({ ...prev, [k]: e.target.checked }))}
                                          className="w-3 h-3 rounded accent-primary"
                                        />
                                        <span className="text-[10px] text-muted-foreground">∞</span>
                                      </label>
                                    </>
                                  ) : (
                                    <span className="text-xs tabular-nums">{formatLimit(val)}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Calendar Tab */}
        {activeTab === "calendar" && (
          <div className="p-6">
            <ProjectCalendar projectId={Number(projectId)} />
          </div>
        )}

        {/* Tags Tab */}
        {activeTab === "tags" && (
          <div className="p-6 space-y-4">
            {/* Create tag form */}
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-sm font-medium mb-1.5 block">Nueva Etiqueta</label>
                <Input
                  placeholder="Nombre de la etiqueta"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value.toUpperCase())}
                  className="bg-muted border-border/50"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Color</label>
                <div className="flex gap-1">
                  {tagColors.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewTagColor(c)}
                      className={`w-8 h-8 rounded-lg transition-all ${newTagColor === c ? "ring-2 ring-offset-2 ring-offset-background ring-primary" : ""}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <Button onClick={handleCreateTag} disabled={!newTagName.trim() || saving}>
                <Plus className="h-4 w-4 mr-1.5" />
                Crear
              </Button>
            </div>

            {/* Tags list */}
            {loadingTags ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : projectTags.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No hay etiquetas creadas en este proyecto
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead>Etiqueta</TableHead>
                    <TableHead>Uso</TableHead>
                    <TableHead className="w-[100px]">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projectTags.map((tag) => (
                    <TableRow key={tag.id} className="border-border/50">
                      <TableCell>
                        {editingTag === tag.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={editTagName}
                              onChange={(e) => setEditTagName(e.target.value.toUpperCase())}
                              className="w-40 h-8 bg-muted border-border/50"
                            />
                            <div className="flex gap-1">
                              {tagColors.map((c) => (
                                <button
                                  key={c}
                                  onClick={() => setEditTagColor(c)}
                                  className={`w-6 h-6 rounded transition-all ${editTagColor === c ? "ring-2 ring-offset-1" : ""}`}
                                  style={{ backgroundColor: c }}
                                />
                              ))}
                            </div>
                          </div>
                        ) : (
                          <span
                            className="px-3 py-1 rounded-full text-sm font-medium"
                            style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                          >
                            {tag.name}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">{tag.usage_count} usos</span>
                      </TableCell>
                      <TableCell>
                        {editingTag === tag.id ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 hover:bg-green-500/10"
                              onClick={() => handleUpdateTag(tag.id)}
                              disabled={saving}
                            >
                              <Check className="h-4 w-4 text-green-400" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setEditingTag(null)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                setEditingTag(tag.id);
                                setEditTagName(tag.name);
                                setEditTagColor(tag.color);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 hover:bg-red-500/10"
                              onClick={() => handleDeleteTag(tag.id)}
                            >
                              <Trash2 className="h-4 w-4 text-red-400" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}

        {/* Config Tab */}
        {activeTab === "config" && (
          <div className="p-6 space-y-6">
            <div className="space-y-2">
              <h3 className="font-medium">Configuración de Tipos de Generación</h3>
              <p className="text-sm text-muted-foreground">
                Habilita o deshabilita tipos de generación y asigna los modelos Normal, HQ y Chirp HD para cada uno.
              </p>
            </div>

            {loadingConfig ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-4">
                {(["text", "image", "video", "audio", "music"] as GenerationType[]).map((type) => {
                  const config = generationConfig[type];
                  const typeLabels: Record<GenerationType, { label: string; icon: typeof MessageSquare }> = {
                    text: { label: "Texto", icon: MessageSquare },
                    image: { label: "Imagen", icon: ImageIcon },
                    video: { label: "Video", icon: Video },
                    audio: { label: "Audio", icon: Mic },
                    music: { label: "Música", icon: Music },
                  };
                  const { label, icon: Icon } = typeLabels[type];
                  const isSaving = savingConfigType === type;

                  return (
                    <div
                      key={type}
                      className={`p-4 rounded-lg border transition-colors ${
                        config.enabled
                          ? "bg-card border-border/50"
                          : "bg-muted/50 border-border/30 opacity-75"
                      }`}
                    >
                      {/* Header with toggle */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${config.enabled ? "bg-primary/10" : "bg-muted"}`}>
                            <Icon className={`h-5 w-5 ${config.enabled ? "text-primary" : "text-muted-foreground"}`} />
                          </div>
                          <div>
                            <div className="font-medium">{label}</div>
                            <div className="text-xs text-muted-foreground">
                              {config.enabled ? "Habilitado" : "Deshabilitado"}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleUpdateGenerationConfig(type, { is_enabled: !config.enabled })}
                          disabled={isSaving}
                          className="transition-colors"
                        >
                          {isSaving ? (
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                          ) : config.enabled ? (
                            <ToggleRight className="h-8 w-8 text-primary" />
                          ) : (
                            <ToggleLeft className="h-8 w-8 text-muted-foreground" />
                          )}
                        </button>
                      </div>

                      {/* Model selectors */}
                      {config.enabled && (
                        <div className={`grid gap-4 pt-4 border-t border-border/30 ${type === "audio" ? "grid-cols-3" : "grid-cols-2"}`}>
                          {/* Normal model */}
                          <div>
                            <label className="text-xs font-medium mb-1.5 flex items-center gap-1.5 text-muted-foreground">
                              <Zap className="h-3.5 w-3.5" />
                              Modelo Normal
                            </label>
                            <select
                              className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                              value={config.model_normal?.id || ""}
                              onChange={(e) =>
                                handleUpdateGenerationConfig(type, {
                                  model_normal_id: e.target.value ? Number(e.target.value) : null,
                                })
                              }
                              disabled={isSaving}
                            >
                              <option value="">Sin modelo asignado</option>
                              {models.map((model) => (
                                <option key={model.id} value={model.id}>
                                  {model.display_name}
                                </option>
                              ))}
                            </select>
                            {config.model_normal && (
                              <div className="text-xs text-muted-foreground mt-1 font-mono">
                                {config.model_normal.model_id}
                              </div>
                            )}
                          </div>

                          {/* HQ model */}
                          <div>
                            <label className="text-xs font-medium mb-1.5 flex items-center gap-1.5 text-amber-400">
                              <Sparkles className="h-3.5 w-3.5" />
                              Modelo HQ
                            </label>
                            <select
                              className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                              value={config.model_hq?.id || ""}
                              onChange={(e) =>
                                handleUpdateGenerationConfig(type, {
                                  model_hq_id: e.target.value ? Number(e.target.value) : null,
                                })
                              }
                              disabled={isSaving}
                            >
                              <option value="">Sin modelo asignado</option>
                              {models.map((model) => (
                                <option key={model.id} value={model.id}>
                                  {model.display_name}
                                </option>
                              ))}
                            </select>
                            {config.model_hq && (
                              <div className="text-xs text-muted-foreground mt-1 font-mono">
                                {config.model_hq.model_id}
                              </div>
                            )}
                          </div>

                          {/* Chirp HD model — only for audio */}
                          {type === "audio" && (
                            <div>
                              <label className="text-xs font-medium mb-1.5 flex items-center gap-1.5 text-yellow-500">
                                <AudioLines className="h-3.5 w-3.5" />
                                Modelo Chirp HD
                              </label>
                              <select
                                className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                                value={config.model_chirp?.id || ""}
                                onChange={(e) =>
                                  handleUpdateGenerationConfig(type, {
                                    model_chirp_id: e.target.value ? Number(e.target.value) : null,
                                  })
                                }
                                disabled={isSaving}
                              >
                                <option value="">Sin modelo asignado</option>
                                {models.map((model) => (
                                  <option key={model.id} value={model.id}>
                                    {model.display_name}
                                  </option>
                                ))}
                              </select>
                              {config.model_chirp && (
                                <div className="text-xs text-muted-foreground mt-1 font-mono">
                                  {config.model_chirp.model_id}
                                </div>
                              )}
                              <div className="text-[10px] text-yellow-600 dark:text-yellow-400 mt-1">
                                Habilita &quot;Audio HD&quot; en nueva conversación
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Project Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle>Editar Proyecto</DialogTitle>
            <DialogDescription>Modifica los datos del proyecto</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateProject}>
            <div className="space-y-4 py-4">
              {error && (
                <div className="bg-red-500/10 text-red-400 p-3 rounded-lg text-sm border border-red-500/20">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">Título *</label>
                <Input
                  type="text"
                  placeholder="Nombre del proyecto"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                  className="bg-muted border-border/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Descripción</label>
                <textarea
                  placeholder="Descripción del proyecto (opcional)"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Cliente</label>
                <select
                  className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                  value={formData.client_id}
                  onChange={(e) => setFormData({ ...formData, client_id: e.target.value })}
                >
                  <option value="">Sin cliente</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Estado</label>
                <select
                  className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  <option value="active">Activo</option>
                  <option value="paused">Pausado</option>
                  <option value="completed">Completado</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Oculto</label>
                  <p className="text-xs text-muted-foreground">No aparece en la lista de proyectos para usuarios no asignados</p>
                </div>
                <Switch
                  checked={formData.hidden}
                  onCheckedChange={(checked) => setFormData({ ...formData, hidden: checked })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)} className="border-border/50">
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
