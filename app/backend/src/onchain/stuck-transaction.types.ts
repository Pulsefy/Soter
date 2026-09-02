/** Non-terminal statuses — transactions still in-flight. */
export const NON_TERMINAL_STATUSES = new Set<string>(['pending', 'submitted']);

/** Terminal statuses — transactions that will not change. */
export const TERMINAL_STATUSES = new Set<string>([
  'confirmed',
  'failed',
  'expired',
]);

/** Information about a single stuck transaction. */
export interface StuckTransactionInfo {
  id: string;
  claimId: string | null;
  operationType: string;
  status: string;
  txHash: string | null;
  attemptCount: number;
  maxAttempts: number;
  isRetryable: boolean;
  errorType: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  ageInMs: number;
}

/** Aggregated stuck-count metrics grouped by operation type. */
export interface StuckTransactionMetrics {
  totalStuck: number;
  byOperationType: Record<string, number>;
  byErrorType: Record<string, number>;
  oldestStuckAgeMs: number | null;
  generatedAt: Date;
}

/** Configuration for stuck-detection thresholds. */
export interface StuckDetectionConfig {
  /** Maximum age in ms a transaction may sit in a non-terminal state before being flagged. */
  maxAgeMs: number;
  /** How often (ms) the scheduled stuck-detection scan runs. */
  scanIntervalMs: number;
}
