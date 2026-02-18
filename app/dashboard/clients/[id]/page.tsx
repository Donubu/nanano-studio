"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, Building2, X, UserPlus } from "lucide-react";
import Image from "next/image";
import { formatDateLocal } from "@/lib/utils";

interface ClientDetail {
  id: number;
  name: string;
  logo: string | null;
  created_at: string;
}

interface AssignedUser {
  id: number;
  name: string | null;
  email: string;
  image: string | null;
  assigned_at: string;
}

interface User {
  id: number;
  name: string | null;
  email: string;
  image: string | null;
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.id as string;

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [assignedUsers, setAssignedUsers] = useState<AssignedUser[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  const fetchClient = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setClient(data);
      } else if (res.status === 404) {
        router.push("/dashboard/clients");
      }
    } catch (err) {
      console.error("Error fetching client:", err);
    } finally {
      setLoading(false);
    }
  }, [clientId, router]);

  const fetchClientUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const [usersRes, allUsersRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/users`),
        fetch("/api/users"),
      ]);

      if (usersRes.ok) {
        const data = await usersRes.json();
        setAssignedUsers(data);
      }
      if (allUsersRes.ok) {
        const data = await allUsersRes.json();
        setAllUsers(data);
      }
    } catch (err) {
      console.error("Error fetching client users:", err);
    } finally {
      setLoadingUsers(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchClient();
    fetchClientUsers();
  }, [fetchClient, fetchClientUsers]);

  const handleAddUser = async () => {
    if (!selectedUserId) return;
    setAddingUser(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [Number(selectedUserId)] }),
      });
      if (res.ok) {
        setSelectedUserId("");
        fetchClientUsers();
      }
    } catch (err) {
      console.error("Error adding user:", err);
    } finally {
      setAddingUser(false);
    }
  };

  const handleRemoveUser = async (userId: number) => {
    setRemovingUserId(userId);
    try {
      const res = await fetch(`/api/clients/${clientId}/users`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        fetchClientUsers();
      }
    } catch (err) {
      console.error("Error removing user:", err);
    } finally {
      setRemovingUserId(null);
    }
  };

  const availableUsers = allUsers.filter(
    (u) => !assignedUsers.some((au) => au.id === u.id)
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Cliente no encontrado</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/dashboard/clients")}
          className="mt-1"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-3">
          {client.logo ? (
            <Image
              src={client.logo}
              alt={client.name}
              width={48}
              height={48}
              className="rounded-lg object-cover"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-accent flex items-center justify-center">
              <Building2 className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold">{client.name}</h1>
            <p className="text-sm text-muted-foreground">
              Registrado el {formatDateLocal(client.created_at)}
            </p>
          </div>
        </div>
      </div>

      {/* Usuarios asignados */}
      <div className="bg-card rounded-xl border border-border/50 p-6">
        <h3 className="text-sm font-medium mb-4">Usuarios asignados</h3>

        {loadingUsers ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : assignedUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No hay usuarios asignados a este cliente
          </p>
        ) : (
          <div className="space-y-2 mb-4">
            {assignedUsers.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  {user.image ? (
                    <img
                      src={user.image}
                      alt={user.name || user.email}
                      width={28}
                      height={28}
                      className="rounded-full"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-xs font-medium">
                      {(user.name || user.email).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium leading-none">
                      {user.name || user.email}
                    </p>
                    {user.name && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {user.email}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:bg-red-500/10"
                  onClick={() => handleRemoveUser(user.id)}
                  disabled={removingUserId === user.id}
                >
                  {removingUserId === user.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-red-400" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add user */}
        {!loadingUsers && (
          <div className="flex items-center gap-2">
            <Select value={selectedUserId} onValueChange={setSelectedUserId} disabled={availableUsers.length === 0}>
              <SelectTrigger className="flex-1 bg-muted border-border/50">
                <SelectValue placeholder={availableUsers.length === 0 ? "No hay más usuarios disponibles" : "Seleccionar usuario..."} />
              </SelectTrigger>
              <SelectContent>
                {availableUsers.map((user) => (
                  <SelectItem key={user.id} value={String(user.id)}>
                    {user.name || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleAddUser}
              disabled={!selectedUserId || addingUser}
              className="gap-1"
            >
              {addingUser ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Agregar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
