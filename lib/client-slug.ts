// Slug de cliente: llave compartida con practicante (Client.slug allá). Los
// nombres no coinciden entre plataformas, así que la relación va por acá.
export const CLIENT_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// "" o null → null (sin slug). Devuelve undefined si es inválido.
export function normalizeClientSlug(v: unknown): string | null | undefined {
  if (v == null) return null;
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  if (s === "") return null;
  return CLIENT_SLUG_RE.test(s) ? s : undefined;
}

export const CLIENT_SLUG_ERROR =
  "Slug inválido: solo minúsculas, números, guion y guion bajo (máx. 64), igual al de practicante";
