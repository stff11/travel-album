import { Router, type IRouter } from "express";
import {
  COOKIE_NAME,
  SESSION_TTL_MS,
  createSessionToken,
  isAdminRequest,
  isAuthConfigured,
  isSecureRequest,
  passwordMatches,
} from "../lib/auth";

const router: IRouter = Router();

// Best-effort brute-force throttle. On serverless this only lives as long as
// a warm instance, so it slows attacks down rather than stopping them; the
// real protection is a long random ADMIN_PASSWORD.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const failures = new Map<string, { count: number; first: number }>();

function clientKey(req: import("express").Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0];
  return (first ?? req.ip ?? "unknown").trim();
}

function isThrottled(key: string): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function recordFailure(key: string): void {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    failures.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

router.get("/auth/me", (req, res): void => {
  res.set("Cache-Control", "no-store");
  res.json({ isAdmin: isAdminRequest(req), configured: isAuthConfigured() });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");

  if (!isAuthConfigured()) {
    res.status(503).json({
      error: "Admin login is not configured (set ADMIN_PASSWORD and SESSION_SECRET)",
    });
    return;
  }

  const key = clientKey(req);
  if (isThrottled(key)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }

  const password = req.body?.password;
  if (typeof password !== "string" || password.length === 0 || password.length > 512) {
    res.status(400).json({ error: "Password required" });
    return;
  }

  if (!passwordMatches(password)) {
    recordFailure(key);
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  failures.delete(key);
  res.cookie(COOKIE_NAME, createSessionToken()!, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
  res.json({ isAdmin: true });
});

router.post("/auth/logout", (req, res): void => {
  res.set("Cache-Control", "no-store");
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/",
  });
  res.json({ isAdmin: false });
});

export default router;
