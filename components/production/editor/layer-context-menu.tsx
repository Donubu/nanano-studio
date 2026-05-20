"use client";

import { useEffect, useRef } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignCenter,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowUp,
  ArrowDown,
  Copy,
  Lock,
  Unlock,
  Trash2,
} from "lucide-react";
import { TemplateLayer } from "@/lib/production/types";

export interface LayerContextMenuPosition {
  x: number;
  y: number;
  layerId: string;
}

interface Props {
  position: LayerContextMenuPosition;
  layer: TemplateLayer;
  parentIsStack: boolean;
  onClose: () => void;
  onCenter: (axis: "h" | "v" | "both") => void;
  onReorder: (op: "front" | "back" | "up" | "down") => void;
  onDuplicate: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
}

const MENU_WIDTH = 220;
const MENU_HEIGHT_EST = 320;

export function LayerContextMenu({
  position,
  layer,
  parentIsStack,
  onClose,
  onCenter,
  onReorder,
  onDuplicate,
  onToggleLock,
  onDelete,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Click outside / escape closes the menu.
  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer attaching so the same click that opened it doesn't close it.
    const t = setTimeout(() => {
      window.addEventListener("mousedown", handleDown);
      window.addEventListener("keydown", handleKey);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", handleDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Flip horizontally / vertically if near the viewport edge.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
  const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
  const left = position.x + MENU_WIDTH > vw ? Math.max(8, vw - MENU_WIDTH - 8) : position.x;
  const top = position.y + MENU_HEIGHT_EST > vh ? Math.max(8, vh - MENU_HEIGHT_EST - 8) : position.y;

  const wrap = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div
      ref={ref}
      style={{ position: "fixed", left, top, width: MENU_WIDTH, zIndex: 10000 }}
      className="bg-popover border border-border/50 rounded-lg shadow-2xl py-1 text-sm"
      onContextMenu={(e) => e.preventDefault()}
    >
      {!parentIsStack && (
        <>
          <MenuGroup label="Alinear">
            <MenuItem icon={<AlignCenterHorizontal className="h-3.5 w-3.5" />} onClick={wrap(() => onCenter("h"))}>
              Centrar horizontal
            </MenuItem>
            <MenuItem icon={<AlignCenterVertical className="h-3.5 w-3.5" />} onClick={wrap(() => onCenter("v"))}>
              Centrar vertical
            </MenuItem>
            <MenuItem icon={<AlignCenter className="h-3.5 w-3.5" />} onClick={wrap(() => onCenter("both"))}>
              Centrar ambos
            </MenuItem>
          </MenuGroup>
          <Divider />
        </>
      )}

      <MenuGroup label="Orden">
        <MenuItem icon={<ArrowUpToLine className="h-3.5 w-3.5" />} onClick={wrap(() => onReorder("front"))}>
          Traer al frente
        </MenuItem>
        <MenuItem icon={<ArrowUp className="h-3.5 w-3.5" />} onClick={wrap(() => onReorder("up"))}>
          Subir uno
        </MenuItem>
        <MenuItem icon={<ArrowDown className="h-3.5 w-3.5" />} onClick={wrap(() => onReorder("down"))}>
          Bajar uno
        </MenuItem>
        <MenuItem icon={<ArrowDownToLine className="h-3.5 w-3.5" />} onClick={wrap(() => onReorder("back"))}>
          Enviar al fondo
        </MenuItem>
      </MenuGroup>

      <Divider />

      <MenuItem icon={<Copy className="h-3.5 w-3.5" />} onClick={wrap(onDuplicate)} shortcut="⌘D">
        Duplicar
      </MenuItem>
      <MenuItem
        icon={layer.locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        onClick={wrap(onToggleLock)}
      >
        {layer.locked ? "Desbloquear" : "Bloquear"}
      </MenuItem>

      <Divider />

      <MenuItem
        icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
        onClick={wrap(onDelete)}
        shortcut="⌫"
        className="hover:bg-red-500/10 text-red-400"
      >
        Eliminar
      </MenuItem>
    </div>
  );
}

function MenuItem({
  icon,
  shortcut,
  onClick,
  children,
  className = "",
}: {
  icon?: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors ${className}`}
    >
      <span className="w-4 text-muted-foreground">{icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-[10px] text-muted-foreground/60">{shortcut}</span>}
    </button>
  );
}

function MenuGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/60">
        {label}
      </div>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-border/30 my-1" />;
}
