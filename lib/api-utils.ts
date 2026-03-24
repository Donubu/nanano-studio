import { NextRequest, NextResponse } from "next/server";
import { z, ZodSchema } from "zod";

/**
 * Parse and validate request JSON body with Zod.
 * Returns { data } on success or { error: NextResponse } on failure.
 */
export async function parseBody<T>(
  request: NextRequest,
  schema: ZodSchema<T>
): Promise<{ data: T; error?: never } | { data?: never; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      error: NextResponse.json(
        { error: "JSON inválido en el cuerpo de la petición" },
        { status: 400 }
      ),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const firstError = result.error.issues[0];
    const path = firstError.path.length > 0 ? `${firstError.path.join(".")}: ` : "";
    return {
      error: NextResponse.json(
        { error: `${path}${firstError.message}` },
        { status: 400 }
      ),
    };
  }

  return { data: result.data };
}

/**
 * Extract pagination params from search params.
 * Returns limit and offset. If no limit is provided, returns null (no pagination).
 */
export function getPagination(searchParams: URLSearchParams): {
  limit: number | null;
  offset: number;
} {
  const rawLimit = searchParams.get("limit");
  if (!rawLimit) return { limit: null, offset: 0 };

  const limit = Math.min(Math.max(Number(rawLimit) || 50, 1), 500);
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);
  return { limit, offset };
}

/**
 * Build pagination metadata for response.
 */
export function paginationMeta(total: number, limit: number, offset: number) {
  return { total, limit, offset, hasMore: offset + limit < total };
}
