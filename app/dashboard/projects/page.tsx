"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Users,
  Building2,
  X,
  UserPlus,
  Zap,
  Check,
  Cpu,
  Star,
  FileText,
  Save,
} from "lucide-react";
import Image from "next/image";
import { formatDateLocal } from "@/lib/utils";

interface Client {
  id: number;
  name: string;
  logo: string | null;
}

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
  max_monthly_generations: number;
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

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isUsersDialogOpen, setIsUsersDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectUsers, setProjectUsers] = useState<ProjectUser[]>([]);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    client_id: "",
    status: "active",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [maxGenerations, setMaxGenerations] = useState("10");
  const [unlimitedGenerations, setUnlimitedGenerations] = useState(false);
  const [editingUserLimit, setEditingUserLimit] = useState<number | null>(null);
  const [editMaxGenerations, setEditMaxGenerations] = useState("");
  const [editUnlimited, setEditUnlimited] = useState(false);

  // Models state
  const [isModelsDialogOpen, setIsModelsDialogOpen] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [projectModels, setProjectModels] = useState<ProjectModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [editingSystemInstruction, setEditingSystemInstruction] = useState<number | null>(null);
  const [systemInstructionText, setSystemInstructionText] = useState("");

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (err) {
      console.error("Error fetching projects:", err);
    } finally {
      setLoading(false);
    }
  }, []);

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

  const fetchProjectUsers = async (projectId: number) => {
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
  };

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

  const fetchProjectModels = async (projectId: number) => {
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
  };

  useEffect(() => {
    fetchProjects();
    fetchClients();
    fetchUsers();
    fetchModels();
  }, [fetchProjects, fetchClients, fetchUsers, fetchModels]);

  const openCreateDialog = () => {
    setEditingProject(null);
    setFormData({ title: "", description: "", client_id: "", status: "active" });
    setError("");
    setIsDialogOpen(true);
  };

  const openEditDialog = (project: Project) => {
    setEditingProject(project);
    setFormData({
      title: project.title,
      description: project.description || "",
      client_id: project.client_id?.toString() || "",
      status: project.status,
    });
    setError("");
    setIsDialogOpen(true);
  };

  const openDeleteDialog = (project: Project) => {
    setDeletingProject(project);
    setIsDeleteDialogOpen(true);
  };

  const openUsersDialog = (project: Project) => {
    setSelectedProject(project);
    setSelectedUserId("");
    setMaxGenerations("10");
    setUnlimitedGenerations(false);
    setEditingUserLimit(null);
    fetchProjectUsers(project.id);
    setIsUsersDialogOpen(true);
  };

  const openModelsDialog = (project: Project) => {
    setSelectedProject(project);
    setSelectedModelId("");
    fetchProjectModels(project.id);
    setIsModelsDialogOpen(true);
  };

  const handleAddModel = async () => {
    if (!selectedProject || !selectedModelId) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: Number(selectedModelId) }),
      });

      if (res.ok) {
        setSelectedModelId("");
        fetchProjectModels(selectedProject.id);
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
    if (!selectedProject) return;

    try {
      const res = await fetch(
        `/api/projects/${selectedProject.id}/models?model_id=${modelId}`,
        { method: "DELETE" }
      );

      if (res.ok) {
        fetchProjectModels(selectedProject.id);
      }
    } catch (err) {
      console.error("Error:", err);
    }
  };

  const handleSetDefaultModel = async (modelId: number) => {
    if (!selectedProject) return;

    try {
      await fetch(`/api/projects/${selectedProject.id}/models`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId, is_default: true }),
      });
      fetchProjectModels(selectedProject.id);
    } catch (err) {
      console.error("Error:", err);
    }
  };

  const handleSaveSystemInstruction = async (modelId: number) => {
    if (!selectedProject) return;
    setSaving(true);

    try {
      await fetch(`/api/projects/${selectedProject.id}/models`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: modelId,
          system_instruction: systemInstructionText || null,
        }),
      });
      setEditingSystemInstruction(null);
      fetchProjectModels(selectedProject.id);
    } catch (err) {
      console.error("Error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      const url = editingProject
        ? `/api/projects/${editingProject.id}`
        : "/api/projects";
      const method = editingProject ? "PUT" : "POST";

      const payload = {
        ...formData,
        client_id: formData.client_id ? Number(formData.client_id) : null,
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error al guardar");
        return;
      }

      setIsDialogOpen(false);
      fetchProjects();
    } catch (err) {
      console.error("Error:", err);
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingProject) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/projects/${deletingProject.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setIsDeleteDialogOpen(false);
        fetchProjects();
      } else {
        const data = await res.json();
        alert(data.error || "Error al eliminar");
      }
    } catch (err) {
      console.error("Error:", err);
      alert("Error de conexión");
    } finally {
      setSaving(false);
    }
  };

  const handleAddUser = async () => {
    if (!selectedProject || !selectedUserId) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: Number(selectedUserId),
          max_monthly_generations: unlimitedGenerations ? 0 : (Number(maxGenerations) || 10),
        }),
      });

      if (res.ok) {
        setSelectedUserId("");
        setMaxGenerations("10");
        setUnlimitedGenerations(false);
        fetchProjectUsers(selectedProject.id);
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
    if (!selectedProject) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/users`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          max_monthly_generations: editUnlimited ? 0 : (Number(editMaxGenerations) || 10),
        }),
      });

      if (res.ok) {
        setEditingUserLimit(null);
        setEditUnlimited(false);
        fetchProjectUsers(selectedProject.id);
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
    if (!selectedProject) return;

    try {
      const res = await fetch(
        `/api/projects/${selectedProject.id}/users?user_id=${userId}`,
        { method: "DELETE" }
      );

      if (res.ok) {
        fetchProjectUsers(selectedProject.id);
      }
    } catch (err) {
      console.error("Error:", err);
    }
  };

  const getInitials = (name: string | null) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const availableUsers = users.filter(
    (u) => !projectUsers.some((pu) => pu.user_id === u.id)
  );

  const availableModels = models.filter(
    (m) => !projectModels.some((pm) => pm.model_id === m.id)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Proyectos</h1>
          <p className="text-muted-foreground">
            Gestiona tus proyectos y asigna usuarios
          </p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo Proyecto
        </Button>
      </div>

      <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="text-muted-foreground">Proyecto</TableHead>
              <TableHead className="text-muted-foreground">Cliente</TableHead>
              <TableHead className="text-muted-foreground">Estado</TableHead>
              <TableHead className="text-muted-foreground">Fecha</TableHead>
              <TableHead className="w-[140px] text-muted-foreground">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No hay proyectos registrados
                </TableCell>
              </TableRow>
            ) : (
              projects.map((project) => (
                <TableRow key={project.id} className="border-border/50 hover:bg-accent/50">
                  <TableCell>
                    <div>
                      <div className="font-medium">{project.title}</div>
                      {project.description && (
                        <div className="text-sm text-muted-foreground truncate max-w-[300px]">
                          {project.description}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {project.client_name ? (
                      <div className="flex items-center gap-2">
                        {project.client_logo ? (
                          <Image
                            src={project.client_logo}
                            alt={project.client_name}
                            width={24}
                            height={24}
                            className="rounded"
                          />
                        ) : (
                          <Building2 className="h-5 w-5 text-muted-foreground" />
                        )}
                        <span className="text-sm">{project.client_name}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColors[project.status]}>
                      {statusLabels[project.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateLocal(project.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-accent"
                        onClick={() => openUsersDialog(project)}
                        title="Gestionar usuarios"
                      >
                        <Users className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-accent"
                        onClick={() => openModelsDialog(project)}
                        title="Gestionar modelos"
                      >
                        <Cpu className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-accent"
                        onClick={() => openEditDialog(project)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-red-500/10"
                        onClick={() => openDeleteDialog(project)}
                      >
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Dialog para crear/editar */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle>
              {editingProject ? "Editar Proyecto" : "Nuevo Proyecto"}
            </DialogTitle>
            <DialogDescription>
              {editingProject
                ? "Modifica los datos del proyecto"
                : "Ingresa los datos del nuevo proyecto"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
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
                  onChange={(e) =>
                    setFormData({ ...formData, title: e.target.value })
                  }
                  required
                  className="bg-muted border-border/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Descripción</label>
                <textarea
                  placeholder="Descripción del proyecto (opcional)"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={3}
                  className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Cliente</label>
                <select
                  className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                  value={formData.client_id}
                  onChange={(e) =>
                    setFormData({ ...formData, client_id: e.target.value })
                  }
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
                  onChange={(e) =>
                    setFormData({ ...formData, status: e.target.value })
                  }
                >
                  <option value="active">Activo</option>
                  <option value="paused">Pausado</option>
                  <option value="completed">Completado</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
                className="border-border/50"
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingProject ? "Guardar" : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog para gestionar usuarios */}
      <Dialog open={isUsersDialogOpen} onOpenChange={setIsUsersDialogOpen}>
        <DialogContent className="bg-card border-border/50 max-w-lg">
          <DialogHeader>
            <DialogTitle>Usuarios del Proyecto</DialogTitle>
            <DialogDescription>
              {selectedProject?.title}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Agregar usuario */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <select
                  className="flex-1 bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
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
                <Button
                  onClick={handleAddUser}
                  disabled={!selectedUserId || saving}
                  size="sm"
                >
                  <UserPlus className="h-4 w-4" />
                </Button>
              </div>
              {selectedUserId && (
                <div className="flex items-center gap-3 pl-1">
                  <Zap className="h-4 w-4 text-yellow-400" />
                  <span className="text-sm text-muted-foreground">Límite mensual:</span>
                  <Input
                    type="number"
                    min="1"
                    value={maxGenerations}
                    onChange={(e) => setMaxGenerations(e.target.value)}
                    className="w-20 h-8 bg-muted border-border/50 text-sm"
                    placeholder="10"
                    disabled={unlimitedGenerations}
                  />
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={unlimitedGenerations}
                      onChange={(e) => setUnlimitedGenerations(e.target.checked)}
                      className="w-4 h-4 rounded border-border/50 bg-muted accent-primary"
                    />
                    <span className="text-sm text-muted-foreground">Sin límite</span>
                  </label>
                </div>
              )}
            </div>

            {/* Lista de usuarios */}
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {loadingUsers ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : projectUsers.length === 0 ? (
                <div className="text-center text-muted-foreground py-4">
                  No hay usuarios asignados
                </div>
              ) : (
                projectUsers.map((pu) => (
                  <div
                    key={pu.id}
                    className="flex items-center justify-between p-3 bg-muted rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={pu.user_image || undefined} />
                        <AvatarFallback className="bg-primary/20 text-primary text-xs">
                          {getInitials(pu.user_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-sm font-medium">
                          {pu.user_name || pu.user_email}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {pu.user_email}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {editingUserLimit === pu.user_id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min="1"
                            value={editMaxGenerations}
                            onChange={(e) => setEditMaxGenerations(e.target.value)}
                            className="w-16 h-7 bg-card border-border/50 text-xs"
                            autoFocus
                            disabled={editUnlimited}
                          />
                          <label className="flex items-center gap-1 cursor-pointer text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={editUnlimited}
                              onChange={(e) => setEditUnlimited(e.target.checked)}
                              className="w-3 h-3 rounded accent-primary"
                            />
                            ∞
                          </label>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:bg-green-500/10"
                            onClick={() => handleUpdateUserLimit(pu.user_id)}
                            disabled={saving}
                          >
                            <Check className="h-3 w-3 text-green-400" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:bg-accent"
                            onClick={() => {
                              setEditingUserLimit(null);
                              setEditUnlimited(false);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <button
                          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-accent/50 transition-colors"
                          onClick={() => {
                            setEditingUserLimit(pu.user_id);
                            setEditMaxGenerations(pu.max_monthly_generations === 0 ? "10" : pu.max_monthly_generations.toString());
                            setEditUnlimited(pu.max_monthly_generations === 0);
                          }}
                          title="Editar límite"
                        >
                          <Zap className="h-3 w-3 text-yellow-400" />
                          <span className="text-xs text-muted-foreground">
                            {pu.max_monthly_generations === 0 ? "∞" : pu.max_monthly_generations}
                          </span>
                        </button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-red-500/10"
                        onClick={() => handleRemoveUser(pu.user_id)}
                      >
                        <X className="h-4 w-4 text-red-400" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsUsersDialogOpen(false)}
              className="border-border/50"
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog para confirmar eliminación */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle>Eliminar Proyecto</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar{" "}
              <strong className="text-foreground">{deletingProject?.title}</strong>?
              Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              className="border-border/50"
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={saving}
              className="bg-red-500 hover:bg-red-600"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog para gestionar modelos */}
      <Dialog open={isModelsDialogOpen} onOpenChange={setIsModelsDialogOpen}>
        <DialogContent className="bg-card border-border/50 max-w-2xl">
          <DialogHeader>
            <DialogTitle>Modelos del Proyecto</DialogTitle>
            <DialogDescription>
              {selectedProject?.title} - Configura los modelos y sus instrucciones base
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Agregar modelo */}
            <div className="flex gap-2">
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
              <Button
                onClick={handleAddModel}
                disabled={!selectedModelId || saving}
                size="sm"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Lista de modelos */}
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {loadingModels ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : projectModels.length === 0 ? (
                <div className="text-center text-muted-foreground py-4">
                  No hay modelos asignados
                </div>
              ) : (
                projectModels.map((pm) => (
                  <div
                    key={pm.id}
                    className="p-3 bg-muted rounded-lg space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Cpu className="h-5 w-5 text-primary" />
                        <div>
                          <div className="text-sm font-medium flex items-center gap-2">
                            {pm.model_display_name}
                            {Boolean(pm.is_default) && (
                              <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">
                                Default
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {pm.model_model_id}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!pm.is_default && (
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
                          <X className="h-4 w-4 text-red-400" />
                        </Button>
                      </div>
                    </div>

                    {/* System Instruction para este modelo */}
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
                            rows={3}
                            className="w-full bg-card border border-border/50 rounded-lg px-3 py-2 text-sm resize-none"
                            autoFocus
                          />
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingSystemInstruction(null)}
                            >
                              Cancelar
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleSaveSystemInstruction(pm.model_id)}
                              disabled={saving}
                            >
                              {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Save className="h-4 w-4" />
                              )}
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
                          className="w-full text-left p-2 rounded border border-dashed border-border/50 hover:border-primary/50 hover:bg-card transition-colors"
                        >
                          {pm.system_instruction ? (
                            <p className="text-sm text-foreground line-clamp-2">
                              {pm.system_instruction}
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">
                              Click para agregar instrucción base...
                            </p>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsModelsDialogOpen(false)}
              className="border-border/50"
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
