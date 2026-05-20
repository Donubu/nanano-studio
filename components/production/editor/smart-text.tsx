"use client";

import {
  CSSProperties,
  HTMLAttributes,
  useLayoutEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import { FontSizeRange } from "@/lib/production/types";

// Renders text that auto-fits inside a fixed bounding box. The largest font
// size in [range.min, range.max] that doesn't overflow either axis wins.
// Re-measures on container resize and content change.
//
// Implementation: a hidden measurer mirrors the visible text with mutable
// font-size. Binary search picks the optimal size; visible text renders with
// that size. ResizeObserver triggers re-measurement when the parent stretches
// (e.g. after a reflow or override edit).

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, "style" | "children"> {
  content: string;
  range: FontSizeRange;
  style: CSSProperties;
  measurerExtraStyle?: CSSProperties;
  children?: ReactNode;
}

export function SmartText({
  content,
  range,
  style,
  measurerExtraStyle,
  children,
  ...rest
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measurerRef = useRef<HTMLDivElement | null>(null);
  const [fontSize, setFontSize] = useState<number>(
    Math.min(Math.max(range.max, range.min), range.max)
  );

  useLayoutEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      const measurer = measurerRef.current;
      if (!container || !measurer) return;
      const maxW = container.clientWidth;
      const maxH = container.clientHeight;
      if (maxW <= 0 || maxH <= 0) return;
      let lo = Math.max(1, Math.floor(range.min));
      let hi = Math.max(lo, Math.floor(range.max));
      let best = lo;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        measurer.style.fontSize = `${mid}px`;
        const fits =
          measurer.scrollWidth <= maxW && measurer.scrollHeight <= maxH;
        if (fits) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      setFontSize(best);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [content, range.min, range.max, style.fontFamily, style.fontWeight, style.letterSpacing, style.lineHeight]);

  // El measurer hereda casi todo el style pero queda fuera del flujo visible.
  const measurerStyle: CSSProperties = {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    fontStyle: style.fontStyle,
    textAlign: style.textAlign,
    // El measurer respeta el ancho del contenedor pero crece libre en alto.
    width: "100%",
    height: "auto",
    top: 0,
    left: 0,
    ...measurerExtraStyle,
  };

  return (
    <div
      ref={containerRef}
      style={{
        ...style,
        fontSize,
        position: style.position ?? "relative",
        overflow: "hidden",
      }}
      {...rest}
    >
      <div ref={measurerRef} style={measurerStyle}>
        {content}
      </div>
      {children ?? content}
    </div>
  );
}
