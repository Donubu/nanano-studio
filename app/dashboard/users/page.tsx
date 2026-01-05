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
import { Plus, Pencil, Trash2, Loader2, Eye, Ban, RotateCcw, Zap, FolderOpen } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface User {
  id: number;
  email: string;
  name: string | null;
  image: string | null;
  role: string;
  blocked_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

interface ProjectAssignment {
  id: number;
  project_id: number;
  project_title: string;
  client_name: string | null;
  role: string;
  max_monthly_generations: number;
}

interface UserDetail extends User {
  projects: ProjectAssignment[];
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUser, setDeletingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    role: "user",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      console.error("Error fetching users:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const openCreateDialog = () => {
    setEditingUser(null);
    setFormData({ email: "", name: "", role: "user" });
    setError("");
    setIsDialogOpen(true);
  };

  const openEditDialog = (user: User) => {
    setEditingUser(user);
    setFormData({
      email: user.email,
      name: user.name || "",
      role: user.role,
    });
    setError("");
    setIsDialogOpen(true);
  };

  const openDeleteDialog = (user: User) => {
    setDeletingUser(user);
    setIsDeleteDialogOpen(true);
  };

  const openDetailDialog = async (user: User) => {
    setLoadingDetail(true);
    setIsDetailDialogOpen(true);

    try {
      const res = await fetch(`/api/users/${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedUser(data);
      }
    } catch (err) {
      console.error("Error fetching user:", err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleBlockToggle = async (user: User) => {
    const action = user.blocked_at ? "unblock" : "block";

    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (res.ok) {
        fetchUsers();
        if (selectedUser?.id === user.id) {
          setSelectedUser({
            ...selectedUser,
            blocked_at: action === "block" ? new Date().toISOString() : null,
          });
        }
      }
    } catch (err) {
      console.error("Error:", err);
    }
  };

  const handleRestore = async (user: User) => {
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });

      if (res.ok) {
        fetchUsers();
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      const url = editingUser ? `/api/users/${editingUser.id}` : "/api/users";
      const method = editingUser ? "PUT" : "POST";

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
      fetchUsers();
    } catch (err) {
      console.error("Error:", err);
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingUser) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/users/${deletingUser.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setIsDeleteDialogOpen(false);
        fetchUsers();
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
          <h1 className="text-2xl font-bold">Usuarios</h1>
          <p className="text-muted-foreground">
            Gestiona los emails autorizados para iniciar sesión
          </p>
        </div>
        <Button onClick={openCreateDialog} className="gap-2">
          <Plus className="h-4 w-4" />
          Agregar Usuario
        </Button>
      </div>

      <div className="bg-[#1a1a22] rounded-xl border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="text-muted-foreground">Usuario</TableHead>
              <TableHead className="text-muted-foreground">Rol</TableHead>
              <TableHead className="text-muted-foreground">Estado</TableHead>
              <TableHead className="text-muted-foreground">Fecha de registro</TableHead>
              <TableHead className="w-[160px] text-muted-foreground">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No hay usuarios registrados
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow
                  key={user.id}
                  className={`border-border/50 hover:bg-accent/50 ${user.deleted_at ? "opacity-50" : ""}`}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={user.image || undefined} />
                        <AvatarFallback className="bg-primary/20 text-primary text-xs">
                          {getInitials(user.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{user.email}</div>
                        {user.name && (
                          <div className="text-xs text-muted-foreground">{user.name}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={user.role === "admin" ? "default" : "secondary"}
                      className={user.role === "admin" ? "bg-primary/20 text-primary hover:bg-primary/30" : ""}
                    >
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {user.deleted_at && (
                        <Badge className="bg-red-500/20 text-red-400">Eliminado</Badge>
                      )}
                      {user.blocked_at && !user.deleted_at && (
                        <Badge className="bg-yellow-500/20 text-yellow-400">Bloqueado</Badge>
                      )}
                      {!user.blocked_at && !user.deleted_at && (
                        <Badge className="bg-green-500/20 text-green-400">Activo</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(user.created_at).toLocaleDateString("es-CL")}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-accent"
                        onClick={() => openDetailDialog(user)}
                        title="Ver detalles"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {!user.deleted_at && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-accent"
                            onClick={() => openEditDialog(user)}
                            title="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={`h-8 w-8 ${user.blocked_at ? "hover:bg-green-500/10" : "hover:bg-yellow-500/10"}`}
                            onClick={() => handleBlockToggle(user)}
                            title={user.blocked_at ? "Desbloquear" : "Bloquear"}
                          >
                            {user.blocked_at ? (
                              <RotateCcw className="h-4 w-4 text-green-400" />
                            ) : (
                              <Ban className="h-4 w-4 text-yellow-400" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-red-500/10"
                            onClick={() => openDeleteDialog(user)}
                            title="Eliminar"
                          >
                            <Trash2 className="h-4 w-4 text-red-400" />
                          </Button>
                        </>
                      )}
                      {user.deleted_at && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-green-500/10"
                          onClick={() => handleRestore(user)}
                          title="Restaurar"
                        >
                          <RotateCcw className="h-4 w-4 text-green-400" />
                        </Button>
                      )}
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
              {editingUser ? "Editar Usuario" : "Agregar Usuario"}
            </DialogTitle>
            <DialogDescription>
              {editingUser
                ? "Modifica los datos del usuario"
                : "Ingresa el email autorizado para iniciar sesión"}
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
                <label className="text-sm font-medium">Email *</label>
                <Input
                  type="email"
                  placeholder="usuario@ejemplo.com"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  required
                  className="bg-[#24242e] border-border/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Nombre</label>
                <Input
                  type="text"
                  placeholder="Nombre completo (opcional)"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  className="bg-[#24242e] border-border/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Rol</label>
                <select
                  className="w-full bg-[#24242e] border border-border/50 rounded-lg px-3 py-2 text-sm"
                  value={formData.role}
                  onChange={(e) =>
                    setFormData({ ...formData, role: e.target.value })
                  }
                >
                  <option value="user">Usuario</option>
                  <option value="admin">Administrador</option>
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
                {editingUser ? "Guardar" : "Agregar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog para confirmar eliminación */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="bg-[#1a1a22] border-border/50">
          <DialogHeader>
            <DialogTitle>Eliminar Usuario</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar a{" "}
              <strong className="text-foreground">{deletingUser?.email}</strong>? Esta acción no se puede
              deshacer.
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

      {/* Dialog para ver detalles del usuario */}
      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="bg-[#1a1a22] border-border/50 max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalle del Usuario</DialogTitle>
          </DialogHeader>

          {loadingDetail ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : selectedUser ? (
            <div className="space-y-6 py-4">
              {/* Info del usuario */}
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={selectedUser.image || undefined} />
                  <AvatarFallback className="bg-primary/20 text-primary text-lg">
                    {getInitials(selectedUser.name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="text-lg font-semibold">{selectedUser.name || "Sin nombre"}</div>
                  <div className="text-sm text-muted-foreground">{selectedUser.email}</div>
                  <div className="flex gap-2 mt-1">
                    <Badge
                      variant={selectedUser.role === "admin" ? "default" : "secondary"}
                      className={selectedUser.role === "admin" ? "bg-primary/20 text-primary" : ""}
                    >
                      {selectedUser.role}
                    </Badge>
                    {selectedUser.deleted_at && (
                      <Badge className="bg-red-500/20 text-red-400">Eliminado</Badge>
                    )}
                    {selectedUser.blocked_at && !selectedUser.deleted_at && (
                      <Badge className="bg-yellow-500/20 text-yellow-400">Bloqueado</Badge>
                    )}
                    {!selectedUser.blocked_at && !selectedUser.deleted_at && (
                      <Badge className="bg-green-500/20 text-green-400">Activo</Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Proyectos asociados */}
              <div>
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <FolderOpen className="h-4 w-4 text-primary" />
                  Proyectos Asociados
                </h4>
                {selectedUser.projects.length === 0 ? (
                  <div className="text-sm text-muted-foreground bg-[#24242e] rounded-lg p-4 text-center">
                    No está asignado a ningún proyecto
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {selectedUser.projects.map((project) => (
                      <div
                        key={project.id}
                        className="flex items-center justify-between p-3 bg-[#24242e] rounded-lg"
                      >
                        <div>
                          <div className="text-sm font-medium">{project.project_title}</div>
                          {project.client_name && (
                            <div className="text-xs text-muted-foreground">{project.client_name}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 px-2 py-1 bg-[#1a1a22] rounded">
                            <Zap className="h-3 w-3 text-yellow-400" />
                            <span className="text-xs">
                              {project.max_monthly_generations === 0 ? "∞" : project.max_monthly_generations}
                            </span>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {project.role}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Información adicional */}
              <div className="text-xs text-muted-foreground border-t border-border/50 pt-4">
                Registrado el {new Date(selectedUser.created_at).toLocaleDateString("es-CL", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDetailDialogOpen(false)}
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
