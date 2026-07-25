import { redisGet, redisSet, redisIncr, redisDel, getRedis } from "@/lib/redis";

/**
 * CAPTCHA protection service.
 *
 * Provides rate-limiting-based CAPTCHA triggers:
 *   - After N failed attempts, require CAPTCHA
   *   - CAPTCHA remains required until success or timeout
 *   - Supports multiple providers: hCaptcha, reCAPTCHA, Turnstile
 *
 * Configuration via environment variables:
 *   - CAPTCHA_PROVIDER: "hcaptcha" | "recaptcha" | "turnstile" | "none"
 *   - CAPTCHA_SECRET_KEY: Provider-specific secret key
 *   - CAPTCHA_SITE_KEY: Provider-specific site key (for frontend)
 *   - CAPTCHA_FAILURE_THRESHOLD: Number of failures before requiring CAPTCHA (default: 5)
 *   - CAPTCHA_BLOCK_DURATION: Minutes to require CAPTCHA after threshold (default: 30)
 */

// ---------- Types ----------

export type CaptchaProvider = "hcaptcha" | "recaptcha" | "turnstile" | "none";

export interface CaptchaConfig {
  provider: CaptchaProvider;
  secretKey: string;
  siteKey: string;
  failureThreshold: number;
  blockDurationMinutes: number;
}

export interface CaptchaVerificationResult {
  success: boolean;
  error?: string;
  challengeTs?: string;
  hostname?: string;
}

// ---------- Configuration ----------

function getCaptchaConfig(): CaptchaConfig {
  return {
    provider: (process.env.CAPTCHA_PROVIDER || "none") as CaptchaProvider,
    secretKey: process.env.CAPTCHA_SECRET_KEY || "",
    siteKey: process.env.CAPTCHA_SITE_KEY || "",
    failureThreshold: parseInt(process.env.CAPTCHA_FAILURE_THRESHOLD || "5", 10),
    blockDurationMinutes: parseInt(process.env.CAPTCHA_BLOCK_DURATION || "30", 10),
  };
}

// ---------- Failure tracking ----------

const CAPTCHA_KEY_PREFIX = "captcha:";
const CAPTCHA_BLOCK_PREFIX = "captcha:block:";

/**
 * Record a failed attempt for an IP or username.
 * Returns the current failure count.
 */
export async function recordFailure(key: string): Promise<number> {
  const config = getCaptchaConfig();
  const redisKey = `${CAPTCHA_KEY_PREFIX}${key}`;

  const redis = getRedis();
  if (redis) {
    // Use Redis for fast increments with TTL
    const count = await redisIncr(redisKey, config.blockDurationMinutes * 60);
    return count;
  }

  // Fallback: no Redis, just return 0 (no CAPTCHA enforcement)
  return 0;
}

/**
 * Check if CAPTCHA is required for a key.
 */
export async function isCaptchaRequired(key: string): Promise<boolean> {
  const config = getCaptchaConfig();

  if (config.provider === "none") return false;

  // Check if key is in block list
  const blockKey = `${CAPTCHA_BLOCK_PREFIX}${key}`;
  const redis = getRedis();

  if (redis) {
    const blocked = await redisGet(blockKey);
    if (blocked) return true;

    // Check failure count
    const countKey = `${CAPTCHA_KEY_PREFIX}${key}`;
    const countStr = await redisGet(countKey);
    const count = countStr ? parseInt(countStr as string, 10) : 0;

    return count >= config.failureThreshold;
  }

  // No Redis: cannot enforce CAPTCHA
  return false;
}

/**
 * Mark a key as requiring CAPTCHA (after threshold exceeded).
 */
export async function markCaptchaRequired(key: string): Promise<void> {
  const config = getCaptchaConfig();
  const blockKey = `${CAPTCHA_BLOCK_PREFIX}${key}`;

  const redis = getRedis();
  if (redis) {
    await redisSet(blockKey, true, config.blockDurationMinutes * 60);
  }
}

/**
 * Clear CAPTCHA requirement (after successful verification or login).
 */
export async function clearCaptchaRequirement(key: string): Promise<void> {
  const countKey = `${CAPTCHA_KEY_PREFIX}${key}`;
  const blockKey = `${CAPTCHA_BLOCK_PREFIX}${key}`;

  await redisDel(countKey);
  await redisDel(blockKey);
}

/**
 * Get failure count for a key.
 */
export async function getFailureCount(key: string): Promise<number> {
  const redisKey = `${CAPTCHA_KEY_PREFIX}${key}`;

  const redis = getRedis();
  if (redis) {
    const countStr = await redisGet(redisKey);
    return countStr ? parseInt(countStr as string, 10) : 0;
  }

  return 0;
}

// ---------- Verification ----------

/**
 * Verify a CAPTCHA token with the configured provider.
 */
export async function verifyCaptcha(
  token: string,
  remoteIp?: string
): Promise<CaptchaVerificationResult> {
  const config = getCaptchaConfig();

  if (config.provider === "none") {
    return { success: true };
  }

  if (!config.secretKey) {
    console.error("[captcha] No secret key configured");
    return { success: false, error: "CAPTCHA not configured" };
  }

  try {
    switch (config.provider) {
      case "hcaptcha":
        return await verifyHcaptcha(token, config.secretKey, remoteIp);
      case "recaptcha":
        return await verifyRecaptcha(token, config.secretKey, remoteIp);
      case "turnstile":
        return await verifyTurnstile(token, config.secretKey, remoteIp);
      default:
        return { success: false, error: "Unknown CAPTCHA provider" };
    }
  } catch (err) {
    console.error("[captcha] Verification error:", err);
    return { success: false, error: "CAPTCHA verification failed" };
  }
}

/**
 * Verify hCaptcha token.
 */
async function verifyHcaptcha(
  token: string,
  secretKey: string,
  remoteIp?: string
): Promise<CaptchaVerificationResult> {
  const response = await fetch("https://api.hcaptcha.com/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      response: token,
      secret: secretKey,
      remoteip: remoteIp || "",
    }),
  });

  const data = await response.json();
  return {
    success: data.success === true,
    error: data["error-codes"]?.join(", "),
    challengeTs: data.challenge_ts,
    hostname: data.hostname,
  };
}

/**
 * Verify reCAPTCHA token.
 */
async function verifyRecaptcha(
  token: string,
  secretKey: string,
  remoteIp?: string
): Promise<CaptchaVerificationResult> {
  const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      response: token,
      secret: secretKey,
      remoteip: remoteIp || "",
    }),
  });

  const data = await response.json();
  return {
    success: data.success === true,
    error: data["error-codes"]?.join(", "),
    challengeTs: data.challenge_ts,
    hostname: data.hostname,
  };
}

/**
 * Verify Cloudflare Turnstile token.
 */
async function verifyTurnstile(
  token: string,
  secretKey: string,
  remoteIp?: string
): Promise<CaptchaVerificationResult> {
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      response: token,
      secret: secretKey,
      remoteip: remoteIp || "",
    }),
  });

  const data = await response.json();
  return {
    success: data.success === true,
    error: data["error-codes"]?.join(", "),
    challengeTs: data.challenge_ts,
    hostname: data.hostname,
  };
}

// ---------- Convenience functions ----------

/**
 * Check if CAPTCHA is required for a login attempt.
 * Combines failure tracking with CAPTCHA requirement.
 */
export async function checkLoginCaptcha(
  ip: string,
  username?: string
): Promise<{ required: boolean; siteKey: string }> {
  const config = getCaptchaConfig();

  if (config.provider === "none") {
    return { required: false, siteKey: "" };
  }

  // Check IP-based requirement
  const ipRequired = await isCaptchaRequired(`ip:${ip}`);
  if (ipRequired) {
    return { required: true, siteKey: config.siteKey };
  }

  // Check username-based requirement (if provided)
  if (username) {
    const userRequired = await isCaptchaRequired(`user:${username.toLowerCase()}`);
    if (userRequired) {
      return { required: true, siteKey: config.siteKey };
    }
  }

  return { required: false, siteKey: config.siteKey };
}

/**
 * Record a failed login attempt for CAPTCHA tracking.
 */
export async function recordLoginFailure(ip: string, username?: string): Promise<void> {
  const config = getCaptchaConfig();

  if (config.provider === "none") return;

  // Track IP failures
  const ipCount = await recordFailure(`ip:${ip}`);

  // Track username failures (if provided)
  if (username) {
    await recordFailure(`user:${username.toLowerCase()}`);
  }

  // Mark as required if threshold exceeded
  if (ipCount >= config.failureThreshold) {
    await markCaptchaRequired(`ip:${ip}`);
  }
}

/**
 * Clear CAPTCHA tracking after successful login.
 */
export async function clearLoginCaptcha(ip: string, username?: string): Promise<void> {
  await clearCaptchaRequirement(`ip:${ip}`);
  if (username) {
    await clearCaptchaRequirement(`user:${username.toLowerCase()}`);
  }
}
