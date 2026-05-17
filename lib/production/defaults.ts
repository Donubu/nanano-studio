// Default template composition used when creating a new production template.
// The shape mirrors the planned editor schema: a root frame with no children.
// Fields used downstream (editor, renderer):
//   - `type`: "frame" | "text" | "image" | "shape"
//   - `size.w/h`: numbers for fixed, or "auto" for content-driven
//   - `layout`: "free" | "stack" (with direction/padding/gap/align/justify)
//   - `constraints`: { h: "left"|"center"|"right"|"stretch", v: "top"|"center"|"bottom"|"stretch" }
//   - tokens with {brand.x} or {var.x} are resolved at render time
// Default master = 16:9 horizontal (1920×1080). El productor parte de un
// único formato y va agregando variantes (cuadrado, vertical, custom) según
// las necesidades del proyecto.
export const DEFAULT_TEMPLATE_DEFINITION = {
  id: "tpl_root",
  type: "frame" as const,
  size: { w: 1920, h: 1080 },
  background: { type: "color", value: "#ffffff" },
  layout: { mode: "free" as const },
  children: [] as unknown[],
};

export const DEFAULT_TEMPLATE_WIDTH = 1920;
export const DEFAULT_TEMPLATE_HEIGHT = 1080;
