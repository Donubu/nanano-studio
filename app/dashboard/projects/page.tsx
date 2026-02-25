"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
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
import {
  Plus,
  Pencil,
  Loader2,
  Building2,
  Eye,
  EyeOff,
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
  hidden: boolean;
  generation_count: number;
  estimated_cost: number;
  created_at: string;
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
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    client_id: "",
    status: "active",
    hidden: false,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    fetchProjects();
    fetchClients();
  }, [fetchProjects, fetchClients]);

  const openCreateDialog = () => {
    setEditingProject(null);
    setFormData({ title: "", description: "", client_id: "", status: "active", hidden: false });
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
      hidden: !!project.hidden,
    });
    setError("");
    setIsDialogOpen(true);
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
              <TableHead className="text-muted-foreground text-right">Generaciones</TableHead>
              <TableHead className="text-muted-foreground text-right">Costo aprox</TableHead>
              <TableHead className="text-muted-foreground">Fecha</TableHead>
              <TableHead className="w-[100px] text-muted-foreground">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No hay proyectos registrados
                </TableCell>
              </TableRow>
            ) : (
              projects.map((project) => (
                <TableRow key={project.id} className="border-border/50 hover:bg-accent/50">
                  <TableCell>
                    <button
                      onClick={() => router.push(`/dashboard/projects/${project.id}`)}
                      className="text-left hover:text-primary transition-colors"
                    >
                      <div className="font-medium flex items-center gap-1.5">
                        {project.title}
                        {project.hidden && (
                          <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                      {project.description && (
                        <div className="text-sm text-muted-foreground truncate max-w-[300px]">
                          {project.description}
                        </div>
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    {project.client_name ? (
                      <div className="flex items-center gap-2">
                        {project.client_logo ? (
                          <Image
                            src={project.client_logo}
                            alt={project.client_name}
                            width={48}
                            height={48}
                            className="rounded"
                          />
                        ) : (
                          <Building2 className="h-5 w-5 text-muted-foreground" />
                        )}
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
                  <TableCell className="text-right tabular-nums">
                    {project.generation_count > 0 ? (
                      <span className="text-foreground font-medium">{project.generation_count.toLocaleString()}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(project.estimated_cost) > 0 ? (
                      <span className="text-foreground font-medium">${Number(project.estimated_cost).toFixed(2)}</span>
                    ) : (
                      <span className="text-muted-foreground">$0.00</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateLocal(project.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-primary/10"
                        onClick={() => router.push(`/dashboard/projects/${project.id}`)}
                        title="Ver proyecto"
                      >
                        <Eye className="h-4 w-4 text-primary" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-accent"
                        onClick={() => openEditDialog(project)}
                        title="Editar proyecto"
                      >
                        <Pencil className="h-4 w-4" />
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
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="hidden"
                  checked={formData.hidden}
                  onChange={(e) =>
                    setFormData({ ...formData, hidden: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-border/50"
                />
                <label htmlFor="hidden" className="text-sm">
                  <span className="font-medium">Ocultar proyecto</span>
                  <span className="block text-muted-foreground text-xs">
                    No se mostrara a usuarios sin permisos
                  </span>
                </label>
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
    </div>
  );
}
