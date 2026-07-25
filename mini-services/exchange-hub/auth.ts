import crypto from "crypto";

/**
 * Authentication for the Exchange Hub.
 *
 * Uses a shared secret between the Next.js API server and the hub.
 * All server-to-server communications must include this token.
 *
 * For client (browser) connections, authentication is done via:
 *   1. Valid session cookie (verified by Next.js)
 *   2. Socket connection from authenticated origin
 */

const SERVER_TOKEN = process.env.HUB_SERVER_TOKEN || crypto.randomBytes(32).toString("hex");

/**
 * Generate a new server token (for initial setup).
 * Run this once and store the output in your environment variables.
 */
export function generateServerToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Validate a server token.
 * Returns true if the token matches the configured secret.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function validateServerToken(token: string | undefined): boolean {
  if (!token) return false;
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(SERVER_TOKEN);
  // Constant-time comparison requires equal lengths
  if (tokenBuf.length !== secretBuf.length) return false;
  return crypto.timingSafeEqual(tokenBuf, secretBuf);
}

/**
 * Get the server token for outgoing requests.
 * Used by hub-client.ts when notifying the hub.
 */
export function getServerToken(): string {
  return SERVER_TOKEN;
}
