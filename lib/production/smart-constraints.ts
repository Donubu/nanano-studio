// Smart constraints inference.
//
// When a layer doesn't have custom constraints (i.e. it has the editor's
// default { h: "left", v: "top" }), this module computes a more reasonable
// constraint based on the layer's footprint inside its parent. The idea is
// that a productor shouldn't need to touch the constraints panel for the
// common cases — the system infers what "this looks centered" or "this looks
// pinned to the right edge" means.
//
// Rules (per axis, applied independently for H and V):
//   - Layer covers ≥ STRETCH_RATIO of the parent → "stretch"
//   - Layer center is within CENTER_RATIO of the parent center → "center"
//   - Layer hugs the start edge (distance ≤ EDGE_RATIO) → "left"/"top"
//   - Layer hugs the end edge (distance ≤ EDGE_RATIO) → "right"/"bottom"
//   - Otherwise → "scale" (proportional reflow)
//
// Order matters: stretch wins over center, which wins over edge anchoring.
// "scale" is the fallback for mid-range positions.

import {
  TemplateLayer,
  Constraints,
  ConstraintH,
  ConstraintV,
  DEFAULT_CONSTRAINTS,
} from "./types";

const STRETCH_RATIO = 0.9; // covers ≥90% of parent
const CENTER_RATIO = 0.05; // center within ±5% of parent center
const EDGE_RATIO = 0.05;   // edge within ±5% of parent edge

export function inferConstraints(
  layer: TemplateLayer,
  parent: { size: { w: number; h: number } },
): Constraints {
  const hRaw = inferAxis(layer.position.x, layer.size.w, parent.size.w);
  const vRaw = inferAxis(layer.position.y, layer.size.h, parent.size.h);
  // inferAxis usa terminología horizontal (left/right) para ambos ejes.
  // En el eje V los edges se llaman top/bottom; sin este mapeo, el cast
  // `as ConstraintV` mentía: a runtime quedaba "left" como valor de v, y
  // applyAxisV en reflow.ts no tiene case para "left" → caía a undefined
  // y rompía con "Cannot read properties of undefined (reading 'pos')".
  const vMapped: ConstraintV =
    vRaw === "left" ? "top" :
    vRaw === "right" ? "bottom" :
    vRaw as ConstraintV;
  return {
    h: hRaw as ConstraintH,
    v: vMapped,
  };
}

function inferAxis(
  pos: number,
  size: number,
  parentSize: number,
): "left" | "right" | "center" | "stretch" | "scale" {
  if (parentSize <= 0) return "left";

  const widthRatio = size / parentSize;
  if (widthRatio >= STRETCH_RATIO) return "stretch";

  const center = pos + size / 2;
  const centerOffset = Math.abs(center - parentSize / 2) / parentSize;
  if (centerOffset <= CENTER_RATIO) return "center";

  const distLeftRatio = pos / parentSize;
  const distRightRatio = (parentSize - (pos + size)) / parentSize;
  // Whichever edge is closer (and within threshold) wins.
  if (distLeftRatio <= EDGE_RATIO && distLeftRatio <= distRightRatio) return "left";
  if (distRightRatio <= EDGE_RATIO) return "right";

  return "scale";
}

// Returns true when the constraints look like the editor's untouched default,
// in which case smart inference should kick in. A user who explicitly changed
// any value is respected as-is.
export function isDefaultConstraints(c: Constraints | undefined): boolean {
  if (!c) return true;
  return c.h === DEFAULT_CONSTRAINTS.h && c.v === DEFAULT_CONSTRAINTS.v;
}

// Effective constraints used by the reflow engine: stored value when the user
// customized it, inferred value when it's the default placeholder.
export function effectiveConstraints(
  layer: TemplateLayer,
  parent: { size: { w: number; h: number } },
): Constraints {
  if (!isDefaultConstraints(layer.constraints)) {
    return layer.constraints as Constraints;
  }
  return inferConstraints(layer, parent);
}
