import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Single-admin authentication.
 *
 * - The admin signs in with ADMIN_PASSWORD (env var).
 * - On success we set a signed, HttpOnly cookie. It is stateless (HMAC-signed
 *   with SESSION_SECRET), so it works on serverless hosts like Netlify
 *   Functions where there is no shared memory between invocations.
 * - Fail closed: if ADMIN_PASSWORD or SESSION_SECRET is missing, nobody can be
 *   admin.
 */

export const COOKIE_NAME = "wl_admin";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function secrets(): { password: string; key: string } | null {
  const password = process.env.ADMIN_PASSWORD;
  const session = process.env.SESSION_SECRET;
  if (!password || !session) return null;
  // Mixing the password into the key means changing ADMIN_PASSWORD
  // immediately invalidates every existing admin session.
  return { password, key: `${session}:${password}` };
}

export function isAuthConfigured(): boolean {
  return secrets() !== null;
}

function sha256(value: string): Buffer {
  return crypto.createHash("sha256").update(value).digest();
}

export function passwordMatches(candidate: string): boolean {
  const s = secrets();
  if (!s) return false;
  return crypto.timingSafeEqual(sha256(candidate), sha256(s.password));
}

function sign(payload: string, key: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

export function createSessionToken(now = Date.now()): string | null {
  const s = secrets();
  if (!s) return null;
  const payload = Buffer.from(
    JSON.stringify({ r: "admin", exp: now + SESSION_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload, s.key)}`;
}

export function verifySessionToken(token: unknown, now = Date.now()): boolean {
  const s = secrets();
  if (!s || typeof token !== "string") return false;
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return false;

  const expected = sign(payload, s.key);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data?.r === "admin" && typeof data.exp === "number" && data.exp > now;
  } catch {
    return false;
  }
}

export function isAdminRequest(req: Request): boolean {
  return verifySessionToken(req.cookies?.[COOKIE_NAME]);
}

export function isSecureRequest(req: Request): boolean {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

/** Express middleware: only the admin may continue. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (isAdminRequest(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "Admin sign-in required" });
}
