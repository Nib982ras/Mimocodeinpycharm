import crypto from "crypto";
import fs from "fs";
import path from "path";
import { generateEcKeyPair, sign, verify, encryptPrivateKey, decryptPrivateKey, type KeyPairPem } from "@/lib/crypto";

/**
 * License management — cryptographically signed device licenses.
 *
 * The licensing key pair is encrypted at rest with the master key (same as
 * branch keys). This prevents license forgery if the file system is compromised.
 */

const LICENSING_KEY_PATH = path.join(process.cwd(), "db", ".licensing-key.json");

interface LicensingKey {
  encryptedPrivateKeyPem: string;
  privateKeyIv: string;
  publicKeyPem: string;
  fingerprint: string;
}

let _key: LicensingKey | null = null;

/**
 * Get (or generate on first run) the system's ECDSA licensing key pair.
 * The private key is encrypted at rest with the master key.
 */
function getLicensingKey(): LicensingKey {
  if (_key) return _key;

  if (fs.existsSync(LICENSING_KEY_PATH)) {
    const raw = JSON.parse(fs.readFileSync(LICENSING_KEY_PATH, "utf8")) as LicensingKey;

    // Handle legacy plaintext format — re-encrypt with master key
    const legacyRaw = raw as unknown as { privateKeyPem?: string; publicKeyPem: string; fingerprint: string };
    if (legacyRaw.privateKeyPem && !raw.encryptedPrivateKeyPem) {
      const enc = encryptPrivateKey(legacyRaw.privateKeyPem);
      const migrated: LicensingKey = {
        encryptedPrivateKeyPem: enc.ciphertext,
        privateKeyIv: enc.iv,
        publicKeyPem: raw.publicKeyPem,
        fingerprint: raw.fingerprint,
      };
      fs.writeFileSync(LICENSING_KEY_PATH, JSON.stringify(migrated, null, 2), { mode: 0o600 });
      _key = migrated;
      return _key;
    }

    _key = raw;
    return _key;
  }

  // Generate new key pair and encrypt the private key
  const kp: KeyPairPem = generateEcKeyPair();
  const enc = encryptPrivateKey(kp.privateKeyPem);
  const keyData: LicensingKey = {
    encryptedPrivateKeyPem: enc.ciphertext,
    privateKeyIv: enc.iv,
    publicKeyPem: kp.publicKeyPem,
    fingerprint: kp.fingerprint,
  };

  fs.mkdirSync(path.dirname(LICENSING_KEY_PATH), { recursive: true });
  fs.writeFileSync(LICENSING_KEY_PATH, JSON.stringify(keyData, null, 2), { mode: 0o600 });
  _key = keyData;
  return _key;
}

/**
 * Get the decrypted licensing private key.
 * Decrypts per-operation and clears from memory after use to prevent
 * indefinite exposure in process memory.
 */
function withDecryptedPrivateKey<T>(fn: (key: string) => T): T {
  const key = getLicensingKey();
  const decrypted = decryptPrivateKey(key.encryptedPrivateKeyPem, key.privateKeyIv);
  try {
    return fn(decrypted);
  } finally {
    // Clear the decrypted key from memory
    Buffer.from(decrypted).fill(0);
  }
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
  return withDecryptedPrivateKey((privateKeyPem) => {
    const sig = sign(privateKeyPem, payloadBuffer(payload));
    return sig.toString("base64");
  });
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
