/**
 * Cursor-based pagination utilities for API list endpoints.
 *
 * Uses cursor-based pagination (keyset pagination) instead of offset-based:
 *   - More efficient for large datasets (no OFFSET scan)
 *   - Consistent results when records are inserted/deleted during pagination
 *   - Works well with database indexes
 *
 * Query parameters:
 *   - cursor: The ID of the last item from the previous page (opaque string)
 *   - limit: Number of items per page (default 50, max 200)
 *   - sort: Sort direction ("asc" or "desc", default "desc")
 *
 * Response shape:
 *   - data: Array of items
 *   - pagination: { nextCursor, hasMore, limit, count }
 */

// ---------- Types ----------

export interface PaginationParams {
  /** Cursor (ID of the last item from previous page) */
  cursor?: string;
  /** Items per page */
  limit: number;
  /** Sort direction */
  sort: "asc" | "desc";
}

export interface PaginationMeta {
  /** Cursor to pass for the next page (null if no more pages) */
  nextCursor: string | null;
  /** Whether there are more items after this page */
  hasMore: boolean;
  /** The requested limit */
  limit: number;
  /** Number of items returned in this page */
  count: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

// ---------- Parsing ----------

/** Default page size */
const DEFAULT_LIMIT = 50;
/** Maximum page size */
const MAX_LIMIT = 200;

/**
 * Parse pagination parameters from URL search params.
 *
 * @param url - The request URL
 * @param defaultSort - Default sort direction ("desc" for newest first)
 * @returns Parsed pagination parameters
 */
export function parsePagination(
  url: URL,
  defaultSort: "asc" | "desc" = "desc"
): PaginationParams {
  const cursor = url.searchParams.get("cursor") || undefined;
  const rawLimit = parseInt(url.searchParams.get("limit") || String(DEFAULT_LIMIT), 10);
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? DEFAULT_LIMIT : rawLimit), MAX_LIMIT);
  const sortParam = url.searchParams.get("sort");
  const sort = sortParam === "asc" ? "asc" : sortParam === "desc" ? "desc" : defaultSort;

  return { cursor, limit, sort };
}

// ---------- Query building ----------

/**
 * Build a Prisma where clause with cursor-based pagination.
 * Adds a cursor condition to filter records after the cursor ID.
 *
 * @param baseWhere - The base where clause for the query
 * @param pagination - Parsed pagination parameters
 * @param sortField - The field used for sorting (must be unique or the cursor field)
 * @returns Modified where clause with cursor condition
 */
export function buildCursorWhere<T extends Record<string, unknown>>(
  baseWhere: T,
  pagination: PaginationParams,
  sortField: string = "createdAt"
): T {
  if (!pagination.cursor) return baseWhere;

  // For cursor-based pagination, we need to filter records after the cursor.
  // The cursor is an ID, but we sort by sortField, so we need to get the
  // sortField value for the cursor record first. For simplicity, we use
  // the cursor ID with a createdAt-based approach.
  const cursorDate = decodeCursor(pagination.cursor);

  if (pagination.sort === "desc") {
    return {
      ...baseWhere,
      OR: [
        { [sortField]: { lt: cursorDate } },
        {
          AND: [
            { [sortField]: cursorDate },
            { id: { gt: pagination.cursor } },
          ],
        },
      ],
    } as T;
  } else {
    return {
      ...baseWhere,
      OR: [
        { [sortField]: { gt: cursorDate } },
        {
          AND: [
            { [sortField]: cursorDate },
            { id: { lt: pagination.cursor } },
          ],
        },
      ],
    } as T;
  }
}

/**
 * Simple cursor-based pagination using ID only.
 * For most cases, sorting by createdAt descending and using ID as cursor is sufficient.
 * This avoids the complexity of decoding cursor timestamps.
 *
 * @param baseWhere - The base where clause
 * @param pagination - Parsed pagination parameters
 * @returns Modified where clause
 */
export function buildIdCursorWhere<T extends Record<string, unknown>>(
  baseWhere: T,
  pagination: PaginationParams
): T {
  if (!pagination.cursor) return baseWhere;

  if (pagination.sort === "desc") {
    return { ...baseWhere, id: { lt: pagination.cursor } } as T;
  } else {
    return { ...baseWhere, id: { gt: pagination.cursor } } as T;
  }
}

// ---------- Cursor encoding/decoding ----------

/**
 * Encode a cursor from an item's ID and sort field value.
 * Format: base64(JSON.stringify({ id, ts }))
 */
export function encodeCursor(id: string, sortFieldValue: Date | string): string {
  const ts = sortFieldValue instanceof Date ? sortFieldValue.getTime() : new Date(sortFieldValue).getTime();
  return Buffer.from(JSON.stringify({ id, ts })).toString("base64url");
}

/**
 * Decode a cursor to extract the timestamp.
 * Returns a Date from the cursor's timestamp.
 */
export function decodeCursor(cursor: string): Date {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return new Date(decoded.ts);
  } catch {
    // Fallback: treat cursor as an opaque ID
    return new Date(0);
  }
}

/**
 * Decode a cursor to extract both ID and timestamp.
 */
export function decodeCursorFull(cursor: string): { id: string; ts: number } | null {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// ---------- Response building ----------

/**
 * Build a paginated response.
 *
 * @param items - The items for the current page (fetch limit + 1 to detect hasMore)
 * @param pagination - The pagination parameters
 * @param mapFn - Optional function to transform items
 * @returns Paginated response with nextCursor and hasMore
 */
export function paginatedResponse<T, R = T>(
  items: T[],
  pagination: PaginationParams,
  mapFn?: (item: T) => R
): PaginatedResponse<R> {
  // We fetch limit + 1 to detect if there are more items
  const hasMore = items.length > pagination.limit;
  const data = hasMore ? items.slice(0, pagination.limit) : items;
  const lastItem = data[data.length - 1];

  // Generate nextCursor from the last item
  let nextCursor: string | null = null;
  if (hasMore && lastItem) {
    const item = lastItem as Record<string, unknown>;
    const id = item.id as string;
    const sortField = item.createdAt;
    if (id && sortField) {
      nextCursor = encodeCursor(id, sortField as Date | string);
    } else {
      nextCursor = id || null;
    }
  }

  return {
    data: mapFn ? data.map(mapFn) : (data as unknown as R[]),
    pagination: {
      nextCursor,
      hasMore,
      limit: pagination.limit,
      count: data.length,
    },
  };
}

/**
 * Simple paginated response builder for when you've already fetched exactly limit items.
 * Use this when you know there might be more items but don't want the +1 trick.
 */
export function simplePaginatedResponse<T, R = T>(
  items: T[],
  pagination: PaginationParams,
  totalEstimate?: number,
  mapFn?: (item: T) => R
): PaginatedResponse<R> {
  const lastItem = items[items.length - 1];
  let nextCursor: string | null = null;

  if (items.length === pagination.limit && lastItem) {
    const item = lastItem as Record<string, unknown>;
    nextCursor = (item.id as string) || null;
  }

  return {
    data: mapFn ? items.map(mapFn) : (items as unknown as R[]),
    pagination: {
      nextCursor,
      hasMore: items.length === pagination.limit,
      limit: pagination.limit,
      count: items.length,
    },
  };
}
