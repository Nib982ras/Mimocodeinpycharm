import crypto from "crypto";
import fs from "fs";
import path from "path";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

/**
 * Authentication for the Secure Multi-Branch Document Exchange System.
 *
 * - Passwords hashed with scrypt (NIST-recommended, built into Node, no deps).
 * - Session = an httpOnly cookie containing a signed JWT-like token (HMAC-SHA256).
 * - Server helpers: getSession(), requireUser(), requireAdmin().
 *
 * Each USER account is tied to a branch (the department/section they operate
 * as). ADMIN accounts manage users, branches, and keys but don't belong to a
 * branch themselves.
 */

const SESSION_COOKIE = "secure-exchange-session";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days, in seconds
const SECRET_PATH = path.join(process.cwd(), "db", ".session-secret");

function getSecret(): string {
  if (!fs.existsSync(SECRET_PATH)) {
    const key = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
    fs.writeFileSync(SECRET_PATH, key, { mode: 0o600 });
  }
  return fs.readFileSync(SECRET_PATH, "utf8").trim();
}

// ---------- Password hashing (scrypt) ----------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  // constant-time comparison
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
}

// ---------- Session token (HMAC-signed, JWT-like) ----------

export interface SessionPayload {
  uid: string;
  username: string;
  role: string;
  branchId: string | null;
  branchCode: string | null;
  exp: number; // epoch seconds
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function createSessionToken(payload: Omit<SessionPayload, "exp">): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const full: SessionPayload = { ...payload, exp };
  const body = b64url(JSON.stringify(full));
  const sig = crypto.createHmac("sha256", getSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", getSecret()).update(body).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8")) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- Cookie helpers ----------

/**
 * Cookie attributes for the session.
 *
 * We always use `SameSite=none; Secure` because:
 *  - The app runs inside a cross-site iframe in the preview panel, which
 *    requires `SameSite=none` for cookies to be sent.
 *  - `SameSite=none` requires `Secure` in modern browsers.
 *  - Browsers treat `localhost` as a secure context, so `Secure` cookies are
 *    accepted even on plain HTTP localhost — meaning dev/testing still works.
 */
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "none" as const,
    secure: true,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  // Deleting with the same options ensures the browser matches the cookie.
  store.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

// ---------- Server-side session resolution ----------

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "USER";
  branchId: string | null;
  branch: { id: string; code: string; name: string; type: string } | null;
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const payload = verifySessionToken(token);
    if (!payload) return null;
    // Re-fetch the user to make sure they still exist (and pick up role/branch changes).
    const user = await db.user.findUnique({
      where: { id: payload.uid },
      include: { branch: { select: { id: true, code: true, name: true, type: true } } },
    });
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role as "ADMIN" | "USER",
      branchId: user.branchId,
      branch: user.branch,
    };
  } catch {
    return null;
  }
}

/** Throws a 401-shaped error if no session. Returns the user otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) {
    throw new AuthError("Authentication required", 401);
  }
  return user;
}

/** Throws a 403-shaped error if not an admin. Returns the admin user otherwise. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    throw new AuthError("Administrator access required", 403);
  }
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Convert an AuthError (or any error) into a JSON 401/403 NextResponse. */
export function authErrorResponse(err: unknown): Response | null {
  if (err instanceof AuthError) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: err.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
