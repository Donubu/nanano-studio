"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
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
  created_at: string;
}

interface ProjectUser {
  id: number;
  user_id: number;
  user_email: string;
  user_name: string | null;
  user_image: string | null;
  role: string;
  max_monthly_image_generations: number;
  max_monthly_video_generations: number;
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

interface ProjectModel {
  id: number;
  model_id: number;
  model_model_id: string;
  model_display_name: string;
  is_default: boolean;
  system_instruction: string | null;
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

type TabType = "overview" | "users" | "models" | "tags";

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
  const [maxImageGenerations, setMaxImageGenerations] = useState("10");
  const [maxVideoGenerations, setMaxVideoGenerations] = useState("10");
  const [unlimitedImageGenerations, setUnlimitedImageGenerations] = useState(false);
  const [unlimitedVideoGenerations, setUnlimitedVideoGenerations] = useState(false);
  const [editingUserLimit, setEditingUserLimit] = useState<number | null>(null);
  const [editMaxImageGenerations, setEditMaxImageGenerations] = useState("");
  const [editMaxVideoGenerations, setEditMaxVideoGenerations] = useState("");
  const [editUnlimitedImage, setEditUnlimitedImage] = useState(false);
  const [editUnlimitedVideo, setEditUnlimitedVideo] = useState(false);

  // Models state
  const [projectModels, setProjectModels] = useState<ProjectModel[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [editingSystemInstruction, setEditingSystemInstruction] = useState<number | null>(null);
  const [systemInstructionText, setSystemInstructionText] = useState("");

  // Tags state
  const [projectTags, setProjectTags] = useState<ProjectTag[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");
  const [editingTag, setEditingTag] = useState<number | null>(null);
  const [editTagName, setEditTagName] = useState("");
  const [editTagColor, setEditTagColor] = useState("");

  // Edit project state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    client_id: "",
    status: "active",
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

  const fetchProjectModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/models`);
      if (res.ok) {
        const data = await res.json();
        setProjectModels(data);
      }
    } catch (err) {
      console.error("Error fetching project models:", err);
    } finally {
      setLoadingModels(false);
    }
  }, [projectId]);

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
    fetchProjectModels();
    fetchProjectTags();
  }, [fetchProject, fetchStats, fetchUsers, fetchModels, fetchClients, fetchProjectModels, fetchProjectTags]);

  useEffect(() => {
    if (activeTab === "users") {
      fetchProjectUsers();
    } else if (activeTab === "models") {
      fetchProjectModels();
    } else if (activeTab === "tags") {
      fetchProjectTags();
    }
  }, [activeTab, fetchProjectUsers, fetchProjectModels, fetchProjectTags]);

  // User handlers
  const handleAddUser = async () => {
    if (!selectedUserId) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: Number(selectedUserId),
          max_monthly_image_generations: unlimitedImageGenerations ? 0 : (Number(maxImageGenerations) || 10),
          max_monthly_video_generations: unlimitedVideoGenerations ? 0 : (Number(maxVideoGenerations) || 10),
        }),
      });

      if (res.ok) {
        setSelectedUserId("");
        setMaxImageGenerations("10");
        setMaxVideoGenerations("10");
        setUnlimitedImageGenerations(false);
        setUnlimitedVideoGenerations(false);
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
      const res = await fetch(`/api/projects/${projectId}/users`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          max_monthly_image_generations: editUnlimitedImage ? 0 : (Number(editMaxImageGenerations) || 10),
          max_monthly_video_generations: editUnlimitedVideo ? 0 : (Number(editMaxVideoGenerations) || 10),
        }),
      });

      if (res.ok) {
        setEditingUserLimit(null);
        setEditUnlimitedImage(false);
        setEditUnlimitedVideo(false);
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

  // Model handlers
  const handleAddModel = async () => {
    if (!selectedModelId) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: Number(selectedModelId) }),
      });

      if (res.ok) {
        setSelectedModelId("");
        fetchProjectModels();
      } else {
        const data = await res.json();
        alert(data.error || "Error al agregar modelo");
      }
    } catch (err) {
      console.error("Error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveModel = async (modelId: number) => {
    if (!confirm("¿Eliminar este modelo del proyecto?")) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/models?model_id=${modelId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchProjectModels();
      }
    } catch (err) {
      console.error("Error:", err);
    }
  };

  const handleSetDefaultModel = async (modelId: number) => {
    try {
      await fetch(`/api/projects/${projectId}/models`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId, is_default: true }),
      });
      fetchProjectModels();
    } catch (err) {
      console.error("Error:", err);
    }
  };

  const handleSaveSystemInstruction = async (modelId: number) => {
    setSaving(true);

    try {
      await fetch(`/api/projects/${projectId}/models`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: modelId,
          system_instruction: systemInstructionText || null,
        }),
      });
      setEditingSystemInstruction(null);
      fetchProjectModels();
    } catch (err) {
      console.error("Error:", err);
    } finally {
      setSaving(false);
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
  const availableModels = models.filter((m) => !projectModels.some((pm) => pm.model_id === m.id));

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
            { id: "models" as TabType, label: "Modelos", icon: Cpu },
            { id: "tags" as TabType, label: "Etiquetas", icon: Tag },
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
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  Modelos Asignados
                </h3>
                {projectModels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin modelos asignados</p>
                ) : (
                  <div className="space-y-2">
                    {projectModels.map((pm) => (
                      <div key={pm.id} className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{pm.model_display_name}</span>
                        {Boolean(pm.is_default) && (
                          <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">Default</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
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
              {selectedUserId && (
                <>
                  <div>
                    <label className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
                      <ImageIcon className="h-3.5 w-3.5 text-blue-400" />
                      Imágenes/mes
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        value={maxImageGenerations}
                        onChange={(e) => setMaxImageGenerations(e.target.value)}
                        className="w-20 bg-muted border-border/50"
                        disabled={unlimitedImageGenerations}
                      />
                      <label className="flex items-center gap-1 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={unlimitedImageGenerations}
                          onChange={(e) => setUnlimitedImageGenerations(e.target.checked)}
                          className="w-4 h-4 rounded accent-primary"
                        />
                        <span className="text-muted-foreground">Ilimitado</span>
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
                      <Video className="h-3.5 w-3.5 text-purple-400" />
                      Videos/mes
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        value={maxVideoGenerations}
                        onChange={(e) => setMaxVideoGenerations(e.target.value)}
                        className="w-20 bg-muted border-border/50"
                        disabled={unlimitedVideoGenerations}
                      />
                      <label className="flex items-center gap-1 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={unlimitedVideoGenerations}
                          onChange={(e) => setUnlimitedVideoGenerations(e.target.checked)}
                          className="w-4 h-4 rounded accent-primary"
                        />
                        <span className="text-muted-foreground">Ilimitado</span>
                      </label>
                    </div>
                  </div>
                </>
              )}
              <Button onClick={handleAddUser} disabled={!selectedUserId || saving}>
                <UserPlus className="h-4 w-4 mr-1.5" />
                Agregar
              </Button>
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
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead>Usuario</TableHead>
                    <TableHead>Límite Imágenes</TableHead>
                    <TableHead>Límite Videos</TableHead>
                    <TableHead className="w-[100px]">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projectUsers.map((pu) => (
                    <TableRow key={pu.id} className="border-border/50">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={pu.user_image || undefined} />
                            <AvatarFallback className="bg-primary/20 text-primary text-xs">
                              {getInitials(pu.user_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{pu.user_name || pu.user_email}</div>
                            <div className="text-xs text-muted-foreground">{pu.user_email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {editingUserLimit === pu.user_id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min="1"
                              value={editMaxImageGenerations}
                              onChange={(e) => setEditMaxImageGenerations(e.target.value)}
                              className="w-20 h-8 bg-muted border-border/50"
                              disabled={editUnlimitedImage}
                            />
                            <label className="flex items-center gap-1 cursor-pointer text-xs">
                              <input
                                type="checkbox"
                                checked={editUnlimitedImage}
                                onChange={(e) => setEditUnlimitedImage(e.target.checked)}
                                className="w-3 h-3 rounded accent-primary"
                              />
                              ∞
                            </label>
                          </div>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <ImageIcon className="h-3.5 w-3.5 text-blue-400" />
                            {pu.max_monthly_image_generations === 0 ? "Ilimitado" : pu.max_monthly_image_generations}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingUserLimit === pu.user_id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min="1"
                              value={editMaxVideoGenerations}
                              onChange={(e) => setEditMaxVideoGenerations(e.target.value)}
                              className="w-20 h-8 bg-muted border-border/50"
                              disabled={editUnlimitedVideo}
                            />
                            <label className="flex items-center gap-1 cursor-pointer text-xs">
                              <input
                                type="checkbox"
                                checked={editUnlimitedVideo}
                                onChange={(e) => setEditUnlimitedVideo(e.target.checked)}
                                className="w-3 h-3 rounded accent-primary"
                              />
                              ∞
                            </label>
                          </div>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <Video className="h-3.5 w-3.5 text-purple-400" />
                            {pu.max_monthly_video_generations === 0 ? "Ilimitado" : pu.max_monthly_video_generations}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingUserLimit === pu.user_id ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 hover:bg-green-500/10"
                              onClick={() => handleUpdateUserLimit(pu.user_id)}
                              disabled={saving}
                            >
                              <Check className="h-4 w-4 text-green-400" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setEditingUserLimit(null)}
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
                                setEditingUserLimit(pu.user_id);
                                setEditMaxImageGenerations(pu.max_monthly_image_generations === 0 ? "10" : pu.max_monthly_image_generations.toString());
                                setEditMaxVideoGenerations(pu.max_monthly_video_generations === 0 ? "10" : pu.max_monthly_video_generations.toString());
                                setEditUnlimitedImage(pu.max_monthly_image_generations === 0);
                                setEditUnlimitedVideo(pu.max_monthly_video_generations === 0);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 hover:bg-red-500/10"
                              onClick={() => handleRemoveUser(pu.user_id)}
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

        {/* Models Tab */}
        {activeTab === "models" && (
          <div className="p-6 space-y-4">
            {/* Add model form */}
            <div className="flex gap-3">
              <select
                className="flex-1 bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
              >
                <option value="">Seleccionar modelo...</option>
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.display_name}
                  </option>
                ))}
              </select>
              <Button onClick={handleAddModel} disabled={!selectedModelId || saving}>
                <Plus className="h-4 w-4 mr-1.5" />
                Agregar Modelo
              </Button>
            </div>

            {/* Models list */}
            {loadingModels ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : projectModels.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No hay modelos asignados a este proyecto
              </div>
            ) : (
              <div className="space-y-3">
                {projectModels.map((pm) => (
                  <div key={pm.id} className="p-4 bg-muted rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Cpu className="h-5 w-5 text-primary" />
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {pm.model_display_name}
                            {Boolean(pm.is_default) && (
                              <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">Default</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">{pm.model_model_id}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!Boolean(pm.is_default) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-yellow-500/10"
                            onClick={() => handleSetDefaultModel(pm.model_id)}
                            title="Establecer como default"
                          >
                            <Star className="h-4 w-4 text-yellow-400" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-red-500/10"
                          onClick={() => handleRemoveModel(pm.model_id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-400" />
                        </Button>
                      </div>
                    </div>

                    {/* System Instruction */}
                    <div className="border-t border-border/30 pt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">
                          Instrucción del Sistema Base
                        </span>
                      </div>
                      {editingSystemInstruction === pm.model_id ? (
                        <div className="space-y-2">
                          <textarea
                            value={systemInstructionText}
                            onChange={(e) => setSystemInstructionText(e.target.value)}
                            placeholder="Ej: Eres un asistente experto en desarrollo de software..."
                            rows={4}
                            className="w-full bg-card border border-border/50 rounded-lg px-3 py-2 text-sm resize-none"
                            autoFocus
                          />
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setEditingSystemInstruction(null)}>
                              Cancelar
                            </Button>
                            <Button size="sm" onClick={() => handleSaveSystemInstruction(pm.model_id)} disabled={saving}>
                              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                              <span className="ml-1">Guardar</span>
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingSystemInstruction(pm.model_id);
                            setSystemInstructionText(pm.system_instruction || "");
                          }}
                          className="w-full text-left p-3 rounded border border-dashed border-border/50 hover:border-primary/50 hover:bg-card transition-colors"
                        >
                          {pm.system_instruction ? (
                            <p className="text-sm text-foreground whitespace-pre-wrap">{pm.system_instruction}</p>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">Click para agregar instrucción base...</p>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                  onChange={(e) => setNewTagName(e.target.value)}
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
                              onChange={(e) => setEditTagName(e.target.value)}
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
