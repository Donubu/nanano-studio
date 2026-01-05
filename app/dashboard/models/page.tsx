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
import { Plus, Pencil, Trash2, Loader2, Image, AudioLines, Video } from "lucide-react";

interface Model {
  id: number;
  model_id: string;
  display_name: string;
  description: string | null;
  is_active: boolean;
  supports_images: boolean;
  supports_audio: boolean;
  supports_video: boolean;
  max_tokens: number;
  created_at: string;
}

export default function ModelsPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [deletingModel, setDeletingModel] = useState<Model | null>(null);
  const [formData, setFormData] = useState({
    model_id: "",
    display_name: "",
    description: "",
    is_active: true,
    supports_images: false,
    supports_audio: false,
    supports_video: false,
    max_tokens: 8192,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models?active=false");
      if (res.ok) {
        const data = await res.json();
        setModels(data);
      }
    } catch (err) {
      console.error("Error fetching models:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const openCreateDialog = () => {
    setEditingModel(null);
    setFormData({
      model_id: "",
      display_name: "",
      description: "",
      is_active: true,
      supports_images: false,
      supports_audio: false,
      supports_video: false,
      max_tokens: 8192,
    });
    setError("");
    setIsDialogOpen(true);
  };

  const openEditDialog = (model: Model) => {
    setEditingModel(model);
    setFormData({
      model_id: model.model_id,
      display_name: model.display_name,
      description: model.description || "",
      is_active: model.is_active,
      supports_images: model.supports_images,
      supports_audio: model.supports_audio,
      supports_video: model.supports_video,
      max_tokens: model.max_tokens,
    });
    setError("");
    setIsDialogOpen(true);
  };

  const openDeleteDialog = (model: Model) => {
    setDeletingModel(model);
    setIsDeleteDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      const url = editingModel
        ? `/api/models/${editingModel.id}`
        : "/api/models";
      const method = editingModel ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Error al guardar");
        return;
      }

      setIsDialogOpen(false);
      fetchModels();
    } catch (err) {
      console.error("Error:", err);
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingModel) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/models/${deletingModel.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setIsDeleteDialogOpen(false);
        fetchModels();
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

  const toggleActive = async (model: Model) => {
    try {
      await fetch(`/api/models/${model.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !model.is_active }),
      });
      fetchModels();
    } catch (err) {
      console.error("Error:", err);
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
          <h1 className="text-2xl font-bold">Modelos</h1>
          <p className="text-muted-foreground">
            Gestiona los modelos de IA disponibles
          </p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo Modelo
        </Button>
      </div>

      <div className="bg-[#1a1a22] rounded-xl border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="text-muted-foreground">Nombre</TableHead>
              <TableHead className="text-muted-foreground">Model ID</TableHead>
              <TableHead className="text-muted-foreground">Capacidades</TableHead>
              <TableHead className="text-muted-foreground">Max Tokens</TableHead>
              <TableHead className="text-muted-foreground">Estado</TableHead>
              <TableHead className="w-[100px] text-muted-foreground">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No hay modelos registrados
                </TableCell>
              </TableRow>
            ) : (
              models.map((model) => (
                <TableRow key={model.id} className="border-border/50 hover:bg-accent/50">
                  <TableCell>
                    <div>
                      <div className="font-medium">{model.display_name}</div>
                      {model.description && (
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {model.description}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {model.model_id}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {!!model.supports_images && (
                        <span title="Imágenes" className="p-1 rounded bg-blue-500/20">
                          <Image className="h-3 w-3 text-blue-400" />
                        </span>
                      )}
                      {!!model.supports_audio && (
                        <span title="Audio" className="p-1 rounded bg-green-500/20">
                          <AudioLines className="h-3 w-3 text-green-400" />
                        </span>
                      )}
                      {!!model.supports_video && (
                        <span title="Video" className="p-1 rounded bg-purple-500/20">
                          <Video className="h-3 w-3 text-purple-400" />
                        </span>
                      )}
                      {!model.supports_images && !model.supports_audio && !model.supports_video && (
                        <span className="text-xs text-muted-foreground">Solo texto</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {model.max_tokens.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <button onClick={() => toggleActive(model)}>
                      <Badge className={model.is_active ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}>
                        {model.is_active ? "Activo" : "Inactivo"}
                      </Badge>
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-accent"
                        onClick={() => openEditDialog(model)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-red-500/10"
                        onClick={() => openDeleteDialog(model)}
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
        <DialogContent className="bg-[#1a1a22] border-border/50">
          <DialogHeader>
            <DialogTitle>
              {editingModel ? "Editar Modelo" : "Nuevo Modelo"}
            </DialogTitle>
            <DialogDescription>
              {editingModel
                ? "Modifica los datos del modelo"
                : "Configura un nuevo modelo de IA"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              {error && (
                <div className="bg-red-500/10 text-red-400 p-3 rounded-lg text-sm border border-red-500/20">
                  {error}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Model ID *</label>
                  <Input
                    type="text"
                    placeholder="models/gemini-2.5-flash"
                    value={formData.model_id}
                    onChange={(e) =>
                      setFormData({ ...formData, model_id: e.target.value })
                    }
                    required
                    className="bg-[#24242e] border-border/50 font-mono text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nombre *</label>
                  <Input
                    type="text"
                    placeholder="Nano Banana Pro"
                    value={formData.display_name}
                    onChange={(e) =>
                      setFormData({ ...formData, display_name: e.target.value })
                    }
                    required
                    className="bg-[#24242e] border-border/50"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Descripción</label>
                <textarea
                  placeholder="Descripción del modelo (opcional)"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={2}
                  className="w-full bg-[#24242e] border border-border/50 rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Max Output Tokens</label>
                <Input
                  type="number"
                  min="1"
                  value={formData.max_tokens}
                  onChange={(e) =>
                    setFormData({ ...formData, max_tokens: parseInt(e.target.value) || 8192 })
                  }
                  className="bg-[#24242e] border-border/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Capacidades</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.supports_images}
                      onChange={(e) =>
                        setFormData({ ...formData, supports_images: e.target.checked })
                      }
                      className="w-4 h-4 rounded accent-primary"
                    />
                    <Image className="h-4 w-4 text-blue-400" />
                    <span className="text-sm">Imágenes</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.supports_audio}
                      onChange={(e) =>
                        setFormData({ ...formData, supports_audio: e.target.checked })
                      }
                      className="w-4 h-4 rounded accent-primary"
                    />
                    <AudioLines className="h-4 w-4 text-green-400" />
                    <span className="text-sm">Audio</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.supports_video}
                      onChange={(e) =>
                        setFormData({ ...formData, supports_video: e.target.checked })
                      }
                      className="w-4 h-4 rounded accent-primary"
                    />
                    <Video className="h-4 w-4 text-purple-400" />
                    <span className="text-sm">Video</span>
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) =>
                    setFormData({ ...formData, is_active: e.target.checked })
                  }
                  className="w-4 h-4 rounded accent-primary"
                />
                <span className="text-sm">Modelo activo</span>
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
                {editingModel ? "Guardar" : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog para confirmar eliminación */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="bg-[#1a1a22] border-border/50">
          <DialogHeader>
            <DialogTitle>Eliminar Modelo</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar{" "}
              <strong className="text-foreground">{deletingModel?.display_name}</strong>?
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
    </div>
  );
}
