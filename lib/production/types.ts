// Template composition types.
// Stored as JSON in production_templates.definition_json.
// Slice 2A scope: free-position layers only. Auto-layout (stack), constraints,
// brand tokens, and variables come in later slices.

export type LayerType = "frame" | "text" | "image" | "shape";

export type ConstraintH = "left" | "right" | "center" | "stretch" | "scale";
export type ConstraintV = "top" | "bottom" | "center" | "stretch" | "scale";

export interface Constraints {
  h: ConstraintH;
  v: ConstraintV;
}

export const DEFAULT_CONSTRAINTS: Constraints = { h: "left", v: "top" };

export interface BaseLayer {
  id: string;
  type: LayerType;
  name?: string;
  position: { x: number; y: number };
  size: { w: number; h: number };
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  constraints?: Constraints;
}

export type StackAlign = "start" | "center" | "end" | "stretch";
export type StackJustify =
  | "start"
  | "center"
  | "end"
  | "space-between"
  | "space-around"
  | "space-evenly";

export interface FreeLayout {
  mode: "free";
}

export interface StackLayout {
  mode: "stack";
  direction: "vertical" | "horizontal";
  // [top, right, bottom, left]. Each side may be a token ref (e.g. "{spacing.md}")
  // resolved by brand-kit before render.
  padding: [number | string, number | string, number | string, number | string];
  gap: number | string;
  align: StackAlign;
  justify: StackJustify;
}

export type LayoutConfig = FreeLayout | StackLayout;

export const DEFAULT_STACK_LAYOUT: StackLayout = {
  mode: "stack",
  direction: "vertical",
  padding: [24, 24, 24, 24],
  gap: 12,
  align: "stretch",
  justify: "start",
};

export interface FrameLayer extends BaseLayer {
  type: "frame";
  background?: { type: "color"; value: string } | { type: "transparent" };
  layout: LayoutConfig;
  cornerRadius?: number;
  children: TemplateLayer[];
}

// Auto-fit text size: el renderer mide la caja del texto y elige el font-size
// más grande dentro de [min, max] que entre sin overflow. Útil para que un
// mismo headline funcione en piezas grandes y chicas sin truncar.
export interface FontSizeRange {
  min: number;
  max: number;
}

export interface TextLayer extends BaseLayer {
  type: "text";
  content: string;
  style: {
    fontFamily?: string;
    // Tres formas válidas:
    //   number          → tamaño fijo
    //   string          → token ref (e.g. "{scale.lg}")
    //   { min, max }    → auto-fit en el rango (smart text)
    fontSize: number | string | FontSizeRange;
    fontWeight?: number | string;
    color: string;
    lineHeight?: number;
    letterSpacing?: number;
    align?: "left" | "center" | "right";
    // Alineación vertical del bloque de texto dentro de su caja. Útil cuando
    // la caja es más alta que el contenido renderizado (típico en banners
    // chatos o cuando se usa SmartText auto-fit que deja sobrante). Default
    // = "top" para mantener el comportamiento histórico.
    verticalAlign?: "top" | "middle" | "bottom";
    italic?: boolean;
    // Fondo opcional del text layer. Permite que UN solo layer represente
    // un botón (text + pill) o un badge (text + círculo) sin necesidad de
    // componer 2 capas. Si está set, el renderer aplica el background+radius
    // a la misma caja del text — el texto se centra dentro vía verticalAlign
    // y align. Para un círculo: backgroundCornerRadius = size.w/2 con caja
    // cuadrada. Para una pill: backgroundCornerRadius = size.h/2.
    backgroundColor?: string;
    backgroundCornerRadius?: number;
  };
}

export function isFontSizeRange(v: unknown): v is FontSizeRange {
  return (
    typeof v === "object" &&
    v !== null &&
    "min" in v &&
    "max" in v &&
    typeof (v as FontSizeRange).min === "number" &&
    typeof (v as FontSizeRange).max === "number"
  );
}

export interface ImageLayer extends BaseLayer {
  type: "image";
  src: string | null;
  fit?: "cover" | "contain" | "fill";
  cornerRadius?: number;
}

export type ShapeKind = "rect" | "ellipse";

export interface ShapeLayer extends BaseLayer {
  type: "shape";
  shape: ShapeKind;
  fill: string;
  stroke?: { color: string; width: number } | null;
  cornerRadius?: number;
}

export type TemplateLayer = FrameLayer | TextLayer | ImageLayer | ShapeLayer;

// The root is always a FrameLayer with id "tpl_root" and size matching the
// template base_width/base_height.
export type TemplateDefinition = FrameLayer;

// ---------- Constructors ----------

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function newRootFrame(width: number, height: number): TemplateDefinition {
  return {
    id: "tpl_root",
    type: "frame",
    position: { x: 0, y: 0 },
    size: { w: width, h: height },
    background: { type: "color", value: "#ffffff" },
    // Stack vertical por defecto: las nuevas plantillas heredan layout
    // responsive de fábrica. El usuario puede cambiar a "Libre" cuando
    // necesite posicionamiento absoluto.
    layout: { ...DEFAULT_STACK_LAYOUT },
    children: [],
  };
}

export function newTextLayer(centerX: number, centerY: number): TextLayer {
  const w = 360;
  const h = 80;
  return {
    id: uid(),
    type: "text",
    name: "Texto",
    position: { x: centerX - w / 2, y: centerY - h / 2 },
    size: { w, h },
    content: "Texto",
    style: {
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 48,
      fontWeight: 600,
      color: "#111111",
      lineHeight: 1.2,
      align: "left",
    },
  };
}

export function newImageLayer(centerX: number, centerY: number): ImageLayer {
  const w = 320;
  const h = 320;
  return {
    id: uid(),
    type: "image",
    name: "Imagen",
    position: { x: centerX - w / 2, y: centerY - h / 2 },
    size: { w, h },
    src: null,
    fit: "cover",
  };
}

export function newShapeLayer(centerX: number, centerY: number): ShapeLayer {
  const w = 200;
  const h = 200;
  return {
    id: uid(),
    type: "shape",
    name: "Forma",
    position: { x: centerX - w / 2, y: centerY - h / 2 },
    size: { w, h },
    shape: "rect",
    fill: "#3b82f6",
    cornerRadius: 8,
  };
}

// ---------- Tree helpers ----------

// Find a layer by id anywhere in the tree.
export function findLayer(root: TemplateDefinition, id: string): TemplateLayer | null {
  if (root.id === id) return root;
  return findInChildren(root.children, id);
}

function findInChildren(children: TemplateLayer[], id: string): TemplateLayer | null {
  for (const child of children) {
    if (child.id === id) return child;
    if (child.type === "frame") {
      const inner = findInChildren(child.children, id);
      if (inner) return inner;
    }
  }
  return null;
}

// Find the parent frame of a layer, or null if not found / is root.
export function findParent(
  root: TemplateDefinition,
  id: string
): FrameLayer | null {
  if (root.id === id) return null;
  return findParentInChildren(root, root.children, id);
}

function findParentInChildren(
  parent: FrameLayer,
  children: TemplateLayer[],
  id: string
): FrameLayer | null {
  for (const child of children) {
    if (child.id === id) return parent;
    if (child.type === "frame") {
      const inner = findParentInChildren(child, child.children, id);
      if (inner) return inner;
    }
  }
  return null;
}

// Immutable update: replace a layer in the tree with the result of `mutator`.
// Returns a fresh tree.
export function updateLayer(
  root: TemplateDefinition,
  id: string,
  mutator: (layer: TemplateLayer) => TemplateLayer
): TemplateDefinition {
  if (root.id === id) {
    const updated = mutator(root);
    // Root must remain a frame
    if (updated.type !== "frame") return root;
    return updated;
  }
  return {
    ...root,
    children: updateInChildren(root.children, id, mutator),
  };
}

function updateInChildren(
  children: TemplateLayer[],
  id: string,
  mutator: (layer: TemplateLayer) => TemplateLayer
): TemplateLayer[] {
  return children.map((child) => {
    if (child.id === id) return mutator(child);
    if (child.type === "frame") {
      return { ...child, children: updateInChildren(child.children, id, mutator) };
    }
    return child;
  });
}

// Immutable insert: add a layer as the last child of a target frame.
export function addLayerToFrame(
  root: TemplateDefinition,
  frameId: string,
  layer: TemplateLayer
): TemplateDefinition {
  if (root.id === frameId) {
    return { ...root, children: [...root.children, layer] };
  }
  return {
    ...root,
    children: addToFrameInChildren(root.children, frameId, layer),
  };
}


function addToFrameInChildren(
  children: TemplateLayer[],
  frameId: string,
  layer: TemplateLayer
): TemplateLayer[] {
  return children.map((child) => {
    if (child.id === frameId && child.type === "frame") {
      return { ...child, children: [...child.children, layer] };
    }
    if (child.type === "frame") {
      return { ...child, children: addToFrameInChildren(child.children, frameId, layer) };
    }
    return child;
  });
}

// Immutable delete: remove a layer by id from anywhere in the tree.
// Root cannot be deleted.
export function deleteLayer(root: TemplateDefinition, id: string): TemplateDefinition {
  if (root.id === id) return root;
  return {
    ...root,
    children: deleteInChildren(root.children, id),
  };
}

function deleteInChildren(children: TemplateLayer[], id: string): TemplateLayer[] {
  return children
    .filter((c) => c.id !== id)
    .map((c) => (c.type === "frame" ? { ...c, children: deleteInChildren(c.children, id) } : c));
}

// Clone a layer (and its subtree, for frames) with freshly generated IDs.
// Used by duplicate / paste so the new layers don't collide with the originals.
export function cloneWithNewIds(layer: TemplateLayer): TemplateLayer {
  const newId = (() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  })();
  if (layer.type === "frame") {
    return {
      ...layer,
      id: newId,
      children: layer.children.map(cloneWithNewIds),
    };
  }
  return { ...layer, id: newId };
}

// Flatten the tree to a list (depth-first), excluding root. Used for the layers panel.
export interface FlatLayer {
  layer: TemplateLayer;
  depth: number;
}

// Order parameter:
//   - "paint" (default): document order — first child first, last child last.
//     Matches the array order and z-order from bottom to top.
//   - "panel": reverse — last child first. Matches Figma's layers panel
//     convention where the row at the top of the panel is the one painted on
//     top of the canvas. Children of each frame are also reversed so a frame's
//     topmost child appears right under it.
export function flattenLayers(
  root: TemplateDefinition,
  order: "paint" | "panel" = "paint",
): FlatLayer[] {
  const out: FlatLayer[] = [];
  const walk = (nodes: TemplateLayer[], depth: number) => {
    const list = order === "panel" ? [...nodes].reverse() : nodes;
    for (const n of list) {
      out.push({ layer: n, depth });
      if (n.type === "frame") walk(n.children, depth + 1);
    }
  };
  walk(root.children, 0);
  return out;
}
