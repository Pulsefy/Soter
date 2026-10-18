/** Result of a single backend dependency check (app/backend/src/health/health.service.ts). */
export interface HealthCheckResult {
  /** 'up' | 'down' | 'skipped' */
  status: string;
  details?: Record<string, unknown>;
}

/**
 * Shape of the backend /health response.
 * Aligns with the backend `LivenessResponse` (app/backend/src/health/health.service.ts),
 * which returns `{ status, service, version, environment, timestamp, checks }`.
 */
export interface BackendHealthResponse {
  status: string; // 'ok' | 'error' | other
  service?: string;
  version?: string;
  environment?: string;
  timestamp?: string;
  /** Per-dependency checks returned by the liveness endpoint. */
  checks?: Record<string, HealthCheckResult>;
  info?: Record<string, unknown>;
  error?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

export type HealthState = 'ok' | 'degraded' | 'down' | 'loading';

export interface HealthStatusResult {
  state: HealthState;
  data: BackendHealthResponse | null;
  error: Error | null;
  lastChecked: Date | null;
}
