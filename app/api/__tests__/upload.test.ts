import { describe, it, expect } from "vitest";
import path from "path";

// Test the validation logic used in the upload endpoint without needing Next.js runtime.
// These mirror the checks in app/api/upload/route.ts.

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
];

const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "svg", "pdf"];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

function validateUpload(file: { name: string; type: string; size: number }): string | null {
  if (file.size > MAX_FILE_SIZE) return "Archivo demasiado grande (máximo 20MB)";
  if (!ALLOWED_TYPES.includes(file.type)) return "Tipo de archivo no permitido";
  const ext = path.extname(file.name).toLowerCase().slice(1);
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) return "Extensión de archivo no permitida";
  return null;
}

describe("Upload validation", () => {
  it("accepts valid JPEG upload", () => {
    expect(validateUpload({ name: "photo.jpg", type: "image/jpeg", size: 1024 })).toBeNull();
  });

  it("accepts valid PNG upload", () => {
    expect(validateUpload({ name: "image.png", type: "image/png", size: 5000 })).toBeNull();
  });

  it("accepts valid PDF upload", () => {
    expect(validateUpload({ name: "doc.pdf", type: "application/pdf", size: 10000 })).toBeNull();
  });

  it("accepts valid SVG upload", () => {
    expect(validateUpload({ name: "icon.svg", type: "image/svg+xml", size: 500 })).toBeNull();
  });

  it("rejects oversized file", () => {
    expect(validateUpload({ name: "big.jpg", type: "image/jpeg", size: 25 * 1024 * 1024 }))
      .toBe("Archivo demasiado grande (máximo 20MB)");
  });

  it("accepts file at exactly 20MB", () => {
    expect(validateUpload({ name: "max.jpg", type: "image/jpeg", size: MAX_FILE_SIZE })).toBeNull();
  });

  it("rejects executable file type", () => {
    expect(validateUpload({ name: "virus.exe", type: "application/x-msdownload", size: 1024 }))
      .toBe("Tipo de archivo no permitido");
  });

  it("rejects shell script", () => {
    expect(validateUpload({ name: "script.sh", type: "application/x-sh", size: 100 }))
      .toBe("Tipo de archivo no permitido");
  });

  it("rejects HTML file", () => {
    expect(validateUpload({ name: "page.html", type: "text/html", size: 500 }))
      .toBe("Tipo de archivo no permitido");
  });

  it("rejects file with no extension", () => {
    expect(validateUpload({ name: "noextension", type: "image/jpeg", size: 1024 }))
      .toBe("Extensión de archivo no permitida");
  });

  it("rejects mismatched extension even with valid MIME", () => {
    expect(validateUpload({ name: "image.exe", type: "image/jpeg", size: 1024 }))
      .toBe("Extensión de archivo no permitida");
  });

  it("handles case-insensitive extensions", () => {
    expect(validateUpload({ name: "photo.JPG", type: "image/jpeg", size: 1024 })).toBeNull();
    expect(validateUpload({ name: "image.PNG", type: "image/png", size: 1024 })).toBeNull();
  });

  it("rejects ZIP file", () => {
    expect(validateUpload({ name: "archive.zip", type: "application/zip", size: 1024 }))
      .toBe("Tipo de archivo no permitido");
  });

  it("rejects JavaScript file", () => {
    expect(validateUpload({ name: "app.js", type: "application/javascript", size: 100 }))
      .toBe("Tipo de archivo no permitido");
  });
});

describe("SSRF protection (Topaz upload URL validation)", () => {
  function validateTopazUrl(uploadUrl: string): string | null {
    try {
      const url = new URL(uploadUrl);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".amazonaws.com")) {
        return "URL de upload no válida";
      }
    } catch {
      return "URL de upload malformada";
    }
    return null;
  }

  it("accepts valid S3 URL", () => {
    expect(validateTopazUrl("https://my-bucket.s3.amazonaws.com/path/to/file")).toBeNull();
  });

  it("accepts S3 URL with region", () => {
    expect(validateTopazUrl("https://bucket.s3.us-east-1.amazonaws.com/key")).toBeNull();
  });

  it("rejects localhost", () => {
    expect(validateTopazUrl("http://localhost:6379/")).toBe("URL de upload no válida");
  });

  it("rejects internal IPs", () => {
    expect(validateTopazUrl("http://127.0.0.1:3306/")).toBe("URL de upload no válida");
  });

  it("rejects GCP metadata endpoint", () => {
    expect(validateTopazUrl("http://169.254.169.254/latest/meta-data/")).toBe("URL de upload no válida");
  });

  it("rejects non-HTTPS S3 URL", () => {
    expect(validateTopazUrl("http://bucket.s3.amazonaws.com/key")).toBe("URL de upload no válida");
  });

  it("rejects non-AWS domain", () => {
    expect(validateTopazUrl("https://evil.com/steal-data")).toBe("URL de upload no válida");
  });

  it("rejects malformed URL", () => {
    expect(validateTopazUrl("not-a-url")).toBe("URL de upload malformada");
  });

  it("rejects empty string", () => {
    expect(validateTopazUrl("")).toBe("URL de upload malformada");
  });
});
