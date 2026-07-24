import crypto from "crypto";
import fs from "fs";
import path from "path";
import { generateEcKeyPair, sign, verify, type KeyPairPem } from "@/lib/crypto";

/**
 * License management — cryptographically signed device licenses.
 *
 * Each license binds a device's public key to an expiry + tier. The license
 * payload is signed with the system's ECDSA-P521 licensing key. Validation
 * verifies the signature against the licensing public key — NOT spoofable
 * hardware IDs like MAC addresses.
 *
 * The licensing key pair is generated on first run and persisted to disk
 * (server-side only). In production this would live in an HSM.
 */

const LICENSING_KEY_PATH = path.join(process.cwd(), "db", ".licensing-key.json");

interface LicensingKey {
  publicKeyPem: string;
  privateKeyPem: string;
  fingerprint: string;
}

let _key: LicensingKey | null = null;

/** Get (or generate on first run) the system's ECDSA licensing key pair. */
function getLicensingKey(): LicensingKey {
  if (_key) return _key;
  if (fs.existsSync(LICENSING_KEY_PATH)) {
    _key = JSON.parse(fs.readFileSync(LICENSING_KEY_PATH, "utf8")) as LicensingKey;
    return _key;
  }
  const kp: KeyPairPem = generateEcKeyPair();
  _key = {
    publicKeyPem: kp.publicKeyPem,
    privateKeyPem: kp.privateKeyPem,
    fingerprint: kp.fingerprint,
  };
  fs.mkdirSync(path.dirname(LICENSING_KEY_PATH), { recursive: true });
  fs.writeFileSync(LICENSING_KEY_PATH, JSON.stringify(_key, null, 2), { mode: 0o600 });
  return _key;
}

/** Public key (PEM) for license signature verification — safe to expose. */
export function getLicensingPublicKey(): string {
  return getLicensingKey().publicKeyPem;
}

/** Fingerprint (SHA-256) of the licensing public key. */
export function getLicensingFingerprint(): string {
  return getLicensingKey().fingerprint;
}

/** Human-readable license key, e.g. "SE-A1B2C3-D4E5F6-G7H8I9". */
export function generateLicenseKey(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let s = "";
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) s += chars[bytes[i] % chars.length];
    groups.push(s);
  }
  return "SE-" + groups.join("-");
}

export interface LicensePayload {
  deviceId: string;
  deviceFingerprint: string;
  tier: string;
  issuedAt: number; // epoch ms
  expiresAt: number; // epoch ms
}

/** Build the canonical payload buffer that gets signed. */
function payloadBuffer(p: LicensePayload): Buffer {
  return Buffer.from(
    JSON.stringify({
      deviceId: p.deviceId,
      deviceFingerprint: p.deviceFingerprint,
      tier: p.tier,
      issuedAt: p.issuedAt,
      expiresAt: p.expiresAt,
    }),
    "utf8"
  );
}

/** Sign a license payload with the system's ECDSA-P521-SHA512 licensing key. */
export function signLicense(payload: LicensePayload): string {
  const key = getLicensingKey();
  const sig = sign(key.privateKeyPem, payloadBuffer(payload));
  return sig.toString("base64");
}

/** Verify a license signature against the system's licensing public key. */
export function verifyLicense(payload: LicensePayload, signatureBase64: string): boolean {
  try {
    const key = getLicensingKey();
    return verify(key.publicKeyPem, payloadBuffer(payload), Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

/** Check whether a license is currently valid (signature + not revoked + not expired). */
export function isLicenseValid(payload: LicensePayload, signatureBase64: string, status: string): {
  valid: boolean;
  reason?: string;
} {
  if (status === "REVOKED") return { valid: false, reason: "License revoked" };
  if (status === "SUSPENDED") return { valid: false, reason: "License suspended" };
  if (Date.now() > payload.expiresAt) return { valid: false, reason: "License expired" };
  if (!verifyLicense(payload, signatureBase64)) return { valid: false, reason: "Invalid signature" };
  return { valid: true };
}
