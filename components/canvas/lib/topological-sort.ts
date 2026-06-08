import type { CanvasEdge } from "./canvas-types";
import { baseHandleId } from "./canvas-types";
import type { Node } from "@xyflow/react";

/**
 * Topological sort using Kahn's algorithm.
 * Returns an array of "levels" - nodes in the same level have no dependencies
 * on each other and can potentially be executed in parallel.
 *
 * @returns Array of levels, each level is an array of node IDs.
 *          Returns null if a cycle is detected.
 */
export function topologicalSort(
  nodes: Node[],
  edges: CanvasEdge[]
): string[][] | null {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  // Initialize
  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  // Build graph
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adj.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  // Start with nodes that have no incoming edges
  const levels: string[][] = [];
  let queue = Array.from(nodeIds).filter((id) => inDegree.get(id) === 0);
  let processed = 0;

  while (queue.length > 0) {
    levels.push([...queue]);
    processed += queue.length;

    const nextQueue: string[] = [];
    for (const nodeId of queue) {
      for (const neighbor of adj.get(nodeId) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          nextQueue.push(neighbor);
        }
      }
    }
    queue = nextQueue;
  }

  // Cycle detection: if we haven't processed all nodes, there's a cycle
  if (processed < nodeIds.size) {
    return null;
  }

  return levels;
}

/**
 * Get all upstream node IDs for a given node (transitive dependencies).
 */
export function getUpstreamNodes(
  nodeId: string,
  edges: CanvasEdge[]
): string[] {
  const upstream: string[] = [];
  const visited = new Set<string>();
  const stack = [nodeId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const edge of edges) {
      if (edge.target === current && !visited.has(edge.source)) {
        upstream.push(edge.source);
        stack.push(edge.source);
      }
    }
  }

  return upstream;
}

/**
 * Get direct parent nodes and their connection info for a given node.
 */
export function getDirectInputs(
  nodeId: string,
  edges: CanvasEdge[]
): { sourceNodeId: string; sourceHandle: string | null; targetHandle: string | null }[] {
  return edges
    .filter((e) => e.target === nodeId)
    .map((e) => ({
      sourceNodeId: e.source,
      sourceHandle: e.sourceHandle || null,
      // Normalize the top-edge twin (e.g. "input-prompt__top") back to its base
      // id so all downstream `=== HANDLE_IDS.X` comparisons keep working.
      targetHandle: baseHandleId(e.targetHandle),
    }));
}
