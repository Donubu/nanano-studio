import { describe, it, expect } from "vitest";
import { classifyError, createLogger } from "@/lib/logger";

describe("classifyError", () => {
  it("classifies content policy violations as non-retryable", () => {
    const cases = [
      "Response was blocked by safety filters",
      "Content was blocked due to policy violation",
      "Prompt was blocked by Responsible AI practices",
      "RECITATION detected in response",
      "sexually explicit content detected",
      "Content filter triggered",
    ];
    for (const msg of cases) {
      const result = classifyError(new Error(msg));
      expect(result.category, `"${msg}" should be content_policy`).toBe("content_policy");
      expect(result.retryable).toBe(false);
    }
  });

  it("classifies rate limits as transient and retryable", () => {
    const cases = [
      "429 Too Many Requests",
      "RESOURCE_EXHAUSTED: rate limit exceeded",
      "Rate limit reached for model",
      "503 Service Unavailable",
      "500 Internal Server Error",
    ];
    for (const msg of cases) {
      const result = classifyError(new Error(msg));
      expect(result.category, `"${msg}" should be transient`).toBe("transient");
      expect(result.retryable).toBe(true);
    }
  });

  it("classifies timeouts as retryable", () => {
    const cases = [
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "ECONNRESET",
      "socket hang up",
      "Request timeout after 600000ms",
    ];
    for (const msg of cases) {
      const result = classifyError(new Error(msg));
      expect(result.category, `"${msg}" should be timeout`).toBe("timeout");
      expect(result.retryable).toBe(true);
    }
  });

  it("classifies quota errors as non-retryable", () => {
    const cases = [
      "Quota exceeded for project",
      "Billing account not active",
    ];
    for (const msg of cases) {
      const result = classifyError(new Error(msg));
      expect(result.category, `"${msg}" should be quota`).toBe("quota");
      expect(result.retryable).toBe(false);
    }
  });

  it("classifies invalid requests as non-retryable", () => {
    const cases = [
      "400 Bad Request: invalid model parameter",
      "404 Model not found",
      "Unsupported image format",
    ];
    for (const msg of cases) {
      const result = classifyError(new Error(msg));
      expect(result.category, `"${msg}" should be invalid_request`).toBe("invalid_request");
      expect(result.retryable).toBe(false);
    }
  });

  it("classifies unknown errors as non-retryable", () => {
    const result = classifyError(new Error("Something completely unexpected"));
    expect(result.category).toBe("unknown");
    expect(result.retryable).toBe(false);
  });

  it("handles non-Error objects", () => {
    const result = classifyError("string error");
    expect(result.message).toBe("string error");
  });

  it("handles null/undefined", () => {
    const result = classifyError(null);
    expect(result.message).toBe("null");
  });
});

describe("createLogger", () => {
  it("creates logger with context", () => {
    const logger = createLogger({ worker: "test-worker" });
    expect(logger.info).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.child).toBeDefined();
    expect(logger.time).toBeDefined();
  });

  it("child logger inherits context", () => {
    const parent = createLogger({ worker: "w1" });
    const child = parent.child({ jobId: "j1" });
    // Just verify it doesn't throw
    child.info("test message", { extra: "data" });
  });

  it("time tracker measures duration", async () => {
    const logger = createLogger();
    const timer = logger.time("test_operation");
    await new Promise((r) => setTimeout(r, 50));
    const duration = timer.end();
    expect(duration).toBeGreaterThanOrEqual(40);
    expect(duration).toBeLessThan(200);
  });
});
