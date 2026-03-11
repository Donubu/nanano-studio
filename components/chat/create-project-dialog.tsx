"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Plus, Loader2 } from "lucide-react";

interface Client {
  id: number;
  name: string;
}

interface Template {
  id: number;
  name: string;
  description: string | null;
}

interface CreateProjectDialogProps {
  onProjectCreated: () => void;
}

export function CreateProjectDialog({ onProjectCreated }: CreateProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    client_id: "",
    template_id: "",
  });

  useEffect(() => {
    if (!open) return;
    // Fetch clients and templates when dialog opens
    fetch("/api/clients").then(r => r.json()).then(setClients).catch(() => {});
    fetch("/api/admin/templates").then(r => r.json()).then((data) => {
      if (Array.isArray(data)) setTemplates(data);
    }).catch(() => {});
  }, [open]);

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      setError("El título es requerido");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || null,
          client_id: form.client_id ? Number(form.client_id) : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Error al crear proyecto");
        return;
      }

      const project = await res.json();

      // Apply template if selected
      if (form.template_id) {
        try {
          await fetch(`/api/admin/templates/${form.template_id}/apply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: project.id }),
          });
        } catch (err) {
          console.error("Error applying template:", err);
        }
      }

      setOpen(false);
      setForm({ title: "", description: "", client_id: "", template_id: "" });
      onProjectCreated();
    } catch {
      setError("Error al crear proyecto");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(""); }}>
      <DialogTrigger asChild>
        <button
          className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Crear proyecto"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Nuevo Proyecto</DialogTitle>
          <DialogDescription>
            Crea un nuevo proyecto y asígnalo a un cliente.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Título *</label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Nombre del proyecto"
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Descripción</label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Descripción opcional"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Cliente</label>
            <select
              className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
              value={form.client_id}
              onChange={(e) => setForm({ ...form, client_id: e.target.value })}
            >
              <option value="">Sin cliente</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          {templates.length > 0 && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">Template</label>
              <select
                className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                value={form.template_id}
                onChange={(e) => setForm({ ...form, template_id: e.target.value })}
              >
                <option value="">Sin template</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.description ? ` — ${t.description}` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Aplica una configuración predefinida de tipos y modelos.
              </p>
            </div>
          )}
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Crear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
