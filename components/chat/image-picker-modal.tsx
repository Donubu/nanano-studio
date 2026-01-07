"use client";

import { useState, useEffect, useRef } from "react";
import { X, Loader2, Upload, Image as ImageIcon, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

type ReferenceType = "ASSET" | "STYLE";

interface Generation {
  id: number;
  image_url: string;
  created_at: string;
  source?: "generated" | "uploaded";
}

interface ImagePickerModalProps {
  projectId: number;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (imageUrl: string, referenceType?: ReferenceType) => void;
  title: string;
  showReferenceTypeSelector?: boolean;
}

export function ImagePickerModal({
  projectId,
  isOpen,
  onClose,
  onSelect,
  title,
  showReferenceTypeSelector = false,
}: ImagePickerModalProps) {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<ReferenceType>("ASSET");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if selected image is a new upload (base64) vs from gallery (URL)
  const isNewUpload = selectedImage?.startsWith("data:");

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedImage(null);
      setUploadedFileName(null);
      setSelectedType("ASSET");
      return;
    }

    const fetchGenerations = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/generations`);
        if (res.ok) {
          const data = await res.json();
          setGenerations(data);
        }
      } catch (err) {
        console.error("Error fetching generations:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchGenerations();
  }, [projectId, isOpen]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;

    setUploading(true);
    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === "string") {
        setSelectedImage(result);
      }
      setUploading(false);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleConfirm = async () => {
    if (!selectedImage) return;

    // If it's a new upload, first upload to S3
    if (isNewUpload) {
      setSubmitting(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/uploads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageData: selectedImage,
            fileName: uploadedFileName,
          }),
        });

        if (!res.ok) {
          const error = await res.json();
          console.error("Error uploading image:", error);
          alert("Error al subir la imagen");
          setSubmitting(false);
          return;
        }

        const data = await res.json();
        // Pass the S3 URL to parent
        onSelect(data.image_url, showReferenceTypeSelector ? selectedType : undefined);
      } catch (err) {
        console.error("Error uploading image:", err);
        alert("Error al subir la imagen");
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
    } else {
      // It's from gallery, pass URL directly
      onSelect(selectedImage, showReferenceTypeSelector ? selectedType : undefined);
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[85vh] flex flex-col bg-[#131318] rounded-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <h3 className="font-medium text-lg">{title}</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-accent rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Upload option */}
          <div className="mb-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full gap-2"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Subir desde dispositivo
            </Button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-border/50" />
            <span className="text-xs text-muted-foreground">o selecciona de la galería</span>
            <div className="flex-1 h-px bg-border/50" />
          </div>

          {/* Gallery Grid */}
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : generations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <ImageIcon className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground text-sm">
                No hay imágenes en este proyecto
              </p>
              <p className="text-muted-foreground/60 text-xs mt-1">
                Sube una imagen desde tu dispositivo
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {generations.map((gen) => (
                <button
                  key={`${gen.source || 'gen'}-${gen.id}`}
                  onClick={() => setSelectedImage(gen.image_url)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                    selectedImage === gen.image_url
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-transparent hover:border-border"
                  }`}
                >
                  <img
                    src={gen.image_url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  {/* Source badge */}
                  {gen.source === "uploaded" && (
                    <div className="absolute top-1 left-1 bg-blue-500/80 rounded px-1.5 py-0.5 text-[9px] font-medium text-white">
                      Subida
                    </div>
                  )}
                  {selectedImage === gen.image_url && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                        <Check className="h-5 w-5 text-primary-foreground" />
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer with selection preview and type selector */}
        {selectedImage && (
          <div className="p-4 border-t border-border/50 space-y-4">
            {/* Preview */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-lg overflow-hidden border border-border flex-shrink-0">
                <img
                  src={selectedImage}
                  alt="Selected"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Imagen seleccionada</p>
                <p className="text-xs text-muted-foreground truncate">
                  {selectedImage.startsWith("data:") ? "Imagen subida" : selectedImage}
                </p>
              </div>
            </div>

            {/* Reference Type Selector */}
            {showReferenceTypeSelector && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Tipo de referencia</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setSelectedType("ASSET")}
                    className={`p-3 rounded-lg border-2 transition-all text-left ${
                      selectedType === "ASSET"
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-border/80"
                    }`}
                  >
                    <p className="font-medium text-sm">Asset</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      El video debe contener este objeto/persona
                    </p>
                  </button>
                  <button
                    onClick={() => setSelectedType("STYLE")}
                    className={`p-3 rounded-lg border-2 transition-all text-left ${
                      selectedType === "STYLE"
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-border/80"
                    }`}
                  >
                    <p className="font-medium text-sm">Style</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      El video debe tener este estilo visual
                    </p>
                  </button>
                </div>
              </div>
            )}

            {/* Confirm Button */}
            <Button
              onClick={handleConfirm}
              disabled={submitting}
              className="w-full"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Subiendo imagen...
                </>
              ) : isNewUpload ? (
                "Subir y seleccionar"
              ) : (
                "Seleccionar imagen"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
