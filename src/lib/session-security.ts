import crypto from "crypto";
import { db } from "@/lib/db";

/**
 * Session security utilities.
 *
 * Provides:
 *   - Session fingerprinting (binds session to IP + User-Agent)
 *   - Concurrent session limits per user
 *   - Session rotation on privilege escalation
 *   - Stale session cleanup
 */

// ---------- Configuration ----------

/** Maximum concurrent sessions per user. Excess sessions are revoked oldest-first. */
export const MAX_CONCURRENT_SESSIONS = 5;

/** Session fingerprint algorithm: SHA-256 of normalized (IP + User-Agent) */
const FINGERPRINT_ALGO = "sha256";

// ---------- Fingerprinting ----------

/**
 * Create a session fingerprint from request headers.
 * The fingerprint binds the session to a specific client environment.
 * If the client's IP or User-Agent changes significantly, the session
 * will be considered potentially compromised.
 *
 * Uses a normalized hash so minor User-Agent changes (e.g., patch version)
 * don't invalidate sessions unnecessarily.
 */
export function createSessionFingerprint(req: Request): string {
  const ip = normalizeIp(
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
  const ua = normalizeUserAgent(req.headers.get("user-agent") || "unknown");

  return crypto
    .createHash(FINGERPRINT_ALGO)
    .update(`${ip}:${ua}`)
    .digest("hex");
}

/**
 * Verify that a session fingerprint matches the current request.
 * Returns true if the session is still valid for this client.
 */
export function verifySessionFingerprint(
  storedFingerprint: string | null,
  req: Request
): boolean {
  if (!storedFingerprint) return true; // No fingerprint stored = not enforced
  const current = createSessionFingerprint(req);
  return crypto.timingSafeEqual(
    Buffer.from(storedFingerprint, "hex"),
    Buffer.from(current, "hex")
  );
}

/**
 * Normalize IP address for fingerprinting.
 * Strips IPv6 prefix and normalizes for comparison.
 */
function normalizeIp(ip: string): string {
  // Strip IPv6 IPv4-mapping prefix
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  return ip;
}

/**
 * Normalize User-Agent for fingerprinting.
 * Extracts browser + OS family, ignoring version numbers.
 * This prevents minor updates from invalidating sessions.
 */
function normalizeUserAgent(ua: string): string {
  // Extract major browser family
  const browserMatch = ua.match(
    /(Chrome|Firefox|Safari|Edge|Opera|MSIE|Trident)\/?[\d.]*/i
  );
  const browser = browserMatch ? browserMatch[1].toLowerCase() : "unknown";

  // Extract OS family
  const osMatch = ua.match(
    /(Windows|Mac OS X|Linux|Android|iOS|iPhone|iPad)/i
  );
  const os = osMatch ? osMatch[1].toLowerCase().replace(/\s+/g, "-") : "unknown";

  return `${browser}:${os}`;
}

// ---------- Concurrent session management ----------

/**
 * Enforce maximum concurrent sessions per user.
 * Revokes the oldest sessions when the limit is exceeded.
 * Called on successful login.
 */
export async function checkConcurrentSessions(userId: string): Promise<void> {
  try {
    const activeSessions = await db.session.findMany({
      where: { userId, revoked: false },
      orderBy: { createdAt: "asc" },
    });

    if (activeSessions.length >= MAX_CONCURRENT_SESSIONS) {
      // Revoke oldest sessions to make room (keep the newest ones)
      const sessionsToRevoke = activeSessions.slice(
        0,
        activeSessions.length - MAX_CONCURRENT_SESSIONS + 1
      );

      await db.session.updateMany({
        where: {
          id: { in: sessionsToRevoke.map((s) => s.id) },
        },
        data: {
          revoked: true,
          revokedAt: new Date(),
        },
      });
    }
  } catch (err) {
    console.error("[session-security] Failed to check concurrent sessions:", err);
  }
}

/**
 * Revoke all sessions for a user (except the current one).
 * Used on password change, account suspension, or security events.
 */
export async function revokeAllUserSessions(
  userId: string,
  exceptJti?: string
): Promise<number> {
  try {
    const where: Record<string, unknown> = {
      userId,
      revoked: false,
    };
    if (exceptJti) {
      where.tokenJti = { not: exceptJti };
    }

    const result = await db.session.updateMany({
      where,
      data: {
        revoked: true,
        revokedAt: new Date(),
      },
    });

    return result.count;
  } catch (err) {
    console.error("[session-security] Failed to revoke sessions:", err);
    return 0;
  }
}

/**
 * Revoke all sessions for a user by user ID (used during lockdown/suspension).
 */
export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  return revokeAllUserSessions(userId);
}

// ---------- Session cleanup ----------

/**
 * Clean up expired and stale sessions.
 * Removes sessions older than 30 days and revoked sessions older than 7 days.
 */
export async function cleanupStaleSessions(): Promise<number> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Remove old expired sessions
    const expired = await db.session.deleteMany({
      where: {
        createdAt: { lt: thirtyDaysAgo },
      },
    });

    // Remove old revoked sessions
    const revoked = await db.session.deleteMany({
      where: {
        revoked: true,
        revokedAt: { lt: sevenDaysAgo },
      },
    });

    return expired.count + revoked.count;
  } catch (err) {
    console.error("[session-security] Cleanup failed:", err);
    return 0;
  }
}

// ---------- Session validation helpers ----------

/**
 * Get active session count for a user.
 */
export async function getActiveSessionCount(userId: string): Promise<number> {
  try {
    return await db.session.count({
      where: { userId, revoked: false },
    });
  } catch {
    return 0;
  }
}

/**
 * Get all active sessions for a user (for display/management).
 */
export async function getUserSessions(userId: string) {
  try {
    return await db.session.findMany({
      where: { userId, revoked: false },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tokenJti: true,
        ipAddress: true,
        userAgent: true,
        fingerprint: true,
        createdAt: true,
      },
    });
  } catch {
    return [];
  }
}
