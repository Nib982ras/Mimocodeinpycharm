/**
 * Structured logging module for production observability.
 *
 * Outputs JSON-formatted logs suitable for aggregation tools
 * (ELK, Datadog, CloudWatch, etc.).
 *
 * Log levels: error, warn, info, debug
 * Each log entry includes:
 *   - timestamp (ISO 8601)
 *   - level
 *   - message
 *   - context (module/action)
 *   - metadata (structured data)
 *   - request_id (if available)
 */

type LogLevel = "error" | "warn" | "info" | "debug";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

// Log level hierarchy
const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const CURRENT_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
const MIN_LEVEL = LOG_LEVELS[CURRENT_LEVEL] ?? LOG_LEVELS.info;

/**
 * Sanitize sensitive fields from log data.
 * Recursively removes passwords, tokens, keys, and other secrets
 * from nested objects.
 */
function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  const sensitive = [
    "password",
    "passwordHash",
    "secret",
    "token",
    "privateKey",
    "privateKeyPem",
    "encryptedPrivateKey",
    "masterKey",
    "sessionSecret",
    "apiKey",
    "authorization",
    "cookie",
    "creditCard",
    "ssn",
    "nationalId",
    "taxId",
    "cvc",
    "otp",
    "backupCode",
    "totpSecret",
    "encryptedSecret",
  ];

  const sanitized = { ...data };
  for (const key of Object.keys(sanitized)) {
    if (sensitive.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeNested(sanitized[key], sensitive);
    }
  }
  return sanitized;
}

function sanitizeNested(value: unknown, sensitive: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeNested(item, sensitive));
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (sensitive.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        result[key] = "[REDACTED]";
      } else if (typeof obj[key] === "object" && obj[key] !== null) {
        result[key] = sanitizeNested(obj[key], sensitive);
      } else {
        result[key] = obj[key];
      }
    }
    return result;
  }
  return value;
}

/**
 * Write a structured log entry.
 */
function writeLog(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] > MIN_LEVEL) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...sanitize(data || {}),
  };

  // Use stderr for error/warn, stdout for info/debug
  const output = level === "error" || level === "warn" ? console.error : console.log;
  output(JSON.stringify(entry));
}

/**
 * Logger instance with contextual binding.
 */
export function createContextLogger(context: string) {
  return {
    error: (message: string, data?: Record<string, unknown>) =>
      writeLog("error", message, { ...data, context }),
    warn: (message: string, data?: Record<string, unknown>) =>
      writeLog("warn", message, { ...data, context }),
    info: (message: string, data?: Record<string, unknown>) =>
      writeLog("info", message, { ...data, context }),
    debug: (message: string, data?: Record<string, unknown>) =>
      writeLog("debug", message, { ...data, context }),
  };
}

/**
 * Default logger for general use.
 */
export const logger = {
  error: (message: string, data?: Record<string, unknown>) =>
    writeLog("error", message, data),
  warn: (message: string, data?: Record<string, unknown>) =>
    writeLog("warn", message, data),
  info: (message: string, data?: Record<string, unknown>) =>
    writeLog("info", message, data),
  debug: (message: string, data?: Record<string, unknown>) =>
    writeLog("debug", message, data),
};

/**
 * Extract request ID from headers or generate one.
 */
export function getRequestId(req: Request): string {
  return (
    req.headers.get("x-request-id") ||
    req.headers.get("x-amzn-trace-id") ||
    crypto.randomUUID()
  );
}

/**
 * Create a request-scoped logger with automatic request ID and user context.
 */
export function createRequestLogger(
  req: Request,
  userId?: string
) {
  const requestId = getRequestId(req);
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  return {
    requestId,
    ip,
    userId,
    error: (message: string, data?: Record<string, unknown>) =>
      writeLog("error", message, {
        ...data,
        requestId,
        userId,
        ip,
      }),
    warn: (message: string, data?: Record<string, unknown>) =>
      writeLog("warn", message, {
        ...data,
        requestId,
        userId,
        ip,
      }),
    info: (message: string, data?: Record<string, unknown>) =>
      writeLog("info", message, {
        ...data,
        requestId,
        userId,
        ip,
      }),
    debug: (message: string, data?: Record<string, unknown>) =>
      writeLog("debug", message, {
        ...data,
        requestId,
        userId,
        ip,
      }),
  };
}
