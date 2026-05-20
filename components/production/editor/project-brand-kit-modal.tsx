"use client";

// Modal que edita un brand kit específico (típicamente el fork project-scoped
// del template activo). El kit a editar lo decide el caller — antes el modal
// hacía lazy-create de un kit por proyecto, ahora la decisión vive afuera
// (producir page maneja selección + fork). El modal solo es un wrapper del
// BrandKitEditor con el chrome del overlay.

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandKit, BrandKitContent } from "@/lib/production/brand-kit";
import { BrandKitEditor } from "@/components/dashboard/brand-kit-editor";

interface Props {
  kit: BrandKit;
  onClose: () => void;
  // Notificación que el kit fue guardado. El caller refetchea la lista para
  // reflejar nombre/content nuevos.
  onSaved: (content: BrandKitContent, name: string) => void;
}

export function ProjectBrandKitModal({ kit, onClose, onSaved }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border/50 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
          <div>
            <h2 className="text-sm font-semibold">Personalizar brand kit</h2>
            <p className="text-xs text-muted-foreground">
              Editás un fork del kit, scoped a este proyecto. Los cambios NO
              afectan al kit original del cliente.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <BrandKitEditor
            kit={kit}
            hideDefaultCheckbox
            onCancel={onClose}
            onSaved={(content, name) => {
              onSaved(content, name);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}
