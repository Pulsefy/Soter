/**
 * Shape of the backend /health response.
 * Aligns with both the simple HealthService and the mobile HealthScreen data model.
 */
export interface BackendHealthResponse {
  status: string; // 'ok' | 'error' | other
  service?: string;
  version?: string;
  environment?: string;
  timestamp?: string;
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
