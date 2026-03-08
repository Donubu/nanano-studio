/**
 * Kling AI authentication via JWT (HS256)
 * Shared by kling-video.ts and kling-image.ts
 */

import { SignJWT } from "jose";

const KLING_API_BASE = "https://api-singapore.klingai.com";

// Token cache (valid for 30 min, refresh at 25 min)
let cachedToken: string | null = null;
let tokenExpiry = 0;

export { KLING_API_BASE };

export function isKlingConfigured(): boolean {
  return !!(process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY);
}

export async function getKlingAuthToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid (with 5-min buffer)
  if (cachedToken && tokenExpiry > now + 300) {
    return cachedToken;
  }

  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;

  if (!accessKey || !secretKey) {
    throw new Error("KLING_ACCESS_KEY and KLING_SECRET_KEY are required");
  }

  const secret = new TextEncoder().encode(secretKey);

  const token = await new SignJWT({
    iss: accessKey,
    nbf: now - 5,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(now + 1800)
    .setIssuedAt(now)
    .sign(secret);

  cachedToken = token;
  tokenExpiry = now + 1800;

  return token;
}
