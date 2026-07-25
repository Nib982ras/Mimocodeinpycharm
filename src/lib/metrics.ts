/**
 * Prometheus-compatible metrics collection.
 *
 * Collects and exposes application metrics for monitoring.
 * Metrics are exposed in Prometheus text format at /api/metrics.
 *
 * Available metrics:
 *   - http_requests_total (counter)
 *   - http_request_duration_seconds (histogram)
 *   - http_request_size_bytes (histogram)
 *   - http_response_size_bytes (histogram)
 *   - active_connections (gauge)
 *   - database_query_duration_seconds (histogram)
 *   - encryption_operations_total (counter)
 *   - auth_attempts_total (counter)
 *   - system_active (gauge)
 *   - system_lockdown (gauge)
 *   - cache_hits_total (counter)
 *   - cache_misses_total (counter)
 */

// ============================================================================
// Metric types
// ============================================================================

type MetricType = "counter" | "gauge" | "histogram";

interface MetricDefinition {
  type: MetricType;
  help: string;
  value: number;
  labels?: Record<string, string>;
  buckets?: number[];
}

// ============================================================================
// Metrics storage
// ============================================================================

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histograms = new Map<string, { sum: number; count: number; buckets: Map<number, number> }>();

// ============================================================================
// Counter operations
// ============================================================================

export function incrementCounter(name: string, labels?: Record<string, string>, value: number = 1): void {
  const key = buildKey(name, labels);
  counters.set(key, (counters.get(key) || 0) + value);
}

export function getCounter(name: string, labels?: Record<string, string>): number {
  const key = buildKey(name, labels);
  return counters.get(key) || 0;
}

// ============================================================================
// Gauge operations
// ============================================================================

export function setGauge(name: string, value: number, labels?: Record<string, string>): void {
  const key = buildKey(name, labels);
  gauges.set(key, value);
}

export function incrementGauge(name: string, labels?: Record<string, string>, value: number = 1): void {
  const key = buildKey(name, labels);
  gauges.set(key, (gauges.get(key) || 0) + value);
}

export function decrementGauge(name: string, labels?: Record<string, string>, value: number = 1): void {
  const key = buildKey(name, labels);
  gauges.set(key, (gauges.get(key) || 0) - value);
}

// ============================================================================
// Histogram operations
// ============================================================================

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function observeHistogram(
  name: string,
  value: number,
  labels?: Record<string, string>,
  buckets: number[] = DEFAULT_BUCKETS
): void {
  const key = buildKey(name, labels);

  if (!histograms.has(key)) {
    histograms.set(key, {
      sum: 0,
      count: 0,
      buckets: new Map(buckets.map((b) => [b, 0])),
    });
  }

  const hist = histograms.get(key)!;
  hist.sum += value;
  hist.count += 1;

  for (const bucket of hist.buckets.keys()) {
    if (value <= bucket) {
      hist.buckets.set(bucket, (hist.buckets.get(bucket) || 0) + 1);
    }
  }
}

// ============================================================================
// Helper functions
// ============================================================================

function buildKey(name: string, labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) {
    return name;
  }

  const labelStr = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");

  return `${name}{${labelStr}}`;
}

// ============================================================================
// Prometheus export
// ============================================================================

/**
 * Export all metrics in Prometheus text format.
 */
export function exportMetrics(): string {
  const lines: string[] = [];

  // Counters
  for (const [key, value] of counters) {
    const [name, labels] = parseKey(key);
    lines.push(`# HELP ${name} Counter`);
    lines.push(`# TYPE ${name} counter`);
    if (labels) {
      lines.push(`${name}{${labels}} ${value}`);
    } else {
      lines.push(`${name} ${value}`);
    }
  }

  // Gauges
  for (const [key, value] of gauges) {
    const [name, labels] = parseKey(key);
    lines.push(`# HELP ${name} Gauge`);
    lines.push(`# TYPE ${name} gauge`);
    if (labels) {
      lines.push(`${name}{${labels}} ${value}`);
    } else {
      lines.push(`${name} ${value}`);
    }
  }

  // Histograms
  for (const [key, hist] of histograms) {
    const [name, labels] = parseKey(key);
    lines.push(`# HELP ${name} Histogram`);
    lines.push(`# TYPE ${name} histogram`);

    let cumulativeCount = 0;
    for (const [bucket, count] of hist.buckets) {
      cumulativeCount += count;
      const bucketLabels = labels ? `${labels},` : "";
      lines.push(`${name}_bucket{${bucketLabels}le="${bucket}"} ${cumulativeCount}`);
    }

    const totalLabels = labels ? `${labels},` : "";
    lines.push(`${name}_bucket{${totalLabels}le="+Inf"} ${hist.count}`);
    lines.push(`${name}_sum{${totalLabels}} ${hist.sum}`);
    lines.push(`${name}_count{${totalLabels}} ${hist.count}`);
  }

  return lines.join("\n") + "\n";
}

function parseKey(key: string): [string, string | null] {
  const match = key.match(/^([^({]+)(?:\{(.+)\})?$/);
  if (!match) return [key, null];
  return [match[1], match[2] || null];
}

// ============================================================================
// Pre-defined metrics
// ============================================================================

export const metrics = {
  // HTTP metrics
  httpRequests: (method: string, path: string, status: string) =>
    incrementCounter("http_requests_total", { method, path, status }),

  httpRequestDuration: (method: string, path: string, durationMs: number) =>
    observeHistogram("http_request_duration_seconds", durationMs / 1000, { method, path }),

  httpRequestSize: (method: string, path: string, sizeBytes: number) =>
    observeHistogram("http_request_size_bytes", sizeBytes, { method, path }),

  httpResponseSize: (method: string, path: string, sizeBytes: number) =>
    observeHistogram("http_response_size_bytes", sizeBytes, { method, path }),

  // Connection metrics
  activeConnections: (delta: number) =>
    incrementGauge("active_connections", undefined, delta),

  // Database metrics
  databaseQueryDuration: (operation: string, durationMs: number) =>
    observeHistogram("database_query_duration_seconds", durationMs / 1000, { operation }),

  // Crypto metrics
  encryptionOperations: (operation: string) =>
    incrementCounter("encryption_operations_total", { operation }),

  // Auth metrics
  authAttempts: (method: string, status: string) =>
    incrementCounter("auth_attempts_total", { method, status }),

  // System metrics
  systemActive: (active: boolean) =>
    setGauge("system_active", active ? 1 : 0),

  systemLockdown: (lockdown: boolean) =>
    setGauge("system_lockdown", lockdown ? 1 : 0),

  // Cache metrics
  cacheHit: (cache: string) =>
    incrementCounter("cache_hits_total", { cache }),

  cacheMiss: (cache: string) =>
    incrementCounter("cache_misses_total", { cache }),
};

// ============================================================================
// Middleware for automatic HTTP metrics
// ============================================================================

/**
 * Record HTTP request metrics.
 * Call this at the start and end of each request.
 */
export function recordRequestMetrics(
  method: string,
  path: string,
  status: number,
  durationMs: number,
  requestSize?: number,
  responseSize?: number
): void {
  metrics.httpRequests(method, path, String(status));
  metrics.httpRequestDuration(method, path, durationMs);

  if (requestSize !== undefined) {
    metrics.httpRequestSize(method, path, requestSize);
  }

  if (responseSize !== undefined) {
    metrics.httpResponseSize(method, path, responseSize);
  }
}
