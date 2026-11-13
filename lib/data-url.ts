// Separa un data URL ("data:<mime>;base64,<datos>") sin expresiones regulares.
// Una regex sobre un string de varios MB (una imagen de 5 MB son ~7 millones
// de caracteres en base64) desbordaba la pila dentro del servidor de Next
// ("Maximum call stack size exceeded") y la subida fallaba con 500.

export interface DataUrlParts {
  mimeType: string;
  base64: string;
}

export function parseDataUrl(value: string): DataUrlParts | null {
  if (!value.startsWith("data:")) return null;
  const marker = ";base64,";
  // El encabezado es corto: no hace falta buscar en todo el string.
  const at = value.indexOf(marker, 5);
  if (at < 0 || at > 255) return null;
  const mimeType = value.slice(5, at);
  if (!mimeType || mimeType.includes(";") || mimeType.includes(",")) return null;
  const base64 = value.slice(at + marker.length);
  if (!base64) return null;
  return { mimeType, base64 };
}
