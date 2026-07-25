import crypto from "crypto";

/**
 * Cryptographic foundation for the Secure Multi-Branch Document Exchange System.
 *
 * Implements the full hybrid encryption workflow described in 03_ENCRYPTION_WORKFLOW.md:
 *  - ECC P-521 (secp521r1) for ECDH key exchange and ECDSA signatures
 *  - AES-256-GCM for document encryption (authenticated encryption)
 *  - HKDF-SHA256 for key derivation from ECDH shared secrets
 *  - SHA-512 for document hashing and ECDSA signatures
 *  - Ephemeral keys per document for perfect forward secrecy
 *
 * Private keys are encrypted at rest with a master key (AES-256-GCM) loaded
 * from the MASTER_KEY environment variable (or auto-generated in development).
 */

const CURVE = "secp521r1";

// ---------- Master key (HSM stand-in) ----------

/**
 * Retrieve the master encryption key.
 *
 * Priority:
 *   1. MASTER_KEY environment variable (REQUIRED in production)
 *   2. Auto-generated random key (development only — NOT persisted to disk)
 *
 * In production, set MASTER_KEY via your secrets manager or deployment pipeline:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * WARNING: Changing this key makes ALL existing encrypted data unrecoverable.
 */
let _masterKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (_masterKey) return _masterKey;

  const envKey = process.env.MASTER_KEY;
  if (envKey) {
    const key = Buffer.from(envKey.trim(), "hex");
    if (key.length !== 32) {
      throw new Error("MASTER_KEY must be a 64-character hex string (256 bits)");
    }
    _masterKey = key;
    return _masterKey;
  }

  // Development-only fallback: generate ephemeral key (not persisted)
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "MASTER_KEY environment variable is required in production. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  console.warn("[crypto] WARNING: Using ephemeral master key — data encrypted THIS session will NOT be recoverable after restart. Set MASTER_KEY for persistence.");
  _masterKey = crypto.randomBytes(32);
  return _masterKey;
}

/** Encrypt a private key (PEM) with the master key using AES-256-GCM. */
export function encryptPrivateKey(privateKeyPem: string): {
  ciphertext: string;
  iv: string;
} {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(privateKeyPem, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // pack ciphertext + tag together (tag appended)
  return {
    ciphertext: Buffer.concat([ct, tag]).toString("base64"),
    iv: iv.toString("base64"),
  };
}

/** Decrypt a private key previously encrypted with encryptPrivateKey. */
export function decryptPrivateKey(ciphertextB64: string, ivB64: string): string {
  const key = getMasterKey();
  const iv = Buffer.from(ivB64, "base64");
  const packed = Buffer.from(ciphertextB64, "base64");
  const tag = packed.subarray(packed.length - 16);
  const ct = packed.subarray(0, packed.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

// ---------- Key pair generation ----------

export interface KeyPairPem {
  publicKeyPem: string;
  privateKeyPem: string;
  publicKeyDerBase64: string;
  fingerprint: string;
}

/** Generate an ECC P-521 key pair usable for both ECDH and ECDSA. */
export function generateEcKeyPair(): KeyPairPem {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: CURVE,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const pubDer = publicKeyToDer(publicKey as string);
  return {
    publicKeyPem: publicKey as string,
    privateKeyPem: privateKey as string,
    publicKeyDerBase64: pubDer.toString("base64"),
    fingerprint: crypto.createHash("sha256").update(pubDer).digest("hex"),
  };
}

function publicKeyToDer(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  return key.export({ type: "spki", format: "der" });
}

// ---------- ECDH + HKDF ----------

/**
 * Compute the ECDH shared secret using a JWK round-trip. This is robust across
 * PEM key encodings and avoids fragile manual DER parsing. The shared secret is
 * then fed through HKDF-SHA256 to produce a symmetric key.
 */
export function computeSharedSecretJwk(
  privateKeyPem: string,
  peerPublicKeyPem: string
): Buffer {
  const priv = crypto.createPrivateKey(privateKeyPem);
  const pub = crypto.createPublicKey(peerPublicKeyPem);
  const privJwk = priv.export({ format: "jwk" }) as Record<string, string>;
  const pubJwk = pub.export({ format: "jwk" }) as Record<string, string>;

  const ecdh = crypto.createECDH(CURVE);
  // JWK 'd' is the private scalar, base64url.
  ecdh.setPrivateKey(base64UrlToBuffer(privJwk.d!));
  const peerPoint = Buffer.concat([
    Buffer.from([0x04]), // uncompressed point marker
    base64UrlToBuffer(pubJwk.x!),
    base64UrlToBuffer(pubJwk.y!),
  ]);
  return ecdh.computeSecret(peerPoint);
}

function base64UrlToBuffer(b64url: string): Buffer {
  const pad = b64url.length % 4 === 0 ? "" : "=".repeat(4 - (b64url.length % 4));
  return Buffer.from(b64url + pad, "base64");
}

/** HKDF-SHA256 key derivation from a shared secret.
 *  Uses Node.js built-in crypto.hkdfSync (RFC 5869) for standards compliance.
 *  Produces a 32-byte key suitable for AES-256.
 */
export function deriveKey(
  sharedSecret: Buffer,
  salt: Buffer = Buffer.alloc(32),
  info: Buffer | string = "secure-doc-exchange/v1"
): Buffer {
  const infoBuf = Buffer.isBuffer(info) ? info : Buffer.from(info, "utf8");
  const derived = crypto.hkdfSync("sha256", sharedSecret, salt, infoBuf, 32);
  return Buffer.from(derived);
}

// ---------- AES-256-GCM ----------

export interface AeadResult {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/** Encrypt arbitrary data with AES-256-GCM. Returns ciphertext, iv, authTag. */
export function aesGcmEncrypt(key: Buffer, plaintext: Buffer): AeadResult {
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: ct, iv, authTag: cipher.getAuthTag() };
}

/** Decrypt AES-256-GCM. Throws if auth tag verification fails (tampering detected). */
export function aesGcmDecrypt(
  key: Buffer,
  iv: Buffer,
  ciphertext: Buffer,
  authTag: Buffer
): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ---------- ECDSA signatures ----------

/** Sign data with ECDSA-SHA512 using a P-521 private key. Returns DER signature. */
export function sign(privateKeyPem: string, data: Buffer): Buffer {
  const signer = crypto.createSign("SHA512");
  signer.update(data);
  signer.end();
  return signer.sign(privateKeyPem);
}

/** Verify an ECDSA-SHA512 signature. Returns true if valid. */
export function verify(
  publicKeyPem: string,
  data: Buffer,
  signature: Buffer
): boolean {
  const verifier = crypto.createVerify("SHA512");
  verifier.update(data);
  verifier.end();
  try {
    return verifier.verify(publicKeyPem, signature);
  } catch (err) {
    // Log unexpected crypto errors (invalid key format, etc.) but don't leak details
    console.error("[crypto] Signature verification error:", err instanceof Error ? err.message : "unknown");
    return false;
  }
}

// ---------- Hashing helpers ----------

export function sha512(data: Buffer): string {
  return crypto.createHash("sha512").update(data).digest("hex");
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function randomNonce(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("base64");
}

// ---------- Full document exchange workflow ----------

export interface EncryptResult {
  ciphertext: Buffer;
  ephemeralPublicKeyDer: Buffer;
  encryptedSessionKey: Buffer;
  sessionIv: Buffer;
  sessionAuthTag: Buffer;
  docIv: Buffer;
  authTag: Buffer;
  signature: Buffer;
  documentHash: string;
  nonce: string;
}

/**
 * Encrypt a document for a recipient following the hybrid workflow:
 *  1. Generate 256-bit session key + 96-bit IV
 *  2. AES-256-GCM encrypt the document
 *  3. Ephemeral ECDH key pair, derive key, encrypt session key
 *  4. ECDSA-SHA512 sign the ciphertext with sender's signing key
 */
export function encryptDocument(
  plaintext: Buffer,
  senderSigningPrivateKeyPem: string,
  recipientEncryptionPublicKeyPem: string
): EncryptResult {
  // Step 1-2: AES-256-GCM encrypt the document with a fresh session key
  const sessionKey = crypto.randomBytes(32);
  const { ciphertext, iv: docIv, authTag } = aesGcmEncrypt(sessionKey, plaintext);

  // Step 3: ECDH with ephemeral key to encapsulate the session key
  const ephemeral = generateEcKeyPair();
  const shared = computeSharedSecretJwk(
    ephemeral.privateKeyPem,
    recipientEncryptionPublicKeyPem
  );
  const kek = deriveKey(shared); // key-encryption key
  const { ciphertext: encSessionKey, iv: sessionIv, authTag: sessionAuthTag } = aesGcmEncrypt(kek, sessionKey);

  // Step 4: ECDSA-SHA512 sign the ciphertext (authenticity + non-repudiation)
  const signature = sign(senderSigningPrivateKeyPem, ciphertext);

  return {
    ciphertext,
    ephemeralPublicKeyDer: Buffer.from(ephemeral.publicKeyDerBase64, "base64"),
    encryptedSessionKey: encSessionKey,
    sessionIv,
    sessionAuthTag,
    docIv,
    authTag,
    signature,
    documentHash: sha512(plaintext),
    nonce: randomNonce(16),
  };
}

export interface DecryptResult {
  plaintext: Buffer;
  signatureValid: boolean;
  documentHashValid: boolean;
  documentHash: string;
}

/**
 * Decrypt a document package and verify its signature.
 * Throws on auth-tag failure (tampering). Reports signature/hash validity.
 */
export function decryptDocument(
  ciphertext: Buffer,
  ephemeralPublicKeyDer: Buffer,
  encryptedSessionKey: Buffer,
  sessionIv: Buffer,
  sessionAuthTag: Buffer,
  docIv: Buffer,
  authTag: Buffer,
  signature: Buffer,
  recipientEncryptionPrivateKeyPem: string,
  senderSigningPublicKeyPem: string,
  expectedDocumentHash?: string
): DecryptResult {
  // Recover the recipient's private key and ephemeral public key, then ECDH.
  const ephemeralPubPem = derToPem(ephemeralPublicKeyDer, "PUBLIC KEY");
  const shared = computeSharedSecretJwk(
    recipientEncryptionPrivateKeyPem,
    ephemeralPubPem
  );
  const kek = deriveKey(shared);
  const sessionKey = aesGcmDecrypt(kek, sessionIv, encryptedSessionKey, sessionAuthTag);

  // Decrypt the document (auth tag verified here)
  const plaintext = aesGcmDecrypt(sessionKey, docIv, ciphertext, authTag);

  // Verify the ECDSA signature over the ciphertext
  const signatureValid = verify(senderSigningPublicKeyPem, ciphertext, signature);

  // Verify document integrity hash
  const documentHash = sha512(plaintext);
  const documentHashValid = expectedDocumentHash
    ? documentHash === expectedDocumentHash
    : true;

  return { plaintext, signatureValid, documentHashValid, documentHash };
}

// ---------- PEM / DER helpers ----------

/** Convert a DER-encoded key buffer to a PEM string. */
export function derToPem(der: Buffer, label: string): string {
  const b64 = der.toString("base64");
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/** Convert a PEM string to a DER buffer. */
export function pemToDer(pem: string): Buffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Buffer.from(b64, "base64");
}

/** Reconstruct a public key PEM from a base64 DER SPKI string. */
export function publicKeyFromDerBase64(derBase64: string): string {
  return derToPem(Buffer.from(derBase64, "base64"), "PUBLIC KEY");
}
