"use client";

import { NodeResizeControl } from "@xyflow/react";

interface ResizeHandleProps {
  /** Minimum width in px the user can shrink the node to. */
  minWidth?: number;
  /** Minimum height in px the user can shrink the node to. */
  minHeight?: number;
}

/**
 * Single bottom-right resize handle, Figma/Excel style. Discreet by default
 * (low opacity) and brightens on hover. Drop inside any canvas node alongside
 * the existing handles. Pair with `nodeSizeClass()` to make the node's
 * root element grow with the resized wrapper.
 *
 * Resizing preserves the node's current aspect ratio: making it wider also
 * makes it taller (and vice versa). Without this, dragging only-horizontally
 * stretches the box but leaves its height unchanged, which causes the
 * generated image to overflow and push the action buttons (history nav,
 * download, delete) off-screen / out of reach.
 */
export function ResizeHandle({ minWidth = 200, minHeight = 80 }: ResizeHandleProps) {
  return (
    <NodeResizeControl
      position="bottom-right"
      minWidth={minWidth}
      minHeight={minHeight}
      keepAspectRatio
      style={{
        background: "transparent",
        border: "none",
        width: 14,
        height: 14,
      }}
      className="opacity-30 group-hover:opacity-100 transition-opacity"
    >
      {/* Three diagonal lines, classic resize indicator */}
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        className="absolute bottom-0.5 right-0.5 pointer-events-none text-muted-foreground"
        aria-hidden
      >
        <path
          d="M0 10 L10 0 M3 10 L10 3 M6 10 L10 6"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </NodeResizeControl>
  );
}

/**
 * Helper: returns the className suffix for a canvas node's root element.
 *
 * - If the user has resized the node (width/height are set on the wrapper),
 *   the root fills 100% of that wrapper AND switches to a flex-column with
 *   overflow-hidden so the resized box clips/contains its children.
 * - Otherwise, it falls back to its natural tailwind min-w/max-w defaults
 *   with no flex/overflow wrapping — preserving the rendering of canvases
 *   created before resize support existed.
 *
 * Usage:
 *   const sizeClass = nodeSizeClass(width, height, "min-w-[260px] max-w-[300px]");
 *   <div className={`... ${sizeClass}`}>
 */
export function nodeSizeClass(
  width: number | undefined,
  height: number | undefined,
  defaults: string
): string {
  const customSize = width != null || height != null;
  return customSize
    ? "w-full h-full overflow-hidden flex flex-col"
    : defaults;
}
