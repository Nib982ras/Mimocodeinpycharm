import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { db } from "@/lib/db";

/**
 * WebAuthn/FIDO2 authentication service.
 *
 * Provides passwordless authentication using hardware security keys,
 * biometrics (Touch ID, Windows Hello), or platform authenticators.
 *
 * Implements the full WebAuthn registration and authentication flows.
 */

// ---------- Configuration ----------

const RP_NAME = "Secure Document Exchange";
const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
const ORIGIN = process.env.WEBAUTHN_ORIGIN || `http://localhost:3000`;

// ---------- Registration ----------

/**
 * Generate WebAuthn registration options for a user.
 * Called before the browser prompts for authenticator interaction.
 */
export async function startRegistration(
  userId: string,
  username: string,
  displayName: string
) {
  // Get existing credentials for the user
  const existingCredentials = await db.webAuthnCredential.findMany({
    where: { userId, revokedAt: null },
    select: { credentialId: true },
  });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: username,
    userDisplayName: displayName,
    attestationType: "none",
    excludeCredentials: existingCredentials.map((cred) => ({
      id: cred.credentialId,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  return options;
}

/**
 * Verify WebAuthn registration response.
 * Called after the browser completes authenticator interaction.
 */
export async function completeRegistration(
  userId: string,
  options: any,
  response: any,
  deviceName?: string
): Promise<{ credentialId: string; success: boolean }> {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: options.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return { credentialId: "", success: false };
  }

  const regInfo = verification.registrationInfo;

  // Store the credential
  const created = await db.webAuthnCredential.create({
    data: {
      userId,
      credentialId: regInfo.credentialID,
      publicKey: Buffer.from(regInfo.credentialPublicKey).toString("base64url"),
      counter: BigInt(regInfo.counter),
      transports: JSON.stringify(response.response?.transports || []),
      authenticatorType: response.response?.authenticatorAttachment || null,
      deviceName: deviceName || null,
    },
  });

  return { credentialId: created.credentialId, success: true };
}

// ---------- Authentication ----------

/**
 * Generate WebAuthn authentication options.
 * Called before the browser prompts for authenticator interaction.
 */
export async function startAuthentication(username?: string) {
  let allowCredentials: { id: string; transports?: ("usb" | "ble" | "nfc" | "internal")[] }[] = [];

  if (username) {
    // Get user's credentials
    const user = await db.user.findUnique({
      where: { username },
      include: {
        webauthnCredentials: {
          where: { revokedAt: null },
          select: {
            credentialId: true,
            transports: true,
          },
        },
      },
    });

    if (user) {
      allowCredentials = user.webauthnCredentials.map((cred) => ({
        id: cred.credentialId,
        transports: cred.transports
          ? JSON.parse(cred.transports)
          : undefined,
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
    allowCredentials,
  });

  return options;
}

/**
 * Verify WebAuthn authentication response.
 * Called after the browser completes authenticator interaction.
 */
export async function completeAuthentication(
  options: any,
  response: any
): Promise<{
  verified: boolean;
  userId?: string;
  credentialId?: string;
}> {
  // Find the credential
  const credential = await db.webAuthnCredential.findUnique({
    where: { credentialId: response.id },
    include: { user: { select: { id: true, status: true } } },
  });

  if (!credential || credential.revokedAt) {
    return { verified: false };
  }

  if (credential.user.status !== "ACTIVE") {
    return { verified: false };
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: options.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    authenticator: {
      credentialID: credential.credentialId,
      credentialPublicKey: new Uint8Array(Buffer.from(credential.publicKey, "base64url")),
      counter: Number(credential.counter),
      transports: credential.transports
        ? JSON.parse(credential.transports)
        : undefined,
    },
  });

  if (!verification.verified) {
    return { verified: false };
  }

  // Update counter and last used
  await db.webAuthnCredential.update({
    where: { id: credential.id },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter),
      lastUsedAt: new Date(),
    },
  });

  return {
    verified: true,
    userId: credential.userId,
    credentialId: credential.credentialId,
  };
}

// ---------- Credential management ----------

/**
 * Get all WebAuthn credentials for a user.
 */
export async function getUserCredentials(userId: string) {
  return db.webAuthnCredential.findMany({
    where: { userId, revokedAt: null },
    select: {
      id: true,
      credentialId: true,
      authenticatorType: true,
      deviceName: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Revoke a WebAuthn credential.
 */
export async function revokeCredential(
  credentialId: string,
  userId: string
): Promise<boolean> {
  try {
    await db.webAuthnCredential.updateMany({
      where: { credentialId, userId },
      data: { revokedAt: new Date() },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Revoke all WebAuthn credentials for a user.
 */
export async function revokeAllCredentials(userId: string): Promise<number> {
  const result = await db.webAuthnCredential.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Check if a user has any WebAuthn credentials.
 */
export async function hasWebAuthnCredentials(userId: string): Promise<boolean> {
  const count = await db.webAuthnCredential.count({
    where: { userId, revokedAt: null },
  });
  return count > 0;
}
