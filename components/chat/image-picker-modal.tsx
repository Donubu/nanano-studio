"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { X, Loader2, Upload, Image as ImageIcon, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

type ReferenceType = "ASSET" | "STYLE";

interface Generation {
  id: number;
  image_url: string | null;
  created_at: string;
  conversation_title?: string;
  content?: string | null;
  type?: "image" | "video";
  source?: "generation" | "upload";
}

interface ImagePickerModalProps {
  projectId: number;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (imageUrl: string, referenceType?: ReferenceType) => void;
  title: string;
  showReferenceTypeSelector?: boolean;
  multiSelect?: boolean;
}

/** Compute a human-readable aspect ratio label from dimensions */
function getAspectLabel(w: number, h: number): string {
  if (!w || !h) return "";
  const r = w / h;
  if (Math.abs(r - 16 / 9) < 0.08) return "16:9";
  if (Math.abs(r - 9 / 16) < 0.05) return "9:16";
  if (Math.abs(r - 1) < 0.08) return "1:1";
  if (Math.abs(r - 4 / 3) < 0.08) return "4:3";
  if (Math.abs(r - 3 / 4) < 0.06) return "3:4";
  if (Math.abs(r - 3 / 2) < 0.08) return "3:2";
  if (Math.abs(r - 2 / 3) < 0.06) return "2:3";
  if (Math.abs(r - 21 / 9) < 0.1) return "21:9";
  return `${w}×${h}`;
}

function AspectBadge({ src }: { src: string }) {
  const [label, setLabel] = useState<string>("");

  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setLabel(getAspectLabel(img.naturalWidth, img.naturalHeight));
    img.src = src;
  }, [src]);

  if (!label) return null;
  return (
    <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] font-medium px-1.5 py-0.5 rounded z-10">
      {label}
    </div>
  );
}

export function ImagePickerModal({
  projectId,
  isOpen,
  onClose,
  onSelect,
  title,
  showReferenceTypeSelector = false,
  multiSelect = false,
}: ImagePickerModalProps) {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<ReferenceType>("ASSET");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const firstSelected = selectedImages.size > 0 ? [...selectedImages][0] : null;
  const isNewUpload = firstSelected?.startsWith("data:");

  // Handle Escape key to close modal (capture phase to prevent canvas/chat from also reacting)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedImages(new Set());
      setUploadedFileName(null);
      setSelectedType("ASSET");
      return;
    }

    const fetchImages = async () => {
      setLoading(true);
      try {
        const [generationsRes, uploadsRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/generations?type=images&limit=100`),
          fetch(`/api/projects/${projectId}/uploads`),
        ]);

        let allImages: Generation[] = [];

        if (generationsRes.ok) {
          const generationsData = await generationsRes.json();
          const generations = (generationsData.data || []).map((g: Generation) => ({
            ...g,
            source: "generation" as const,
          }));
          allImages = [...allImages, ...generations];
        }

        if (uploadsRes.ok) {
          const uploadsData = await uploadsRes.json();
          const uploads = (uploadsData || []).map((u: { id: number; image_url: string; created_at: string; original_filename?: string }) => ({
            id: u.id,
            image_url: u.image_url,
            created_at: u.created_at,
            content: u.original_filename || "Imagen subida",
            source: "upload" as const,
          }));
          allImages = [...allImages, ...uploads];
        }

        allImages.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setGenerations(allImages);
      } catch (err) {
        console.error("Error fetching images:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchImages();
  }, [projectId, isOpen]);

  const toggleImage = useCallback((url: string) => {
    setSelectedImages((prev) => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        if (!multiSelect) next.clear();
        next.add(url);
      }
      return next;
    });
  }, [multiSelect]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;

    setUploading(true);
    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === "string") {
        setSelectedImages((prev) => {
          const next = new Set(prev);
          if (!multiSelect) next.clear();
          next.add(result);
          return next;
        });
      }
      setUploading(false);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleConfirm = async () => {
    if (selectedImages.size === 0) return;

    setSubmitting(true);
    try {
      for (const img of selectedImages) {
        if (img.startsWith("data:")) {
          // Upload to S3 first
          const res = await fetch(`/api/projects/${projectId}/uploads`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageData: img, fileName: uploadedFileName }),
          });
          if (!res.ok) {
            console.error("Error uploading image:", await res.json());
            continue;
          }
          const data = await res.json();
          onSelect(data.image_url, showReferenceTypeSelector ? selectedType : undefined);
        } else {
          onSelect(img, showReferenceTypeSelector ? selectedType : undefined);
        }
      }
    } catch (err) {
      console.error("Error processing selection:", err);
      alert("Error al procesar la selección");
    } finally {
      setSubmitting(false);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[85vh] flex flex-col bg-sidebar rounded-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <h3 className="font-medium text-lg">{title}</h3>
            {multiSelect && selectedImages.size > 0 && (
              <span className="text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full font-medium">
                {selectedImages.size} seleccionada{selectedImages.size !== 1 ? "s" : ""}
              </span>
            )}
          </div>
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
          ) : generations.filter(gen => gen.image_url).length === 0 ? (
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
              {generations.filter(gen => gen.image_url).map((gen) => {
                const isSelected = selectedImages.has(gen.image_url!);
                return (
                  <button
                    key={`${gen.source}-${gen.id}`}
                    onClick={() => toggleImage(gen.image_url!)}
                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                      isSelected
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-transparent hover:border-border"
                    }`}
                  >
                    <Image
                      src={gen.image_url!}
                      alt={gen.content || ""}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 33vw, 20vw"
                    />
                    {/* Aspect ratio badge */}
                    <AspectBadge src={gen.image_url!} />
                    {/* Upload badge */}
                    {gen.source === "upload" && (
                      <div className="absolute top-1 left-1 bg-blue-500/90 text-white text-[9px] font-medium px-1.5 py-0.5 rounded flex items-center gap-1 z-10">
                        <Upload className="h-2.5 w-2.5" />
                        Subida
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute inset-0 bg-primary/20 flex items-center justify-center z-10">
                        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-5 w-5 text-primary-foreground" />
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with selection preview and type selector */}
        {selectedImages.size > 0 && (
          <div className="p-4 border-t border-border/50 space-y-4">
            {/* Preview */}
            <div className="flex items-center gap-4">
              {selectedImages.size === 1 ? (
                <>
                  <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-border flex-shrink-0">
                    {firstSelected!.startsWith("data:") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={firstSelected!} alt="Selected" className="w-full h-full object-cover" />
                    ) : (
                      <Image src={firstSelected!} alt="Selected" fill className="object-cover" sizes="64px" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Imagen seleccionada</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {firstSelected!.startsWith("data:") ? "Imagen subida" : firstSelected}
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3 flex-1">
                  <div className="flex -space-x-2">
                    {[...selectedImages].slice(0, 5).map((url, i) => (
                      <div key={i} className="relative w-10 h-10 rounded-lg overflow-hidden border-2 border-sidebar flex-shrink-0">
                        {url.startsWith("data:") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Image src={url} alt="" fill className="object-cover" sizes="40px" />
                        )}
                      </div>
                    ))}
                    {selectedImages.size > 5 && (
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center border-2 border-sidebar text-xs font-medium">
                        +{selectedImages.size - 5}
                      </div>
                    )}
                  </div>
                  <p className="text-sm font-medium">{selectedImages.size} imágenes seleccionadas</p>
                </div>
              )}
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
                    disabled
                    className="p-3 rounded-lg border-2 border-border/50 text-left opacity-50 cursor-not-allowed"
                  >
                    <p className="font-medium text-sm text-muted-foreground">Style</p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">
                      Próximamente
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
                  {selectedImages.size > 1 ? "Procesando imágenes..." : "Subiendo imagen..."}
                </>
              ) : isNewUpload && selectedImages.size === 1 ? (
                "Subir y seleccionar"
              ) : selectedImages.size > 1 ? (
                `Seleccionar ${selectedImages.size} imágenes`
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
