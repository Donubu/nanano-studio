"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Copy,
  LayoutTemplate,
  ImageIcon,
  Video,
  Music,
  MessageSquare,
  Mic,
} from "lucide-react";
import { formatDateLocal } from "@/lib/utils";

interface TemplateModel {
  model_id: number;
  label: string;
  sort_order: number;
  is_default: boolean;
}

interface TypeConfig {
  enabled: boolean;
  models: TemplateModel[];
}

interface TemplateConfig {
  text: TypeConfig;
  image: TypeConfig;
  video: TypeConfig;
  audio: TypeConfig;
  music: TypeConfig;
}

interface Template {
  id: number;
  name: string;
  description: string | null;
  config: TemplateConfig;
  created_at: string;
  updated_at: string;
}

interface Project {
  id: number;
  title: string;
}

const typeIcons: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  text: { icon: <MessageSquare className="h-3.5 w-3.5" />, label: "Texto", color: "text-blue-400" },
  image: { icon: <ImageIcon className="h-3.5 w-3.5" />, label: "Imagen", color: "text-purple-400" },
  video: { icon: <Video className="h-3.5 w-3.5" />, label: "Video", color: "text-orange-400" },
  audio: { icon: <Mic className="h-3.5 w-3.5" />, label: "Audio", color: "text-green-400" },
  music: { icon: <Music className="h-3.5 w-3.5" />, label: "Música", color: "text-teal-400" },
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Create/edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "", from_project_id: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/templates");
      if (res.ok) setTemplates(await res.json());
    } catch (err) {
      console.error("Error fetching templates:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data.map((p: Project) => ({ id: p.id, title: p.title })));
      }
    } catch (err) {
      console.error("Error fetching projects:", err);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
    fetchProjects();
  }, [fetchTemplates, fetchProjects]);

  const openCreate = () => {
    setEditingTemplate(null);
    setFormData({ name: "", description: "", from_project_id: "" });
    setError("");
    setDialogOpen(true);
  };

  const openEdit = (template: Template) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      description: template.description || "",
      from_project_id: "",
    });
    setError("");
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      if (editingTemplate) {
        // Update
        const res = await fetch(`/api/admin/templates/${editingTemplate.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formData.name, description: formData.description || null }),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Error al guardar");
          return;
        }
      } else {
        // Create
        if (!formData.from_project_id) {
          setError("Selecciona un proyecto base para crear el template");
          return;
        }
        const res = await fetch("/api/admin/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.name,
            description: formData.description || null,
            from_project_id: parseInt(formData.from_project_id),
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Error al crear");
          return;
        }
      }

      setDialogOpen(false);
      fetchTemplates();
    } catch {
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingTemplate) return;
    setDeleting(true);

    try {
      const res = await fetch(`/api/admin/templates/${deletingTemplate.id}`, { method: "DELETE" });
      if (res.ok) {
        setDeleteDialogOpen(false);
        setDeletingTemplate(null);
        fetchTemplates();
      }
    } catch (err) {
      console.error("Error deleting template:", err);
    } finally {
      setDeleting(false);
    }
  };

  const getEnabledTypes = (config: TemplateConfig) => {
    return (Object.keys(config) as Array<keyof TemplateConfig>)
      .filter((type) => config[type].enabled);
  };

  const getModelCount = (config: TemplateConfig) => {
    return (Object.keys(config) as Array<keyof TemplateConfig>)
      .reduce((sum, type) => sum + config[type].models.length, 0);
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
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LayoutTemplate className="h-6 w-6 text-primary" />
            Templates de Proyecto
          </h1>
          <p className="text-muted-foreground">
            Configuraciones reutilizables para crear proyectos rapidamente
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo Template
        </Button>
      </div>

      <Card className="bg-card border-border/50">
        <CardContent className="p-0">
          {templates.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 bg-muted/30">
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipos habilitados</TableHead>
                  <TableHead className="text-center">Modelos</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="w-[120px]">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template) => {
                  const enabledTypes = getEnabledTypes(template.config);
                  return (
                    <TableRow key={template.id} className="border-border/30">
                      <TableCell>
                        <div className="font-medium">{template.name}</div>
                        {template.description && (
                          <div className="text-xs text-muted-foreground truncate max-w-[250px]">
                            {template.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {enabledTypes.map((type) => {
                            const info = typeIcons[type];
                            const modelCount = template.config[type].models.length;
                            return (
                              <Badge
                                key={type}
                                variant="outline"
                                className={`gap-1 text-xs ${info.color} border-current/20`}
                              >
                                {info.icon}
                                {info.label}
                                <span className="opacity-60">({modelCount})</span>
                              </Badge>
                            );
                          })}
                          {enabledTypes.length === 0 && (
                            <span className="text-xs text-muted-foreground italic">Sin tipos habilitados</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm font-medium">{getModelCount(template.config)}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDateLocal(template.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(template)}
                            title="Editar nombre/descripción"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-400 hover:text-red-400"
                            onClick={() => {
                              setDeletingTemplate(template);
                              setDeleteDialogOpen(true);
                            }}
                            title="Eliminar template"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center p-8">
              <LayoutTemplate className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium mb-2">Sin templates</h3>
              <p className="text-muted-foreground text-sm max-w-md mb-4">
                Crea un template desde un proyecto existente para reutilizar su configuración.
              </p>
              <Button onClick={openCreate} className="gap-2">
                <Plus className="h-4 w-4" />
                Crear primer template
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? "Editar Template" : "Nuevo Template"}
            </DialogTitle>
            <DialogDescription>
              {editingTemplate
                ? "Modifica el nombre y descripción del template"
                : "Crea un template a partir de la configuración de un proyecto existente"}
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
                <label className="text-sm font-medium">Nombre *</label>
                <Input
                  placeholder="Ej: Proyecto estándar, Solo imágenes..."
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="bg-muted border-border/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Descripción</label>
                <textarea
                  placeholder="Descripción opcional"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
              {!editingTemplate && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Proyecto base *</label>
                  <select
                    className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                    value={formData.from_project_id}
                    onChange={(e) => setFormData({ ...formData, from_project_id: e.target.value })}
                    required
                  >
                    <option value="">Seleccionar proyecto...</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Se copiará la configuración de tipos de generación y modelos de este proyecto.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingTemplate ? "Guardar" : "Crear Template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle>Eliminar template</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de eliminar &ldquo;{deletingTemplate?.name}&rdquo;? Esta acción no se puede deshacer.
              Los proyectos que ya usaron este template no se verán afectados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
