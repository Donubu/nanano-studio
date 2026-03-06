"use client";

import { useEffect, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Sparkles,
  Eye,
  AlertTriangle,
  Bold,
  Italic,
  List,
  Code,
  Undo,
  Redo,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Changelog {
  id: number;
  version: string;
  title: string;
  content: string;
  image_url: string | null;
  published_at: string;
  seen_count: number;
}

function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;

  return (
    <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 flex-wrap">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", editor.isActive("bold") && "bg-accent")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Negrita"
      >
        <Bold className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", editor.isActive("italic") && "bg-accent")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Cursiva"
      >
        <Italic className="h-3.5 w-3.5" />
      </Button>
      <div className="w-px h-5 bg-border mx-1" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("h-7 w-7", editor.isActive("bulletList") && "bg-accent")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Lista"
      >
        <List className="h-3.5 w-3.5" />
      </Button>
      <div className="w-px h-5 bg-border mx-1" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Deshacer"
      >
        <Undo className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Rehacer"
      >
        <Redo className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export default function ChangelogPage() {
  const [changelogs, setChangelogs] = useState<Changelog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Changelog | null>(null);
  const [deletingItem, setDeletingItem] = useState<Changelog | null>(null);
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [htmlMode, setHtmlMode] = useState(false);
  const [htmlSource, setHtmlSource] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit],
    content: "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm prose-invert max-w-none px-3 py-2 min-h-[160px] focus:outline-none [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_li]:text-sm [&_p]:text-sm",
      },
    },
  });

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/changelog");
      if (res.ok) {
        const json = await res.json();
        setChangelogs(json.changelogs);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setEditingItem(null);
    setVersion(process.env.NEXT_PUBLIC_APP_VERSION || "1.0.0");
    setTitle("");
    setHtmlMode(false);
    setHtmlSource("");
    editor?.commands.setContent("");
    setError("");
    setIsDialogOpen(true);
  };

  const openEdit = (item: Changelog) => {
    setEditingItem(item);
    setVersion(item.version);
    setTitle(item.title);
    setHtmlMode(false);
    setHtmlSource(item.content);
    editor?.commands.setContent(item.content);
    setError("");
    setIsDialogOpen(true);
  };

  const openDelete = (item: Changelog) => {
    setDeletingItem(item);
    setIsDeleteDialogOpen(true);
  };

  const toggleHtmlMode = () => {
    if (htmlMode) {
      // Switching from HTML to WYSIWYG
      editor?.commands.setContent(htmlSource);
    } else {
      // Switching from WYSIWYG to HTML
      setHtmlSource(editor?.getHTML() || "");
    }
    setHtmlMode(!htmlMode);
  };

  const getContent = () => {
    if (htmlMode) return htmlSource;
    return editor?.getHTML() || "";
  };

  const handleSave = async () => {
    const content = getContent();
    if (!version || !title || !content || content === "<p></p>") {
      setError("Version, titulo y contenido son requeridos");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const url = editingItem
        ? `/api/changelog/${editingItem.id}`
        : "/api/changelog";
      const method = editingItem ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, title, content }),
      });

      if (!res.ok) {
        const json = await res.json();
        setError(json.error || "Error al guardar");
        return;
      }

      setIsDialogOpen(false);
      fetchData();
    } catch {
      setError("Error de conexion");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingItem) return;

    try {
      await fetch(`/api/changelog/${deletingItem.id}`, { method: "DELETE" });
      setIsDeleteDialogOpen(false);
      fetchData();
    } catch {
      // silent
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("es-CL", {
      timeZone: "America/Santiago",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Changelog</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Administra las novedades que se muestran a los usuarios
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Nueva entrada
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Entradas publicadas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {changelogs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No hay entradas de changelog
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Version</TableHead>
                  <TableHead>Titulo</TableHead>
                  <TableHead className="w-[80px]">Vistos</TableHead>
                  <TableHead className="w-[160px]">Fecha</TableHead>
                  <TableHead className="w-[120px]">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changelogs.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Badge variant="outline">v{item.version}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{item.title}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Eye className="h-3 w-3" />
                        {item.seen_count}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(item.published_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditingItem(item);
                            setIsPreviewOpen(true);
                          }}
                          title="Vista previa"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(item)}
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openDelete(item)}
                          title="Eliminar"
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? "Editar entrada" : "Nueva entrada"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-[100px_1fr] gap-4">
              <div className="space-y-2">
                <Label>Version</Label>
                <Input
                  placeholder="3.4.0"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Titulo</Label>
                <Input
                  placeholder="Novedades de Puerto.studio"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Contenido</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs gap-1"
                  onClick={toggleHtmlMode}
                >
                  <Code className="h-3 w-3" />
                  {htmlMode ? "Editor visual" : "HTML"}
                </Button>
              </div>

              {htmlMode ? (
                <Textarea
                  value={htmlSource}
                  onChange={(e) => setHtmlSource(e.target.value)}
                  rows={10}
                  className="font-mono text-xs"
                  placeholder="<ul><li><strong>Feature</strong> — Descripcion</li></ul>"
                />
              ) : (
                <div className="border border-input rounded-md overflow-hidden">
                  <EditorToolbar editor={editor} />
                  <EditorContent editor={editor} />
                </div>
              )}
            </div>

            {error && (
              <p className="text-sm text-red-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingItem ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar entrada</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Esto eliminara la entrada v{deletingItem?.version} y el registro de
            usuarios que la vieron. Esta accion no se puede deshacer.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-yellow-500" />
              <span>{editingItem?.title}</span>
              <span className="text-xs font-normal text-muted-foreground">
                v{editingItem?.version}
              </span>
            </DialogTitle>
          </DialogHeader>
          {editingItem && (
            <>
              <div
                className="[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_li]:text-sm [&_li]:text-muted-foreground [&_strong]:text-foreground [&_strong]:font-medium [&_p]:text-sm [&_p]:text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: editingItem.content }}
              />
              {editingItem.image_url && (
                <div className="relative w-full aspect-video overflow-hidden rounded-md">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={editingItem.image_url}
                    alt={editingItem.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
            </>
          )}
          <DialogFooter>
            <Button onClick={() => setIsPreviewOpen(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
