import { describe, it, expect } from "vitest";
import { z } from "zod";
import { getPagination, paginationMeta } from "@/lib/api-utils";

// parseBody requires NextRequest which needs a full server environment,
// so we test the Zod integration logic directly here.

describe("getPagination", () => {
  it("returns null limit when no limit param", () => {
    const params = new URLSearchParams();
    expect(getPagination(params)).toEqual({ limit: null, offset: 0 });
  });

  it("parses limit and offset", () => {
    const params = new URLSearchParams("limit=50&offset=100");
    expect(getPagination(params)).toEqual({ limit: 50, offset: 100 });
  });

  it("caps limit at 500", () => {
    const params = new URLSearchParams("limit=9999");
    expect(getPagination(params)).toEqual({ limit: 500, offset: 0 });
  });

  it("floors limit at 1", () => {
    const params = new URLSearchParams("limit=-5");
    expect(getPagination(params)).toEqual({ limit: 1, offset: 0 });
  });

  it("defaults to 50 for non-numeric limit", () => {
    const params = new URLSearchParams("limit=abc");
    expect(getPagination(params)).toEqual({ limit: 50, offset: 0 });
  });

  it("floors offset at 0", () => {
    const params = new URLSearchParams("limit=10&offset=-20");
    expect(getPagination(params)).toEqual({ limit: 10, offset: 0 });
  });
});

describe("paginationMeta", () => {
  it("returns hasMore true when more items exist", () => {
    expect(paginationMeta(100, 20, 0)).toEqual({
      total: 100,
      limit: 20,
      offset: 0,
      hasMore: true,
    });
  });

  it("returns hasMore false on last page", () => {
    expect(paginationMeta(100, 20, 80)).toEqual({
      total: 100,
      limit: 20,
      offset: 80,
      hasMore: false,
    });
  });

  it("returns hasMore false when offset + limit equals total", () => {
    expect(paginationMeta(40, 20, 20)).toEqual({
      total: 40,
      limit: 20,
      offset: 20,
      hasMore: false,
    });
  });

  it("returns hasMore false for empty results", () => {
    expect(paginationMeta(0, 20, 0)).toEqual({
      total: 0,
      limit: 20,
      offset: 0,
      hasMore: false,
    });
  });
});

describe("Zod schema validation patterns", () => {
  const userSchema = z.object({
    email: z.string().email("Email inválido"),
    name: z.string().max(255).nullable().optional(),
    role: z.enum(["admin", "user"]).default("user"),
  });

  it("validates correct input", () => {
    const result = userSchema.safeParse({ email: "test@example.com" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("user");
    }
  });

  it("rejects invalid email", () => {
    const result = userSchema.safeParse({ email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = userSchema.safeParse({ email: "a@b.com", role: "superadmin" });
    expect(result.success).toBe(false);
  });

  it("applies defaults", () => {
    const result = userSchema.safeParse({ email: "a@b.com" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("user");
      expect(result.data.name).toBeUndefined();
    }
  });

  it("rejects non-object input", () => {
    const result = userSchema.safeParse("string");
    expect(result.success).toBe(false);
  });

  it("rejects null input", () => {
    const result = userSchema.safeParse(null);
    expect(result.success).toBe(false);
  });
});
