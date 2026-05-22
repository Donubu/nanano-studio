"use client";

import {
  Type,
  Image as ImageIcon,
  Square,
  Loader2,
  Check,
  AlertCircle,
  Palette,
  Undo2,
  Redo2,
  MousePointerClick,
  Minus,
  BadgePercent,
  Tag,
  Smile,
  ShieldCheck,
} from "lucide-react";
import { SaveStatus } from "@/lib/production/use-template-editor";
import { cn, formatDateTimeLocal } from "@/lib/utils";

interface Props {
  onAddText: () => void;
  onAddImage: () => void;
  onAddShape: () => void;
  onAddIcon: () => void;
  onAddButton: () => void;
  onAddDivider: () => void;
  onAddBadge: () => void;
  onAddRibbon: () => void;
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  onOpenProjectBrandKit?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // Toggle de zona segura. Cuando true, el canvas dibuja un rectángulo
  // punteado al 5% del borde. Es un visual-aid, no afecta export.
  showSafetyZone: boolean;
  onToggleSafetyZone: () => void;
  // Orientación de la barra. "horizontal" es la default histórica (banda
  // arriba del canvas con labels al lado del ícono). "vertical" es un
  // strip angosto a la izquierda del canvas con botones icon-only — pensado
  // para liberar ancho horizontal cuando el productor trabaja en banners
  // anchos o el viewport está achicado.
  orientation?: "horizontal" | "vertical";
}

// Botón normalizado de la toolbar. Si label es "" o iconOnly=true, se
// renderiza solo con ícono (útil para undo/redo y modo vertical).
function ToolbarBtn({
  onClick,
  title,
  label,
  icon: Icon,
  disabled,
  active,
  iconOnly,
}: {
  onClick: () => void;
  title: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  active?: boolean;
  iconOnly?: boolean;
}) {
  const isIconOnly = iconOnly || !label;
  const activeClass = active
    ? "border-yellow-400/60 bg-yellow-400/10 text-yellow-200"
    : "border-border/50 hover:bg-muted text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex items-center rounded-md border transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0",
        isIconOnly
          ? "justify-center w-8 h-8"
          : "gap-1.5 text-xs px-2.5 py-1.5",
        activeClass,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {!isIconOnly && <span>{label}</span>}
    </button>
  );
}

// Divisor entre grupos. En vertical es una línea horizontal entre filas;
// en horizontal es vertical entre columnas.
function ToolbarDivider({ vertical }: { vertical: boolean }) {
  return (
    <div
      className={cn("bg-border/50 shrink-0", vertical ? "w-5 h-px my-1" : "h-5 w-px mx-1")}
    />
  );
}

export function EditorToolbar({
  onAddText,
  onAddImage,
  onAddShape,
  onAddIcon,
  onAddButton,
  onAddDivider,
  onAddBadge,
  onAddRibbon,
  saveStatus,
  lastSavedAt,
  onOpenProjectBrandKit,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  showSafetyZone,
  onToggleSafetyZone,
  orientation = "horizontal",
}: Props) {
  const isVertical = orientation === "vertical";
  return (
    <div
      className={cn(
        "flex bg-card/40",
        isVertical
          // overflow-y-auto: cuando el alto del inner-row se reduce (por
          // ej. al expandirse el TimelinePanel), los íconos del toolbar
          // que no entren scrollean dentro de la propia columna en vez
          // de bleed visualmente hacia abajo y caer sobre el timeline.
          ? "flex-col items-center gap-1.5 px-1.5 py-2 border-r border-border/50 h-full shrink-0 overflow-y-auto"
          : "flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2 border-b border-border/50",
      )}
    >
      <ToolbarBtn onClick={onUndo} title="Deshacer (⌘Z)" label="" icon={Undo2} disabled={!canUndo} />
      <ToolbarBtn onClick={onRedo} title="Rehacer (⌘⇧Z)" label="" icon={Redo2} disabled={!canRedo} />

      <ToolbarDivider vertical={isVertical} />

      <ToolbarBtn onClick={onAddText} title="Texto" label="Texto" icon={Type} iconOnly={isVertical} />
      <ToolbarBtn onClick={onAddImage} title="Imagen" label="Imagen" icon={ImageIcon} iconOnly={isVertical} />
      <ToolbarBtn onClick={onAddShape} title="Forma" label="Forma" icon={Square} iconOnly={isVertical} />
      <ToolbarBtn onClick={onAddIcon} title="Ícono del catálogo curado" label="Ícono" icon={Smile} iconOnly={isVertical} />

      <ToolbarDivider vertical={isVertical} />

      {/* Presets compuestos. Cada uno inserta múltiples capas relacionadas
          (button = shape + text, badge = ellipse + text, etc.) en una
          sola acción undo-able. */}
      <ToolbarBtn onClick={onAddButton} title="Botón CTA (pill + texto)" label="Botón" icon={MousePointerClick} iconOnly={isVertical} />
      <ToolbarBtn onClick={onAddDivider} title="Línea divisoria horizontal" label="Línea" icon={Minus} iconOnly={isVertical} />
      <ToolbarBtn onClick={onAddBadge} title="Badge circular de descuento" label="Badge" icon={BadgePercent} iconOnly={isVertical} />
      <ToolbarBtn onClick={onAddRibbon} title="Ribbon diagonal tipo cinta de oferta" label="Ribbon" icon={Tag} iconOnly={isVertical} />

      {/* Spacer: empuja safety/brand/save al final. En vertical es altura,
          en horizontal es ancho. */}
      <div className={isVertical ? "flex-1 w-0" : "flex-1"} />

      {/* Zona segura. Tooltip explica el concepto porque no es obvio sin
          contexto (especialmente para productores nuevos). El borde
          amarillo del botón cuando está activo refuerza la asociación
          con el color del overlay en el canvas. */}
      <ToolbarBtn
        onClick={onToggleSafetyZone}
        title={
          "Zona segura: marca un margen del 5% al borde del banner. " +
          "Mantén textos y logos dentro del rectángulo punteado para " +
          "que no se corten en placements que recortan los bordes " +
          "(stories, perfiles, miniaturas). No afecta la exportación, " +
          "es solo una guía visual."
        }
        label="Zona segura"
        icon={ShieldCheck}
        active={showSafetyZone}
        iconOnly={isVertical}
      />

      {onOpenProjectBrandKit && (
        <ToolbarBtn
          onClick={onOpenProjectBrandKit}
          title="Tokens custom solo para este proyecto"
          label="Brand kit del proyecto"
          icon={Palette}
          iconOnly={isVertical}
        />
      )}

      <SaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} compact={isVertical} />
    </div>
  );
}

function SaveIndicator({
  status,
  lastSavedAt,
  compact = false,
}: {
  status: SaveStatus;
  lastSavedAt: Date | null;
  // Modo compacto: solo ícono + tooltip. Lo usa la versión vertical de la
  // toolbar donde no entra texto. Para "dirty" devuelve un punto naranja
  // pequeño en vez del texto "Cambios sin guardar".
  compact?: boolean;
}) {
  // whitespace-nowrap en todos los estados — la toolbar ahora usa flex-wrap,
  // pero el indicador en sí no debe romper su texto interno (que es lo que
  // hacía que "Guardado <fecha-hora>" rompiera en 2 líneas y empujara el
  // área de edición). Para el estado "saved" colapsamos a solo el ícono +
  // tooltip nativo con la fecha completa.
  if (status === "saving") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap" title="Guardando…">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {!compact && "Guardando…"}
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-red-400 whitespace-nowrap" title="Error al guardar">
        <AlertCircle className="h-3.5 w-3.5" />
        {!compact && "Error al guardar"}
      </div>
    );
  }
  if (status === "dirty") {
    if (compact) {
      return (
        <div
          className="w-2 h-2 rounded-full bg-orange-400/80"
          title="Cambios sin guardar"
        />
      );
    }
    return (
      <div className="text-xs text-muted-foreground whitespace-nowrap">
        Cambios sin guardar
      </div>
    );
  }
  if (status === "saved" && lastSavedAt) {
    return (
      <div
        className="flex items-center text-xs text-muted-foreground whitespace-nowrap"
        title={`Guardado ${formatDateTimeLocal(lastSavedAt.toISOString())}`}
      >
        <Check className="h-3.5 w-3.5 text-green-500" />
      </div>
    );
  }
  return null;
}
