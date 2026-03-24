/**
 * Structured logger for production monitoring.
 * - JSON output in production (parseable by Cloud Logging, Datadog, etc.)
 * - Readable output in development
 */

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function formatDev(entry: LogEntry): string {
  const { level, msg, ...rest } = entry;
  const prefix = { info: "INFO", warn: "WARN", error: "ERROR", debug: "DEBUG" }[level];
  const extras = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  return `[${prefix}] ${msg}${extras}`;
}

function emit(entry: LogEntry) {
  const output = IS_PRODUCTION ? JSON.stringify(entry) : formatDev(entry);
  if (entry.level === "error") {
    console.error(output);
  } else if (entry.level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export function createLogger(context: Record<string, unknown> = {}) {
  const log = (level: LogLevel, msg: string, data?: Record<string, unknown>) => {
    emit({ level, msg, ts: new Date().toISOString(), ...context, ...data });
  };

  return {
    info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
    error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
    debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
    /** Create a child logger with additional context */
    child: (extra: Record<string, unknown>) => createLogger({ ...context, ...extra }),
    /** Time an operation and log its duration */
    time: (label: string) => {
      const start = Date.now();
      return {
        end: (data?: Record<string, unknown>) => {
          const durationMs = Date.now() - start;
          log("info", label, { durationMs, ...data });
          return durationMs;
        },
      };
    },
  };
}

// ============================================
// ERROR CLASSIFICATION
// ============================================

export type ErrorCategory =
  | "transient"       // 429, 500, 503, 504, rate limit, network - will likely succeed on retry
  | "content_policy"  // Safety filters, blocked content, prohibited topics
  | "invalid_request" // Bad parameters, invalid model, missing fields
  | "timeout"         // Request/socket timeout
  | "quota"           // Billing quota exceeded (different from rate limit)
  | "unknown";

interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  statusCode?: number;
}

export function classifyError(error: unknown): ClassifiedError {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  // Extract status code if present
  const statusMatch = lower.match(/(\d{3})/);
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : undefined;

  // Content policy / safety violations (NOT retryable)
  if (
    lower.includes("safety") ||
    lower.includes("blocked") ||
    lower.includes("prohibited") ||
    lower.includes("recitation") ||
    lower.includes("policy") ||
    lower.includes("harm") ||
    lower.includes("dangerous") ||
    lower.includes("sexually explicit") ||
    lower.includes("hate speech") ||
    lower.includes("finish_reason") ||
    lower.includes("prompt was blocked") ||
    lower.includes("responsible ai") ||
    lower.includes("content filter")
  ) {
    return { category: "content_policy", message: msg, retryable: false, statusCode };
  }

  // Timeout errors (could retry but signal infrastructure issue)
  if (
    lower.includes("timeout") ||
    lower.includes("und_err_headers_timeout") ||
    lower.includes("und_err_body_timeout") ||
    lower.includes("econnreset") ||
    lower.includes("socket hang up")
  ) {
    return { category: "timeout", message: msg, retryable: true, statusCode };
  }

  // Quota exhausted (NOT retryable without billing action)
  if (
    lower.includes("quota") ||
    lower.includes("billing") ||
    lower.includes("payment required") ||
    (statusCode === 402)
  ) {
    return { category: "quota", message: msg, retryable: false, statusCode };
  }

  // Transient / rate limit errors (retryable)
  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("resource_exhausted") ||
    lower.includes("503") ||
    lower.includes("500") ||
    lower.includes("504") ||
    lower.includes("fetch failed") ||
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    (statusCode && [429, 500, 502, 503, 504].includes(statusCode))
  ) {
    return { category: "transient", message: msg, retryable: true, statusCode };
  }

  // Invalid request (NOT retryable)
  if (
    lower.includes("invalid") ||
    lower.includes("not found") ||
    lower.includes("400") ||
    lower.includes("404") ||
    lower.includes("unsupported") ||
    (statusCode && [400, 401, 403, 404, 422].includes(statusCode))
  ) {
    return { category: "invalid_request", message: msg, retryable: false, statusCode };
  }

  return { category: "unknown", message: msg, retryable: false, statusCode };
}

/** Singleton logger for general use */
export const logger = createLogger();
