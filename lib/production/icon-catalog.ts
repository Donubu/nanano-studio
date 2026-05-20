// Catálogo curado de íconos lucide-react para usar en banners publicitarios.
// La lista completa de lucide (>1500 íconos) es ruido; este subset cubre los
// casos típicos: ecommerce, social, comunicación, transporte, multimedia,
// estados/UI. Si necesitas un ícono que no está acá, primero pregunta si
// vale agregarlo al catálogo (no agregues sin coordinar — el agente Banner
// Designer está limitado a esta lista exacta y agregar uno requiere
// actualizar BANNERS.md también).
//
// Cada entrada tiene un `name` (exact match con el export de lucide-react,
// PascalCase) y una `category` para agrupar en el selector visual.

export type IconCategory =
  | "ecommerce"
  | "social"
  | "communication"
  | "transport"
  | "media"
  | "ui"
  | "general";

export interface IconCatalogEntry {
  name: string;        // export name de lucide-react, ej. "ShoppingCart"
  category: IconCategory;
  label: string;       // español, para mostrar en tooltip
}

// 48 íconos curados. Cualquier cambio acá DEBE replicarse en BANNERS.md §5.7.
export const ICON_CATALOG: IconCatalogEntry[] = [
  // ecommerce
  { name: "ShoppingCart",   category: "ecommerce",     label: "Carrito" },
  { name: "ShoppingBag",    category: "ecommerce",     label: "Bolsa" },
  { name: "Tag",            category: "ecommerce",     label: "Etiqueta" },
  { name: "Percent",        category: "ecommerce",     label: "Porcentaje" },
  { name: "DollarSign",     category: "ecommerce",     label: "Dólar" },
  { name: "CreditCard",     category: "ecommerce",     label: "Tarjeta" },
  { name: "Gift",           category: "ecommerce",     label: "Regalo" },
  { name: "Truck",          category: "ecommerce",     label: "Envío" },
  // social
  { name: "Instagram",      category: "social",        label: "Instagram" },
  { name: "Facebook",       category: "social",        label: "Facebook" },
  { name: "Twitter",        category: "social",        label: "X / Twitter" },
  { name: "Youtube",        category: "social",        label: "YouTube" },
  { name: "Linkedin",       category: "social",        label: "LinkedIn" },
  { name: "Github",         category: "social",        label: "GitHub" },
  { name: "Heart",          category: "social",        label: "Me gusta" },
  { name: "Share2",         category: "social",        label: "Compartir" },
  // communication
  { name: "Mail",           category: "communication", label: "Email" },
  { name: "Phone",          category: "communication", label: "Teléfono" },
  { name: "MessageCircle",  category: "communication", label: "Mensaje" },
  { name: "Send",           category: "communication", label: "Enviar" },
  { name: "Bell",           category: "communication", label: "Notificación" },
  { name: "AtSign",         category: "communication", label: "Arroba" },
  // transport
  { name: "MapPin",         category: "transport",     label: "Ubicación" },
  { name: "Map",            category: "transport",     label: "Mapa" },
  { name: "Plane",          category: "transport",     label: "Avión" },
  { name: "Car",            category: "transport",     label: "Auto" },
  { name: "Bike",           category: "transport",     label: "Bicicleta" },
  // media
  { name: "Play",           category: "media",         label: "Play" },
  { name: "Pause",          category: "media",         label: "Pausa" },
  { name: "Music",          category: "media",         label: "Música" },
  { name: "Camera",         category: "media",         label: "Cámara" },
  { name: "Video",          category: "media",         label: "Video" },
  { name: "Image",          category: "media",         label: "Imagen" },
  { name: "Headphones",     category: "media",         label: "Audífonos" },
  // ui
  { name: "Check",          category: "ui",            label: "Check" },
  { name: "X",              category: "ui",            label: "Cerrar" },
  { name: "Plus",           category: "ui",            label: "Sumar" },
  { name: "Minus",          category: "ui",            label: "Restar" },
  { name: "ArrowRight",     category: "ui",            label: "Flecha derecha" },
  { name: "ArrowLeft",      category: "ui",            label: "Flecha izquierda" },
  { name: "ArrowUpRight",   category: "ui",            label: "Flecha diagonal" },
  { name: "ChevronRight",   category: "ui",            label: "Chevron derecha" },
  // general
  { name: "Star",           category: "general",       label: "Estrella" },
  { name: "Sparkles",       category: "general",       label: "Brillos" },
  { name: "Flame",          category: "general",       label: "Fuego" },
  { name: "Zap",            category: "general",       label: "Rayo" },
  { name: "Crown",          category: "general",       label: "Corona" },
  { name: "Award",          category: "general",       label: "Premio" },
  { name: "Clock",          category: "general",       label: "Reloj" },
];

export const ICON_NAMES = ICON_CATALOG.map((i) => i.name);

export function isValidIconName(name: string): boolean {
  return ICON_NAMES.includes(name);
}

export const ICON_CATEGORIES: { value: IconCategory; label: string }[] = [
  { value: "ecommerce",     label: "Ecommerce" },
  { value: "social",        label: "Social" },
  { value: "communication", label: "Comunicación" },
  { value: "transport",     label: "Transporte" },
  { value: "media",         label: "Multimedia" },
  { value: "ui",            label: "UI" },
  { value: "general",       label: "General" },
];
