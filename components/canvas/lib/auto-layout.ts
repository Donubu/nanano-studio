import type { Node, Edge } from "@xyflow/react";
import { topologicalSort } from "./topological-sort";

const COLUMN_GAP = 80;
const ROW_GAP = 60;
const DEFAULT_W = 300;
const DEFAULT_H = 220;
const ORIGIN_X = 100;
const ORIGIN_Y = 100;

/**
 * Vertical timeline layout: time flows top → bottom.
 *
 * - Y axis: topological depth (sources at the top, dependents below).
 * - X axis: chains. Connected nodes are placed sequentially in the same
 *   column whenever possible — i.e. a node's first child stays in its
 *   parent's column, additional children fork to new columns to the right.
 * - Disconnected components / extra roots get their own columns.
 *
 * Falls back to a square grid if the graph contains a cycle (shouldn't
 * happen since canvas connection rules forbid cycles, but defensive).
 *
 * Returns a Map of nodeId → {x, y} so callers can merge positions back
 * into state without disturbing other node fields.
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

  // Y position by topological level.
  const levelOf = new Map<string, number>();
  levels.forEach((ids, depth) => ids.forEach((id) => levelOf.set(id, depth)));

  // Build child / parent adjacency.
  const childrenOf = new Map<string, string[]>();
  const parentsOf = new Map<string, string[]>();
  for (const n of nodes) {
    childrenOf.set(n.id, []);
    parentsOf.set(n.id, []);
  }
  for (const e of edges) {
    if (childrenOf.has(e.source) && parentsOf.has(e.target)) {
      childrenOf.get(e.source)!.push(e.target);
      parentsOf.get(e.target)!.push(e.source);
    }
  }

  // Assign columns. DFS from each root: the first child of any node
  // inherits the parent's column (sequential vertical chain), subsequent
  // children fork into new columns to the right. Multi-parent nodes
  // belong to whichever parent visits them first.
  const column = new Map<string, number>();
  let nextCol = 0;

  const dfs = (id: string) => {
    if (column.has(id)) return;
    column.set(id, nextCol);
    const kids = childrenOf.get(id) || [];
    if (kids.length === 0) return;
    // Sort kids deterministically: nodes that aren't shared with another
    // parent come first (those want to chain off this node), so they
    // inherit the column. Shared kids are visited last.
    const sortedKids = [...kids].sort((a, b) => {
      const aShared = (parentsOf.get(a) || []).length > 1 ? 1 : 0;
      const bShared = (parentsOf.get(b) || []).length > 1 ? 1 : 0;
      return aShared - bShared;
    });
    for (let i = 0; i < sortedKids.length; i++) {
      if (i > 0 && !column.has(sortedKids[i])) nextCol += 1;
      dfs(sortedKids[i]);
    }
  };

  // Roots = nodes with no parents. Sort by current X for stability so
  // the layout doesn't completely scramble the user's mental model.
  const roots = nodes
    .filter((n) => (parentsOf.get(n.id) || []).length === 0)
    .sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0))
    .map((n) => n.id);

  for (const rootId of roots) {
    if (column.has(rootId)) continue;
    dfs(rootId);
    nextCol += 1;
  }

  // Any nodes still unvisited (would only happen with detached cycles
  // that topologicalSort somehow accepted): give them their own columns.
  for (const n of nodes) {
    if (!column.has(n.id)) {
      column.set(n.id, nextCol);
      nextCol += 1;
    }
  }

  // Compute column widths and row heights from actual node sizes.
  const colWidth = new Map<number, number>();
  const rowHeight = new Map<number, number>();
  for (const n of nodes) {
    const { w, h } = sizeOf(n);
    const col = column.get(n.id)!;
    const row = levelOf.get(n.id) ?? 0;
    colWidth.set(col, Math.max(colWidth.get(col) ?? DEFAULT_W, w));
    rowHeight.set(row, Math.max(rowHeight.get(row) ?? DEFAULT_H, h));
  }

  // Cumulative offsets so nodes never overlap regardless of size.
  const totalCols = nextCol;
  const colX: number[] = [];
  let cx = ORIGIN_X;
  for (let c = 0; c < totalCols; c++) {
    colX[c] = cx;
    cx += (colWidth.get(c) ?? DEFAULT_W) + COLUMN_GAP;
  }
  const rowY: number[] = [];
  let cy = ORIGIN_Y;
  for (let r = 0; r < levels.length; r++) {
    rowY[r] = cy;
    cy += (rowHeight.get(r) ?? DEFAULT_H) + ROW_GAP;
  }

  for (const n of nodes) {
    const col = column.get(n.id)!;
    const row = levelOf.get(n.id) ?? 0;
    positions.set(n.id, { x: colX[col], y: rowY[row] });
  }

  return positions;
}
