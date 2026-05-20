// Curated list of popular Google Fonts available for the brand kit editor.
// Not exhaustive: ~80 of the most-used families covering sans-serif, serif,
// display, handwriting and monospace. If a designer needs something not on
// this list, the brand kit editor still allows typing a custom CSS string.

export type FontCategory =
  | "sans-serif"
  | "serif"
  | "display"
  | "handwriting"
  | "monospace";

export interface GoogleFont {
  family: string;
  category: FontCategory;
  // Weights we'll request from Google Fonts when the file is loaded. Keep this
  // tight: requesting all 9 weights for every picked font would bloat the
  // editor.
  weights: number[];
}

export const GOOGLE_FONTS: GoogleFont[] = [
  // Sans-serif (most common workhorses)
  { family: "Inter", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800] },
  { family: "Roboto", category: "sans-serif", weights: [300, 400, 500, 700, 900] },
  { family: "Open Sans", category: "sans-serif", weights: [300, 400, 600, 700, 800] },
  { family: "Lato", category: "sans-serif", weights: [300, 400, 700, 900] },
  { family: "Montserrat", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: "Poppins", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: "Nunito", category: "sans-serif", weights: [300, 400, 600, 700, 800, 900] },
  { family: "Nunito Sans", category: "sans-serif", weights: [300, 400, 600, 700, 800, 900] },
  { family: "Raleway", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800] },
  { family: "Work Sans", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800] },
  { family: "DM Sans", category: "sans-serif", weights: [400, 500, 700] },
  { family: "Manrope", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800] },
  { family: "Plus Jakarta Sans", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800] },
  { family: "Outfit", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: "Sora", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800] },
  { family: "Be Vietnam Pro", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800] },
  { family: "Mulish", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: "Karla", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800] },
  { family: "Public Sans", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: "IBM Plex Sans", category: "sans-serif", weights: [300, 400, 500, 600, 700] },
  { family: "Source Sans 3", category: "sans-serif", weights: [300, 400, 600, 700, 900] },
  { family: "PT Sans", category: "sans-serif", weights: [400, 700] },
  { family: "Ubuntu", category: "sans-serif", weights: [300, 400, 500, 700] },
  { family: "Fira Sans", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800] },
  { family: "Quicksand", category: "sans-serif", weights: [300, 400, 500, 600, 700] },
  { family: "Rubik", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: "Barlow", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800] },
  { family: "Oswald", category: "sans-serif", weights: [300, 400, 500, 600, 700] },
  { family: "Archivo", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: "Hind", category: "sans-serif", weights: [300, 400, 500, 600, 700] },
  { family: "Cabin", category: "sans-serif", weights: [400, 500, 600, 700] },
  { family: "Asap", category: "sans-serif", weights: [400, 500, 600, 700, 800] },
  { family: "Heebo", category: "sans-serif", weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: "Anton", category: "sans-serif", weights: [400] },
  { family: "Bebas Neue", category: "sans-serif", weights: [400] },
  { family: "Space Grotesk", category: "sans-serif", weights: [300, 400, 500, 600, 700] },

  // Serif
  { family: "Playfair Display", category: "serif", weights: [400, 500, 600, 700, 800, 900] },
  { family: "Merriweather", category: "serif", weights: [300, 400, 700, 900] },
  { family: "Lora", category: "serif", weights: [400, 500, 600, 700] },
  { family: "PT Serif", category: "serif", weights: [400, 700] },
  { family: "Source Serif 4", category: "serif", weights: [300, 400, 600, 700, 900] },
  { family: "Roboto Slab", category: "serif", weights: [300, 400, 500, 700, 900] },
  { family: "Cormorant Garamond", category: "serif", weights: [300, 400, 500, 600, 700] },
  { family: "EB Garamond", category: "serif", weights: [400, 500, 600, 700, 800] },
  { family: "Libre Baskerville", category: "serif", weights: [400, 700] },
  { family: "Bitter", category: "serif", weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: "Crimson Text", category: "serif", weights: [400, 600, 700] },
  { family: "Domine", category: "serif", weights: [400, 500, 600, 700] },
  { family: "Spectral", category: "serif", weights: [300, 400, 500, 600, 700, 800] },
  { family: "Cardo", category: "serif", weights: [400, 700] },
  { family: "IBM Plex Serif", category: "serif", weights: [300, 400, 500, 600, 700] },
  { family: "Frank Ruhl Libre", category: "serif", weights: [300, 400, 500, 700, 900] },
  { family: "Tinos", category: "serif", weights: [400, 700] },
  { family: "Vollkorn", category: "serif", weights: [400, 500, 600, 700, 800, 900] },
  { family: "Cormorant", category: "serif", weights: [300, 400, 500, 600, 700] },

  // Display
  { family: "Abril Fatface", category: "display", weights: [400] },
  { family: "Archivo Black", category: "display", weights: [400] },
  { family: "Lobster", category: "display", weights: [400] },
  { family: "Pacifico", category: "display", weights: [400] },
  { family: "Righteous", category: "display", weights: [400] },
  { family: "Comfortaa", category: "display", weights: [300, 400, 500, 600, 700] },
  { family: "Russo One", category: "display", weights: [400] },
  { family: "Permanent Marker", category: "display", weights: [400] },
  { family: "Fredoka", category: "display", weights: [300, 400, 500, 600, 700] },
  { family: "Chivo", category: "display", weights: [300, 400, 500, 600, 700, 800, 900] },
  { family: "Bungee", category: "display", weights: [400] },
  { family: "Alfa Slab One", category: "display", weights: [400] },
  { family: "Black Ops One", category: "display", weights: [400] },
  { family: "Press Start 2P", category: "display", weights: [400] },

  // Handwriting
  { family: "Dancing Script", category: "handwriting", weights: [400, 500, 600, 700] },
  { family: "Caveat", category: "handwriting", weights: [400, 500, 600, 700] },
  { family: "Satisfy", category: "handwriting", weights: [400] },
  { family: "Great Vibes", category: "handwriting", weights: [400] },
  { family: "Shadows Into Light", category: "handwriting", weights: [400] },
  { family: "Indie Flower", category: "handwriting", weights: [400] },
  { family: "Kalam", category: "handwriting", weights: [300, 400, 700] },
  { family: "Sacramento", category: "handwriting", weights: [400] },
  { family: "Amatic SC", category: "handwriting", weights: [400, 700] },

  // Monospace
  { family: "JetBrains Mono", category: "monospace", weights: [300, 400, 500, 600, 700, 800] },
  { family: "Fira Code", category: "monospace", weights: [300, 400, 500, 600, 700] },
  { family: "Source Code Pro", category: "monospace", weights: [300, 400, 500, 600, 700, 900] },
  { family: "Roboto Mono", category: "monospace", weights: [300, 400, 500, 600, 700] },
  { family: "IBM Plex Mono", category: "monospace", weights: [300, 400, 500, 600, 700] },
  { family: "Space Mono", category: "monospace", weights: [400, 700] },
  { family: "Inconsolata", category: "monospace", weights: [300, 400, 500, 600, 700, 800, 900] },
];

const FALLBACK_BY_CATEGORY: Record<FontCategory, string> = {
  "sans-serif": "system-ui, sans-serif",
  serif: "Georgia, serif",
  display: "Impact, sans-serif",
  handwriting: "cursive",
  monospace: "ui-monospace, Menlo, monospace",
};

const FAMILY_INDEX = new Map(GOOGLE_FONTS.map((f) => [f.family.toLowerCase(), f]));

// Build a usable CSS font-family value for a Google Font, appending a
// reasonable fallback so partial-load states still look sane.
export function fontFamilyCss(family: string): string {
  const font = FAMILY_INDEX.get(family.toLowerCase());
  const fallback = font ? FALLBACK_BY_CATEGORY[font.category] : "system-ui, sans-serif";
  // Quote families that contain spaces or non-word characters.
  const quoted = /[^a-zA-Z0-9-]/.test(family) ? `"${family}"` : family;
  return `${quoted}, ${fallback}`;
}

// Parse a stored CSS font-family value back to the primary family name so the
// picker can highlight the right row.
export function primaryFamilyName(css: string): string {
  const first = css.split(",")[0]?.trim() ?? "";
  return first.replace(/^['"]|['"]$/g, "");
}

// Find a Google Font from any CSS font-family string by matching its primary
// name against the curated list.
export function findGoogleFont(css: string): GoogleFont | null {
  const name = primaryFamilyName(css);
  if (!name) return null;
  return FAMILY_INDEX.get(name.toLowerCase()) ?? null;
}

const loadedFonts = new Set<string>();

// Inject a <link rel="stylesheet"> for the requested Google Font so the
// editor preview renders the correct typeface. Safe to call repeatedly:
// already-loaded families are tracked in a module-level set and the linkId
// guard avoids duplicate tags across hot reloads.
export function ensureGoogleFontLoaded(familyOrCss: string): void {
  if (typeof document === "undefined") return;
  const name = primaryFamilyName(familyOrCss);
  if (!name) return;
  const font = FAMILY_INDEX.get(name.toLowerCase());
  if (!font) return;
  if (loadedFonts.has(font.family)) return;

  const linkId = `gfont-${font.family.replace(/\s+/g, "-")}`;
  if (typeof document !== "undefined" && document.getElementById(linkId)) {
    loadedFonts.add(font.family);
    return;
  }

  const familyParam = font.family.replace(/\s+/g, "+");
  const weights = font.weights.length > 0 ? font.weights.join(";") : "400";
  const href = `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${weights}&display=swap`;

  const link = document.createElement("link");
  link.id = linkId;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
  loadedFonts.add(font.family);
}
