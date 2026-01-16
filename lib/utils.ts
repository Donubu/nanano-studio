import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const MONTH_NAMES = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Parsea una fecha de MySQL a sus componentes
 * Las fechas vienen sin indicador de timezone, se muestran tal cual
 */
function parseDateComponents(dateString: string | Date): { year: string; month: string; day: string; hour: string; minute: string } {
  if (dateString instanceof Date) {
    return {
      year: dateString.getFullYear().toString(),
      month: (dateString.getMonth() + 1).toString().padStart(2, "0"),
      day: dateString.getDate().toString().padStart(2, "0"),
      hour: dateString.getHours().toString().padStart(2, "0"),
      minute: dateString.getMinutes().toString().padStart(2, "0"),
    };
  }

  const str = String(dateString);
  const [datePart, timePart] = str.includes("T") ? str.split("T") : str.split(" ");
  const [year, month, day] = datePart.split("-");
  const [hour, minute] = (timePart || "00:00:00").split(":");

  return { year, month, day, hour, minute };
}

/**
 * Formatea una fecha de la BD sin conversión de timezone
 * Las fechas de MySQL ya vienen en hora Chile
 * @param dateString - Fecha en formato string (de MySQL o ISO)
 * @param options - Opciones de formato
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

  const { year, month, day, hour, minute } = parseDateComponents(dateString);
  const monthName = MONTH_NAMES[parseInt(month)] || month;

  // Construir formato según opciones
  let result = `${day} ${monthName} ${year}`;

  if (options.hour !== undefined) {
    result += `, ${hour}:${minute}`;
  }

  return result;
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
