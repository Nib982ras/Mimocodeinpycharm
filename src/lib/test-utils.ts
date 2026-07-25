/**
 * Test utilities for the Secure Multi-Branch Document Exchange System.
 *
 * Provides helpers for:
 *   - Creating test users and sessions
 *   - Generating test documents
 *   - Mocking API requests
 *   - Setting up test database state
 *
 * Usage:
 *   import { createTestUser, createTestDocument, mockAuth } from "@/lib/test-utils";
 */

import crypto from "crypto";
import { db } from "@/lib/db";
import { hashPassword, createSessionToken } from "@/lib/auth";
import { generateEcKeyPair, encryptPrivateKey } from "@/lib/crypto";

// ============================================================================
// Test user creation
// ============================================================================

interface TestUserOptions {
  username?: string;
  displayName?: string;
  password?: string;
  role?: string;
  branchId?: string;
}

/**
 * Create a test user with a hashed password.
 */
export async function createTestUser(options: TestUserOptions = {}) {
  const username = options.username || `test-${crypto.randomUUID().slice(0, 8)}`;
  const password = options.password || "TestPassword123!@#";
  const role = options.role || "USER";

  const user = await db.user.create({
    data: {
      username,
      displayName: options.displayName || `Test User ${username}`,
      passwordHash: hashPassword(password),
      role,
      branchId: options.branchId || null,
      status: "ACTIVE",
    },
    include: {
      branch: { select: { id: true, code: true, name: true, type: true } },
    },
  });

  return { user, password };
}

/**
 * Create a test session for a user.
 */
export async function createTestSession(userId: string, role: string, branchId?: string | null) {
  const { token, jti } = createSessionToken({
    uid: userId,
    username: `test-user`,
    role,
    branchId: branchId || null,
    branchCode: null,
  });

  await db.session.create({
    data: {
      userId,
      tokenJti: jti,
      ipAddress: "127.0.0.1",
      userAgent: "Test-Agent/1.0",
    },
  });

  return { token, jti };
}

// ============================================================================
// Test document creation
// ============================================================================

interface TestDocumentOptions {
  senderBranchId: string;
  recipientBranchId: string;
  senderSigningKey: string;
  recipientEncryptionKey: string;
  content?: string;
  filename?: string;
}

/**
 * Create a test encrypted document.
 */
export async function createTestDocument(options: TestDocumentOptions) {
  const { encryptDocument } = await import("@/lib/crypto");
  const { storeCiphertext } = await import("@/lib/storage");
  const { randomUUID } = await import("crypto");

  const content = options.content || `Test document content ${Date.now()}`;
  const plaintext = Buffer.from(content, "utf8");

  // Encrypt the document
  const enc = encryptDocument(
    plaintext,
    options.senderSigningKey,
    options.recipientEncryptionKey
  );

  const docId = randomUUID();
  const storagePath = await storeCiphertext(docId, enc.ciphertext);

  // Create the document record
  const doc = await db.document.create({
    data: {
      id: docId,
      name: options.filename || `test-document-${docId.slice(0, 8)}.txt`,
      mimeType: "text/plain",
      originalSize: plaintext.length,
      senderBranchId: options.senderBranchId,
      recipientBranchId: options.recipientBranchId,
      storagePath,
      ephemeralPublicKey: enc.ephemeralPublicKeyDer.toString("base64"),
      encryptedSessionKey: enc.encryptedSessionKey.toString("base64"),
      sessionIv: enc.sessionIv.toString("base64"),
      sessionAuthTag: enc.sessionAuthTag.toString("base64"),
      docIv: enc.docIv.toString("base64"),
      authTag: enc.authTag.toString("base64"),
      signature: enc.signature.toString("base64"),
      senderKeyId: "", // Must be set by caller
      recipientKeyId: "", // Must be set by caller
      documentHash: enc.documentHash,
      nonce: enc.nonce,
      packageVersion: "1.0",
      status: "DELIVERED",
    },
  });

  return { doc, plaintext, ciphertext: enc.ciphertext };
}

// ============================================================================
// Test key creation
// ============================================================================

interface TestKeyOptions {
  branchId: string;
  purpose?: "ENCRYPTION" | "SIGNING";
}

/**
 * Create a test key pair for a branch.
 */
export async function createTestKey(options: TestKeyOptions) {
  const purpose = options.purpose || "ENCRYPTION";
  const kp = generateEcKeyPair();
  const enc = encryptPrivateKey(kp.privateKeyPem);

  const key = await db.key.create({
    data: {
      branchId: options.branchId,
      purpose,
      algorithm: purpose === "ENCRYPTION" ? "ECDH-P521" : "ECDSA-P521-SHA512",
      curve: "secp521r1",
      publicKeyPem: kp.publicKeyPem,
      encryptedPrivateKey: enc.ciphertext,
      privateIv: enc.iv,
      fingerprint: kp.fingerprint,
      status: "ACTIVE",
      version: 1,
    },
  });

  return { key, privateKeyPem: kp.privateKeyPem, publicKeyPem: kp.publicKeyPem };
}

// ============================================================================
// Mock request helpers
// ============================================================================

/**
 * Create a mock Request object for testing API routes.
 */
export function createMockRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    cookie?: string;
  } = {}
): Request {
  const headers = new Headers(options.headers);

  if (options.cookie) {
    headers.set("Cookie", options.cookie);
  }

  if (options.body) {
    headers.set("Content-Type", "application/json");
  }

  return new Request(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

/**
 * Create a mock FormData for file upload testing.
 */
export function createMockFormData(
  file: { name: string; content: string; type: string },
  extraFields?: Record<string, string>
): FormData {
  const formData = new FormData();
  const blob = new Blob([file.content], { type: file.type });
  formData.append("file", blob, file.name);

  if (extraFields) {
    for (const [key, value] of Object.entries(extraFields)) {
      formData.append(key, value);
    }
  }

  return formData;
}

// ============================================================================
// Cleanup helpers
// ============================================================================

/**
 * Clean up test data.
 * Call this in afterAll/afterEach to reset the database.
 */
export async function cleanupTestData() {
  // Delete in reverse order of dependencies
  await db.auditLog.deleteMany({ where: { actor: { startsWith: "test-" } } });
  await db.session.deleteMany({});
  await db.document.deleteMany({});
  await db.message.deleteMany({});
  await db.license.deleteMany({});
  await db.device.deleteMany({});
  await db.twoFactor.deleteMany({});
  await db.key.deleteMany({});
  await db.user.deleteMany({ where: { username: { startsWith: "test-" } } });
}

// ============================================================================
// Assertion helpers
// ============================================================================

/**
 * Assert that a response is successful.
 */
export function assertSuccess(response: Response, expectedStatus: number = 200) {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}`
    );
  }
}

/**
 * Assert that a response is an error.
 */
export function assertError(response: Response, expectedStatus: number) {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}`
    );
  }
}

/**
 * Parse a JSON response and assert it's successful.
 */
export async function parseSuccessResponse<T>(response: Response): Promise<T> {
  assertSuccess(response);
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Response ok=false: ${data.error}`);
  }
  return data as T;
}

/**
 * Parse a JSON response and assert it's an error.
 */
export async function parseErrorResponse(response: Response) {
  assertError(response, response.status);
  return await response.json();
}
