import crypto from "crypto";

/**
 * RFC 6238 Time-based One-Time Password (TOTP) implementation.
 *
 * No external dependencies — uses Node's built-in crypto (HMAC-SHA1 per RFC).
 * Compatible with Google Authenticator, Microsoft Authenticator, 1Password,
 * Authy, and any standard TOTP app.
 *
 * Defaults: 30-second period, 6 digits, SHA-1 (the TOTP standard).
 */

const PERIOD = 30; // seconds
const DIGITS = 6;
const ISSUER = "SecureExchange";

/** Generate a random 20-byte (160-bit) TOTP secret, base32-encoded. */
export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  return base32Encode(bytes);
}

/** Generate a TOTP code for the given secret at the current time. */
export function generateTotp(secretBase32: string, time: number = Date.now()): string {
  const counter = Math.floor(time / 1000 / PERIOD);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const key = base32Decode(secretBase32);
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/**
 * Verify a TOTP code, allowing a ±1 period window (±30s) for clock drift.
 * Constant-time comparison to prevent timing attacks.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  time: number = Date.now()
): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(time / 1000 / PERIOD);
  // Check current, previous, and next period
  for (const delta of [0, -1, 1]) {
    const expected = generateTotp(secretBase32, (counter + delta) * PERIOD * 1000);
    if (constantTimeEqual(code, expected)) return true;
  }
  return false;
}

/** Build an `otpauth://` provisioning URI for QR-code scanning. */
export function buildOtpauthUri(
  secretBase32: string,
  accountName: string
): string {
  const label = encodeURIComponent(`${ISSUER}:${accountName}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Generate `count` one-time backup codes (8 chars, alphanumeric). */
export function generateBackupCodes(count = 10): string[] {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let code = "";
    const bytes = crypto.randomBytes(8);
    for (let j = 0; j < 8; j++) code += chars[bytes[j] % chars.length];
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

/** Hash a backup code with scrypt for safe storage. Returns "salt:hash" hex. */
export function hashBackupCode(code: string): string {
  const salt = crypto.randomBytes(8).toString("hex");
  const hash = crypto.scryptSync(code.toUpperCase(), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

/** Verify a backup code against a stored "salt:hash" string. */
export function verifyBackupCode(code: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(code.toUpperCase(), salt, 32).toString("hex");
  return constantTimeEqual(hash, test);
}

// ---------- base32 (RFC 4648, no padding) ----------

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
