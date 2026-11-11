"use client";

// <img> de los nodos del canvas: muestra la miniatura (ver lib/thumb.ts) y
// cambia al original solo si hace falta para que se vea nítida — el nodo está
// en pantalla y, con su tamaño, el zoom y la densidad de la pantalla, pide más
// píxeles que la miniatura. Al alejar vuelve a la miniatura (ya en caché).

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { useStore } from "@xyflow/react";
import { needsOriginal, thumbUrl, type ThumbWidth } from "../lib/thumb";

// Zoom en pasos de 0,25: el componente solo se re-renderiza al cruzar un paso,
// no en cada cuadro del pan/zoom.
const steppedZoomSelector = (s: { transform: [number, number, number] }) => Math.ceil(s.transform[2] * 4) / 4;

interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width"> {
  src: string;
  /** Ancho de la miniatura. */
  width: ThumbWidth;
}

export function CanvasImg({ src, width, ...rest }: Props) {
  const ref = useRef<HTMLImageElement>(null);
  const zoom = useStore(steppedZoomSelector as never) as unknown as number;
  const [boxWidth, setBoxWidth] = useState(0);
  const [onScreen, setOnScreen] = useState(false);

  // Ancho dibujado (CSS, sin el zoom del canvas).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const wantsOriginal = needsOriginal(boxWidth, zoom, dpr, width);

  // Solo si haría falta el original se mira si está en pantalla (el
  // IntersectionObserver considera el transform del viewport de React Flow).
  useEffect(() => {
    const el = ref.current;
    if (!el || !wantsOriginal) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [wantsOriginal]);

  const useOriginal = wantsOriginal && onScreen;
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img ref={ref} src={useOriginal ? src : thumbUrl(src, width)} decoding="async" {...rest} />;
}
