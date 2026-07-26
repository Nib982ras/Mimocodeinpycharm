import crypto from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

/**
 * Authentication & authorization for the Secure Multi-Branch Document Exchange.
 *
 * Roles (least-privilege hierarchy):
 *   OWNER          — sole supreme authority (system kill, lockdown, key destruction)
 *   SECURITY_ADMIN — user/branch/key management + audit
 *   BRANCH_ADMIN   — manages their own branch's users
 *   USER           — sends/receives encrypted documents as their branch
 *   READONLY       — can view documents only
 *
 * Security properties:
 *  - Passwords hashed with scrypt (never plaintext).
 *  - Sessions are HMAC-signed JWT-like tokens in an httpOnly, SameSite=lax,
 *    Secure cookie. Each token carries a JTI that's tracked in the DB so
 *    sessions can be revoked (on suspension, lockdown, or logout).
 *  - Session fingerprinting binds sessions to IP + User-Agent.
 *  - 2FA via TOTP (RFC 6238) with backup codes.
 *  - System-state enforcement: when the system is deactivated or in lockdown,
 *    all non-owner logins and document transfers are blocked.
 */

export const SESSION_COOKIE = "secure-exchange-session";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days, in seconds

// Role rank for hierarchy checks (higher = more authority).
export const ROLE_RANK: Record<string, number> = {
  READONLY: 1,
  USER: 2,
  BRANCH_ADMIN: 3,
  SECURITY_ADMIN: 4,
  OWNER: 5,
};

export type Role = "OWNER" | "SECURITY_ADMIN" | "BRANCH_ADMIN" | "USER" | "READONLY";

/**
 * Retrieve the session signing secret (HMAC-SHA256 key).
 *
 * Priority:
 *   1. SESSION_SECRET environment variable (REQUIRED in production)
 *   2. Auto-generated ephemeral key (development only)
 *
 * In production, set SESSION_SECRET via your secrets manager:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
let _sessionSecret: string | null = null;

function getSecret(): string {
  if (_sessionSecret) return _sessionSecret;

  const envSecret = process.env.SESSION_SECRET;
  if (envSecret) {
    _sessionSecret = envSecret.trim();
    return _sessionSecret;
  }

  // Development-only fallback: ephemeral key (not persisted)
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET environment variable is required in production. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  console.warn("[auth] WARNING: Using ephemeral session secret — all sessions will be invalidated on restart. Set SESSION_SECRET for persistence.");
  _sessionSecret = crypto.randomBytes(32).toString("hex");
  return _sessionSecret;
}

// ---------- Password hashing (scrypt) ----------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64, { N: 65536, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64, { N: 65536, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
}

// ---------- Session token (HMAC-signed, JWT-like, with JTI + fingerprint) ----------

export interface SessionPayload {
  uid: string;
  username: string;
  role: string;
  branchId: string | null;
  branchCode: string | null;
  jti: string; // unique session id (for revocation)
  exp: number; // epoch seconds
  fp?: string; // optional session fingerprint for binding
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function createSessionToken(payload: Omit<SessionPayload, "exp" | "jti"> & { fingerprint?: string }): {
  token: string;
  jti: string;
} {
  const jti = crypto.randomUUID();
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const full: SessionPayload = { ...payload, jti, exp };
  const body = b64url(JSON.stringify(full));
  const sig = crypto.createHmac("sha256", getSecret()).update(body).digest("base64url");
  return { token: `${body}.${sig}`, jti };
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

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
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
  store.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

// ---------- System state ----------

/** Returns the singleton SystemState row (active, lockdown, etc.). */
export async function getSystemState() {
  let state = await db.systemState.findUnique({ where: { id: "singleton" } });
  if (!state) {
    state = await db.systemState.create({ data: { id: "singleton" } });
  }
  return state;
}

// ---------- Server-side session resolution ----------

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  branchId: string | null;
  branch: { id: string; code: string; name: string; type: string } | null;
  status: string;
  twoFactorEnabled: boolean;
  twoFactorEnforced: boolean;
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const payload = verifySessionToken(token);
    if (!payload) return null;

    const user = await db.user.findUnique({
      where: { id: payload.uid },
      include: {
        branch: { select: { id: true, code: true, name: true, type: true } },
        twoFactor: { select: { enabled: true, enforced: true } },
      },
    });
    if (!user) return null;
    if (user.status !== "ACTIVE") return null;

    // Verify the session JTI is still valid (not revoked).
    const session = await db.session.findUnique({ where: { tokenJti: payload.jti } });
    if (!session || session.revoked) return null;

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role as Role,
      branchId: user.branchId,
      branch: user.branch,
      status: user.status,
      twoFactorEnabled: user.twoFactor?.enabled ?? false,
      twoFactorEnforced: user.twoFactor?.enforced ?? false,
    };
  } catch {
    return null;
  }
}

/** Throws an AuthError if no session. Returns the user otherwise. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) throw new AuthError("Authentication required", 401);
  return user;
}

/**
 * Require the user's role rank to be >= the given minimum. Owners always pass.
 * Throws 403 otherwise.
 */
export async function requireRole(minRole: Role): Promise<SessionUser> {
  const user = await requireUser();
  if (ROLE_RANK[user.role] < ROLE_RANK[minRole]) {
    throw new AuthError(`${minRole} access required`, 403);
  }
  return user;
}

/** Require the system owner (the sole supreme authority). */
export async function requireOwner(): Promise<SessionUser> {
  return requireRole("OWNER");
}

/** Require a security administrator or above. */
export async function requireSecurityAdmin(): Promise<SessionUser> {
  return requireRole("SECURITY_ADMIN");
}

/**
 * Enforce system-active + lockdown rules. Called by document-transfer APIs.
 * - If the system is deactivated, only the owner can act.
 * - If the system is in lockdown, only the owner can act.
 * Throws 403 with a descriptive message otherwise.
 */
export async function requireSystemActive(): Promise<SessionUser> {
  const user = await requireUser();
  const state = await getSystemState();
  if (user.role === "OWNER") return user; // owner always bypasses
  if (!state.active) {
    throw new AuthError("System deactivated — only the owner can perform actions", 403);
  }
  if (state.lockdown) {
    throw new AuthError("System in emergency lockdown — only the owner can perform actions", 403);
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

/** Convert an AuthError into a JSON 401/403 NextResponse. */
export function authErrorResponse(err: unknown): Response | null {
  if (err instanceof AuthError) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: err.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
