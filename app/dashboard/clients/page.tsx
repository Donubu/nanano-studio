"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
import { Plus, Pencil, Trash2, Loader2, Upload, Building2, Eye, EyeOff, Star, Home } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Image from "next/image";
import { formatDateLocal } from "@/lib/utils";

interface Client {
  id: number;
  name: string;
  logo: string | null;
  hidden: boolean;
  is_internal: boolean;
  default_project_id: number | null;
  created_at: string;
  project_count: number;
}

interface ProjectOption {
  id: number;
  title: string;
}

export default function ClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [formData, setFormData] = useState({ name: "", logo: "", hidden: false, is_internal: false, default_project_id: null as number | null });
  const [clientProjects, setClientProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const data = await res.json();
        setClients(data);
      }
    } catch (err) {
      console.error("Error fetching clients:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const fetchClientProjects = useCallback(async (clientId: number) => {
    try {
      const res = await fetch(`/api/projects?client_id=${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setClientProjects(data.map((p: { id: number; title: string }) => ({ id: p.id, title: p.title })));
      }
    } catch (err) {
      console.error("Error fetching projects:", err);
    }
  }, []);

  const openCreateDialog = () => {
    setEditingClient(null);
    setFormData({ name: "", logo: "", hidden: false, is_internal: false, default_project_id: null });
    setClientProjects([]);
    setError("");
    setIsDialogOpen(true);
  };

  const openEditDialog = (e: React.MouseEvent, client: Client) => {
    e.stopPropagation();
    setEditingClient(client);
    setFormData({ name: client.name, logo: client.logo || "", hidden: !!client.hidden, is_internal: !!client.is_internal, default_project_id: client.default_project_id });
    setError("");
    fetchClientProjects(client.id);
    setIsDialogOpen(true);
  };

  const openDeleteDialog = (e: React.MouseEvent, client: Client) => {
    e.stopPropagation();
    setDeletingClient(client);
    setIsDeleteDialogOpen(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("folder", "logos");

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setFormData((prev) => ({ ...prev, logo: data.url }));
      } else {
        setError("Error al subir imagen");
      }
    } catch (err) {
      console.error("Upload error:", err);
      setError("Error al subir imagen");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      const url = editingClient
        ? `/api/clients/${editingClient.id}`
        : "/api/clients";
      const method = editingClient ? "PUT" : "POST";

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
      fetchClients();
    } catch (err) {
      console.error("Error:", err);
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingClient) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/clients/${deletingClient.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setIsDeleteDialogOpen(false);
        fetchClients();
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
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-muted-foreground">
            Gestiona los clientes de tus proyectos
          </p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="h-4 w-4" />
          Agregar Cliente
        </Button>
      </div>

      <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="text-muted-foreground w-[80px]">Logo</TableHead>
              <TableHead className="text-muted-foreground">Nombre</TableHead>
              <TableHead className="text-muted-foreground text-center">Proyectos</TableHead>
              <TableHead className="text-muted-foreground">Fecha de registro</TableHead>
              <TableHead className="w-[100px] text-muted-foreground">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No hay clientes registrados
                </TableCell>
              </TableRow>
            ) : (
              clients.map((client) => (
                <TableRow
                  key={client.id}
                  className="border-border/50 hover:bg-accent/50"
                >
                  <TableCell>
                    {client.logo ? (
                      <Image
                        src={client.logo}
                        alt={client.name}
                        width={40}
                        height={40}
                        className="rounded-lg object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {client.name}
                      {!!client.is_internal && (
                        <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400 gap-1">
                          <Home className="h-3 w-3" />
                          Interno
                        </Badge>
                      )}
                      {!!client.hidden && (
                        <span title="Oculto"><EyeOff className="h-4 w-4 text-orange-400" /></span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">{client.project_count}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateLocal(client.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-accent"
                        onClick={() => router.push(`/dashboard/clients/${client.id}`)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-accent"
                        onClick={(e) => openEditDialog(e, client)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-red-500/10"
                        onClick={(e) => openDeleteDialog(e, client)}
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
              {editingClient ? "Editar Cliente" : "Agregar Cliente"}
            </DialogTitle>
            <DialogDescription>
              {editingClient
                ? "Modifica los datos del cliente"
                : "Ingresa los datos del nuevo cliente"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              {error && (
                <div className="bg-red-500/10 text-red-400 p-3 rounded-lg text-sm border border-red-500/20">
                  {error}
                </div>
              )}

              {/* Logo upload */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Logo</label>
                <div className="flex items-center gap-4">
                  {formData.logo ? (
                    <Image
                      src={formData.logo}
                      alt="Logo preview"
                      width={64}
                      height={64}
                      className="rounded-lg object-cover"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
                      <Building2 className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept="image/*"
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="border-border/50"
                    >
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      Subir imagen
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Nombre *</label>
                <Input
                  type="text"
                  placeholder="Nombre del cliente"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                  className="bg-muted border-border/50"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="client-hidden"
                  checked={formData.hidden}
                  onChange={(e) =>
                    setFormData({ ...formData, hidden: e.target.checked })
                  }
                  className="rounded border-border/50"
                />
                <label htmlFor="client-hidden" className="text-sm font-medium flex items-center gap-1.5">
                  <EyeOff className="h-3.5 w-3.5 text-orange-400" />
                  Oculto
                </label>
                <span className="text-xs text-muted-foreground">
                  (Solo visible para administradores)
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="client-internal"
                  checked={formData.is_internal}
                  onChange={(e) =>
                    setFormData({ ...formData, is_internal: e.target.checked })
                  }
                  className="rounded border-border/50"
                />
                <label htmlFor="client-internal" className="text-sm font-medium flex items-center gap-1.5">
                  <Home className="h-3.5 w-3.5 text-blue-400" />
                  Cliente Interno
                </label>
                <span className="text-xs text-muted-foreground">
                  (Espacios personales de usuarios se crean aqui)
                </span>
              </div>

              {editingClient && clientProjects.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Star className="h-3.5 w-3.5 text-yellow-500" />
                    Proyecto día a día
                  </label>
                  <select
                    className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                    value={formData.default_project_id ?? ""}
                    onChange={(e) =>
                      setFormData({ ...formData, default_project_id: e.target.value ? Number(e.target.value) : null })
                    }
                  >
                    <option value="">Ninguno</option>
                    {clientProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Aparecerá destacado y primero en la lista de proyectos
                  </p>
                </div>
              )}
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
                {editingClient ? "Guardar" : "Agregar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog para confirmar eliminación */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle>Eliminar Cliente</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar a{" "}
              <strong className="text-foreground">{deletingClient?.name}</strong>?
              Los proyectos asociados quedarán sin cliente.
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
