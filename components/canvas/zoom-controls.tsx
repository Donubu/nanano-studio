"use client";

// Controles de zoom del canvas: acercar, % actual, alejar y encuadrar todo.
// Reemplaza los botones por defecto de <Controls> para poder mostrar el % entre
// ambos. Click en el % vuelve a 100%.

import { ControlButton, Controls, useReactFlow, useStore } from "@xyflow/react";
import type React from "react";
import { Maximize, Minus, Plus } from "lucide-react";

// Las reglas de React Flow rellenan los íconos (fill: currentColor); los de
// lucide son de trazo.
const ICON_STYLE = { fill: "none" } as const;

// Colores del tema de la app (los por defecto de React Flow eran blancos con
// íconos casi invisibles en modo oscuro) y botones más anchos para "200%".
const CONTROLS_STYLE = {
  "--xy-controls-button-background-color": "var(--card)",
  "--xy-controls-button-background-color-hover": "var(--muted)",
  "--xy-controls-button-color": "var(--foreground)",
  "--xy-controls-button-color-hover": "var(--foreground)",
  "--xy-controls-button-border-color": "var(--border)",
} as React.CSSProperties;
const BUTTON_CLASS = "!w-9 !h-7";

const zoomPercentSelector = (s: { transform: [number, number, number] }) => Math.round(s.transform[2] * 100);
const minZoomSelector = (s: { minZoom: number }) => s.minZoom;
const maxZoomSelector = (s: { maxZoom: number }) => s.maxZoom;

export function ZoomControls() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  // Entero: solo re-renderiza cuando cambia el % que se muestra.
  const percent = useStore(zoomPercentSelector as never) as unknown as number;
  const minZoom = useStore(minZoomSelector as never) as unknown as number;
  const maxZoom = useStore(maxZoomSelector as never) as unknown as number;

  return (
    <Controls
      position="bottom-left"
      showZoom={false}
      showFitView={false}
      showInteractive={false}
      style={CONTROLS_STYLE}
      className="overflow-hidden rounded-md border border-border"
    >
      <ControlButton onClick={() => zoomIn({ duration: 150 })} disabled={percent >= Math.round(maxZoom * 100)} title="Acercar" aria-label="Acercar" className={BUTTON_CLASS}>
        <Plus style={ICON_STYLE} />
      </ControlButton>
      <ControlButton
        onClick={() => zoomTo(1, { duration: 200 })}
        title="Zoom actual · click para volver a 100%"
        aria-label={`Zoom ${percent}%, volver a 100%`}
        className={`${BUTTON_CLASS} text-[10px] font-medium tabular-nums`}
      >
        {percent}%
      </ControlButton>
      <ControlButton onClick={() => zoomOut({ duration: 150 })} disabled={percent <= Math.round(minZoom * 100)} title="Alejar" aria-label="Alejar" className={BUTTON_CLASS}>
        <Minus style={ICON_STYLE} />
      </ControlButton>
      <ControlButton onClick={() => fitView({ duration: 200 })} title="Ver todo" aria-label="Ver todo" className={BUTTON_CLASS}>
        <Maximize style={ICON_STYLE} />
      </ControlButton>
    </Controls>
  );
}
