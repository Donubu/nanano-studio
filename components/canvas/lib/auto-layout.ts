import type { Node, Edge } from "@xyflow/react";
import { topologicalSort } from "./topological-sort";

const COLUMN_GAP = 80;
const ROW_GAP = 60;
const DEFAULT_W = 300;
const DEFAULT_H = 200;
const ORIGIN_X = 100;
const ORIGIN_Y = 100;

/**
 * Compute fresh positions for every node by laying them out in columns based
 * on topological levels (sources on the left, dependents on the right).
 * Within a column, nodes stack vertically using their actual measured /
 * resized size so that nothing overlaps.
 *
 * Falls back to a simple grid if the graph contains a cycle.
 *
 * Returns a Map of nodeId -> {x, y} so callers can merge positions back into
 * their state without disturbing other node fields.
 */
export function autoLayoutPositions(
  nodes: Node[],
  edges: Edge[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;

  const sizeOf = (n: Node) => {
    const w =
      (typeof n.width === "number" ? n.width : undefined) ??
      (n.measured?.width as number | undefined) ??
      DEFAULT_W;
    const h =
      (typeof n.height === "number" ? n.height : undefined) ??
      (n.measured?.height as number | undefined) ??
      DEFAULT_H;
    return { w, h };
  };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const levels = topologicalSort(nodes, edges);

  // Cycle: fall back to a fixed-width grid.
  if (!levels) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    let col = 0;
    let rowMaxH = 0;
    let cumulativeY = ORIGIN_Y;
    for (const n of nodes) {
      const { h } = sizeOf(n);
      positions.set(n.id, {
        x: ORIGIN_X + col * (DEFAULT_W + COLUMN_GAP),
        y: cumulativeY,
      });
      rowMaxH = Math.max(rowMaxH, h);
      col += 1;
      if (col >= cols) {
        col = 0;
        cumulativeY += rowMaxH + ROW_GAP;
        rowMaxH = 0;
      }
    }
    return positions;
  }

  let cumulativeX = ORIGIN_X;
  for (const level of levels) {
    // Column width = max width in the level, so columns are tight but never
    // overlap with the next column.
    let columnWidth = DEFAULT_W;
    for (const id of level) {
      const node = byId.get(id);
      if (!node) continue;
      columnWidth = Math.max(columnWidth, sizeOf(node).w);
    }

    let cumulativeY = ORIGIN_Y;
    for (const id of level) {
      const node = byId.get(id);
      if (!node) continue;
      const { h } = sizeOf(node);
      positions.set(id, { x: cumulativeX, y: cumulativeY });
      cumulativeY += h + ROW_GAP;
    }

    cumulativeX += columnWidth + COLUMN_GAP;
  }

  return positions;
}
