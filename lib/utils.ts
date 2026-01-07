import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Convierte una fecha de la BD (UTC) a objeto Date
 * @param dateString - Fecha en formato string (de MySQL o ISO)
 */
function parseUTCDate(dateString: string | Date): Date {
  if (dateString instanceof Date) {
    return dateString;
  }

  // Las fechas de la BD vienen en UTC sin indicador de zona
  // Verificar si ya tiene indicador de zona horaria (Z o +/-HH:MM al final)
  const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(dateString);

  if (hasTimezone) {
    return new Date(dateString);
  } else {
    // Agregar 'Z' para indicar que es UTC
    return new Date(dateString.replace(' ', 'T') + 'Z');
  }
}

/**
 * Formatea una fecha de la BD (UTC) a la zona horaria local
 * @param dateString - Fecha en formato string (de MySQL o ISO)
 * @param options - Opciones de formato (default: fecha corta)
 */
export function formatDateLocal(
  dateString: string | Date,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }
): string {
  if (!dateString) return "";

  const date = parseUTCDate(dateString);

  // Usar timeZone explícito para Chile
  return date.toLocaleDateString("es-CL", {
    ...options,
    timeZone: "America/Santiago",
  });
}

/**
 * Formatea una fecha con hora
 */
export function formatDateTimeLocal(dateString: string | Date): string {
  return formatDateLocal(dateString, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
