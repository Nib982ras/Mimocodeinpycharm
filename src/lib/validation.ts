/**
 * Input validation utilities.
 *
 * Provides type-safe validation for API request bodies.
 * Uses a simple, dependency-free approach.
 *
 * For complex validation needs, consider using Zod or Yup.
 */

// ============================================================================
// Types
// ============================================================================

export type ValidationError = {
  field: string;
  message: string;
};

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: ValidationError[] };

// ============================================================================
// Validators
// ============================================================================

/**
 * Validate that a value is a non-empty string.
 */
export function isString(value: unknown, field: string): string | ValidationError {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { field, message: `${field} must be a non-empty string` };
  }
  return value.trim();
}

/**
 * Validate that a value is a string within length limits.
 */
export function isStringLen(
  value: unknown,
  field: string,
  min: number = 1,
  max: number = 1000
): string | ValidationError {
  const result = isString(value, field);
  if (typeof result === "object") return result;

  if (result.length < min || result.length > max) {
    return { field, message: `${field} must be between ${min} and ${max} characters` };
  }
  return result;
}

/**
 * Validate that a value is a valid email address.
 */
export function isEmail(value: unknown, field: string): string | ValidationError {
  const result = isString(value, field);
  if (typeof result === "object") return result;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(result)) {
    return { field, message: `${field} must be a valid email address` };
  }
  return result;
}

/**
 * Validate that a value is a valid URL (http/https only).
 * Restricts schemes to prevent javascript:, data:, file: SSRF/XSS.
 */
export function isUrl(value: unknown, field: string): string | ValidationError {
  const result = isString(value, field);
  if (typeof result === "object") return result;

  try {
    const url = new URL(result);
    if (!["http:", "https:"].includes(url.protocol)) {
      return { field, message: `${field} must be an HTTP or HTTPS URL` };
    }
    return result;
  } catch {
    return { field, message: `${field} must be a valid URL` };
  }
}

/**
 * Validate that a value is a valid UUID.
 */
export function isUuid(value: unknown, field: string): string | ValidationError {
  const result = isString(value, field);
  if (typeof result === "object") return result;

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(result)) {
    return { field, message: `${field} must be a valid UUID` };
  }
  return result;
}

/**
 * Validate that a value is a valid number within range.
 */
export function isNumber(
  value: unknown,
  field: string,
  min?: number,
  max?: number
): number | ValidationError {
  const num = typeof value === "number" ? value : Number(value);

  if (isNaN(num) || !isFinite(num)) {
    return { field, message: `${field} must be a finite number` };
  }

  if (min !== undefined && num < min) {
    return { field, message: `${field} must be at least ${min}` };
  }

  if (max !== undefined && num > max) {
    return { field, message: `${field} must be at most ${max}` };
  }

  return num;
}

/**
 * Validate that a value is a valid integer.
 */
export function isInteger(
  value: unknown,
  field: string,
  min?: number,
  max?: number
): number | ValidationError {
  const num = isNumber(value, field, min, max);
  if (typeof num === "object") return num;

  if (!Number.isInteger(num)) {
    return { field, message: `${field} must be an integer` };
  }

  return num;
}

/**
 * Validate that a value is a boolean.
 */
export function isBoolean(value: unknown, field: string): boolean | ValidationError {
  if (typeof value === "boolean") return value;

  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;

  return { field, message: `${field} must be a boolean` };
}

/**
 * Validate that a value is one of the allowed values.
 */
export function isOneOf<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[]
): T | ValidationError {
  const result = isString(value, field);
  if (typeof result === "object") return result;

  if (!allowed.includes(result as T)) {
    return {
      field,
      message: `${field} must be one of: ${allowed.join(", ")}`,
    };
  }

  return result as T;
}

/**
 * Validate that a value is an array.
 */
export function isArray<T>(
  value: unknown,
  field: string,
  itemValidator?: (item: unknown) => T | ValidationError
): T[] | ValidationError {
  if (!Array.isArray(value)) {
    return { field, message: `${field} must be an array` };
  }

  if (!itemValidator) return value as T[];

  const validated: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const result = itemValidator(value[i]);
    if (result !== null && typeof result === "object" && "field" in result) {
      return { field: `${field}[${i}]`, message: (result as ValidationError).message };
    }
    validated.push(result as T);
  }

  return validated;
}

/**
 * Validate that a value is a valid date string.
 */
export function isDate(value: unknown, field: string): Date | ValidationError {
  const result = isString(value, field);
  if (typeof result === "object") return result;

  const date = new Date(result);
  if (isNaN(date.getTime())) {
    return { field, message: `${field} must be a valid date` };
  }

  return date;
}

// ============================================================================
// Schema validation
// ============================================================================

type SchemaDefinition = Record<
  string,
  (value: unknown) => unknown | ValidationError
>;

/**
 * Validate an object against a schema definition.
 *
 * @example
 * const result = validateSchema(body, {
 *   username: (v) => isStringLen(v, "username", 3, 50),
 *   email: (v) => isEmail(v, "email"),
 *   age: (v) => isNumber(v, "age", 0, 150),
 * });
 */
export function validateSchema<T extends Record<string, unknown>>(
  data: unknown,
  schema: SchemaDefinition
): ValidationResult<T> {
  if (typeof data !== "object" || data === null) {
    return { ok: false, errors: [{ field: "body", message: "Request body must be an object" }] };
  }

  const errors: ValidationError[] = [];
  const result: Record<string, unknown> = {};

  for (const [key, validator] of Object.entries(schema)) {
    const value = (data as Record<string, unknown>)[key];
    const validated = validator(value);

    if (typeof validated === "object" && validated !== null && "field" in validated) {
      errors.push(validated as ValidationError);
    } else {
      result[key] = validated;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, data: result as T };
}

// ============================================================================
// Sanitization
// ============================================================================

/**
 * Sanitize a string for safe output.
 * Prevents XSS by escaping HTML entities.
 */
export function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Sanitize a string for use in SQL (defense-in-depth).
 * Note: Prisma already parameterizes queries, this is an extra layer.
 */
export function sanitizeSql(str: string): string {
  return str.replace(/['";\\]/g, "");
}

/**
 * Sanitize a filename for safe storage.
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+/, "")
    .slice(0, 255);
}

/**
 * Sanitize a URL path. Prevents directory traversal and null byte injection.
 */
export function sanitizePath(path: string): string {
  return path
    .replace(/\0/g, "")           // Remove null bytes (OS path truncation attack)
    .replace(/\.\./g, "")         // Remove directory traversal
    .replace(/\/\//g, "/")        // Collapse double slashes
    .replace(/[^a-zA-Z0-9/._-]/g, ""); // Restrict charset
}

/**
 * Truncate a string to a maximum length.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}
