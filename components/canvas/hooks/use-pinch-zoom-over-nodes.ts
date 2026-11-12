"use client";

// Pellizco del trackpad (Mac) sobre zonas "nowheel" de los nodos.
//
// Las zonas con scroll propio (cuerpo del Personaje, textos, escenas…) llevan
// la clase `nowheel` para que la rueda desplace su contenido y no haga zoom.
// El pellizco llega al navegador como un evento wheel con ctrlKey, y React
// Flow también lo bloquea en esas zonas: solo se podía hacer zoom con el
// puntero fuera de los nodos. Aquí se intercepta SOLO el pellizco (wheel +
// ctrlKey) sobre `.nowheel` y se hace el zoom a mano, centrado en el puntero,
// con la misma sensibilidad que React Flow (d3-zoom). El scroll normal no se
// toca.

import { useEffect, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";

/** Zoom nuevo tras un pellizco (misma fórmula que d3-zoom con ctrl). Exportado para tests. */
export function pinchZoom(zoom: number, deltaY: number, deltaMode: number, minZoom: number, maxZoom: number): number {
  const delta = -deltaY * (deltaMode === 1 ? 0.05 : deltaMode ? 1 : 0.002) * 10;
  return Math.min(maxZoom, Math.max(minZoom, zoom * Math.pow(2, delta)));
}

export function usePinchZoomOverNodes(containerRef: RefObject<HTMLElement | null>, minZoom: number, maxZoom: number) {
  const { getViewport, setViewport } = useReactFlow();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      const target = e.target as Element | null;
      if (!target?.closest?.(".nowheel") || !target.closest(".react-flow")) return;
      // Evita el zoom del navegador y que React Flow lo descarte.
      e.preventDefault();
      e.stopPropagation();
      const { x, y, zoom } = getViewport();
      const next = pinchZoom(zoom, e.deltaY, e.deltaMode, minZoom, maxZoom);
      if (next === zoom) return;
      // El punto bajo el puntero queda fijo.
      const pane = target.closest(".react-flow")!.getBoundingClientRect();
      const px = e.clientX - pane.left;
      const py = e.clientY - pane.top;
      const ratio = next / zoom;
      setViewport({ x: px - (px - x) * ratio, y: py - (py - y) * ratio, zoom: next });
    };
    // Captura y no pasivo: hay que llegar antes que React Flow y poder cancelar.
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [containerRef, getViewport, setViewport, minZoom, maxZoom]);
}
