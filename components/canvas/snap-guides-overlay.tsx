"use client";

// Líneas de las guías inteligentes mientras se arrastra (coordenadas del
// canvas, dentro del viewport de React Flow). El grosor es fijo en pantalla.

import { memo, useEffect, useState } from "react";
import { ViewportPortal } from "@xyflow/react";
import type { Guide } from "./lib/snap-guides";

export const SnapGuidesOverlay = memo(function SnapGuidesOverlay({ guides }: { guides: Guide[] }) {
  if (guides.length === 0) return null;
  return (
    <ViewportPortal>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} style={{ zIndex: 1000 }}>
        {guides.map((g, i) =>
          g.orientation === "v" ? (
            <line key={i} x1={g.pos} x2={g.pos} y1={g.from} y2={g.to} stroke="#ec4899" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ) : (
            <line key={i} x1={g.from} x2={g.to} y1={g.pos} y2={g.pos} stroke="#ec4899" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ),
        )}
      </svg>
    </ViewportPortal>
  );
});

const PREFS_KEY = "canvas-snap-prefs";

export interface SnapPrefs {
  guides: boolean;
  grid: boolean;
}

/** Preferencias de ajuste (por navegador): guías encendidas y cuadrícula apagada por defecto. */
export function useSnapPrefs(): [SnapPrefs, (patch: Partial<SnapPrefs>) => void] {
  const [prefs, setPrefs] = useState<SnapPrefs>({ guides: true, grid: false });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SnapPrefs>;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- se lee una vez al montar (localStorage no existe en el servidor)
        setPrefs((p) => ({ guides: saved.guides ?? p.guides, grid: saved.grid ?? p.grid }));
      }
    } catch {
      // sin localStorage: quedan los valores por defecto
    }
  }, []);
  const update = (patch: Partial<SnapPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // ignora: solo es una preferencia
      }
      return next;
    });
  return [prefs, update];
}
