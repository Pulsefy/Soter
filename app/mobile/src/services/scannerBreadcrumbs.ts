import { addBreadcrumb } from './crashReporting';
import { structuredLogger } from './logger';

/**
 * Crash-reporting breadcrumbs for the QR scanner flow.
 *
 * A crash while scanning previously arrived with no context about what the
 * scanner was doing. These helpers record scanner lifecycle events as Sentry
 * breadcrumbs (see `addBreadcrumb` in `./crashReporting`) so the trail is
 * attached to the next crash report.
 *
 * Privacy: raw scanned QR content (and any other free-form value) is never
 * accepted by this module. Every breadcrumb carries only a fixed event name,
 * the scanner mode, and a whitelisted set of numeric counters — so a package
 * id, deep link, wallet address, or evidence blob cannot leak through a
 * breadcrumb even if a caller passes one by mistake.
 */

export type ScannerMode = 'single' | 'bulk';

export type ScannerBreadcrumbEvent =
  | 'scan_started'
  | 'scan_received'
  | 'item_deduped'
  | 'item_deduped_cross_session'
  | 'item_queued'
  | 'item_failed';

export type ScannerFailureReason = 'no_barcode_detected' | 'format_unsupported' | 'low_confidence';

export interface ScannerDiagnosticsSnapshot {
  attempts: number;
  failures: number;
  failureRate: number;
  byCause: Record<ScannerFailureReason, number>;
}

/** Breadcrumb category used for every scanner-flow breadcrumb. */
export const SCANNER_BREADCRUMB_CATEGORY = 'scanner';

/**
 * The only counter fields a scanner breadcrumb may carry. Anything else
 * (notably raw scan payloads) is dropped before the breadcrumb is recorded.
 */
const ALLOWED_COUNT_KEYS = [
  'scanned',
  'verified',
  'failed',
  'skipped',
  'queued',
  'cause',
] as const;

const createDefaultScannerDiagnostics = (): Record<ScannerFailureReason, number> => ({
  no_barcode_detected: 0,
  format_unsupported: 0,
  low_confidence: 0,
});

let scannerDiagnosticsState = {
  attempts: 0,
  failures: 0,
  byCause: createDefaultScannerDiagnostics(),
};

export const determineScannerFailureReason = (
  data?: string | null,
  confidence?: number | null,
): ScannerFailureReason => {
  if (!data || !data.trim()) {
    return 'no_barcode_detected';
  }

  if (typeof confidence === 'number' && Number.isFinite(confidence) && confidence < 0.5) {
    return 'low_confidence';
  }

  return 'format_unsupported';
};

export const resetScannerDiagnostics = (): void => {
  scannerDiagnosticsState = {
    attempts: 0,
    failures: 0,
    byCause: createDefaultScannerDiagnostics(),
  };
};

export const getScannerDiagnosticsSnapshot = (): ScannerDiagnosticsSnapshot => {
  const failureRate =
    scannerDiagnosticsState.attempts > 0
      ? scannerDiagnosticsState.failures / scannerDiagnosticsState.attempts
      : 0;

  return {
    attempts: scannerDiagnosticsState.attempts,
    failures: scannerDiagnosticsState.failures,
    failureRate,
    byCause: { ...scannerDiagnosticsState.byCause },
  };
};

const recordScannerDiagnosticEvent = (
  cause?: ScannerFailureReason,
  counts?: Record<string, unknown>,
): void => {
  const attemptCount = typeof counts?.scanned === 'number' ? Number(counts.scanned) : 0;
  const failedCount = typeof counts?.failed === 'number' ? Number(counts.failed) : 0;

  scannerDiagnosticsState.attempts = Math.max(scannerDiagnosticsState.attempts, attemptCount);

  if (cause) {
    scannerDiagnosticsState.failures = Math.max(scannerDiagnosticsState.failures, failedCount);
    scannerDiagnosticsState.byCause[cause] += 1;
  }

  const snapshot = getScannerDiagnosticsSnapshot();
  structuredLogger.info('scanner.decode.summary', snapshot, 'scanner');
};

export type ScannerCounters = Partial<
  Record<(typeof ALLOWED_COUNT_KEYS)[number], number | ScannerFailureReason>
>;

/**
 * Keep only finite numeric values for the known counter keys.
 *
 * Exported for tests so the "no raw content in breadcrumbs" guarantee can be
 * asserted directly, including against deliberately dirty input.
 */
export function sanitizeScannerBreadcrumbData(
  data?: Record<string, unknown>,
): ScannerCounters {
  const safe: ScannerCounters = {};
  if (!data) return safe;

  for (const key of ALLOWED_COUNT_KEYS) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      safe[key] = value;
      continue;
    }

    if (key === 'cause' && typeof value === 'string' && value in createDefaultScannerDiagnostics()) {
      safe[key] = value as ScannerFailureReason;
    }
  }

  return safe;
}

/**
 * Record one scanner lifecycle breadcrumb.
 *
 * `counts` is intentionally typed as `Record<string, unknown>` at the runtime
 * boundary: `sanitizeScannerBreadcrumbData` strips everything that is not a
 * known numeric counter, so callers cannot smuggle scanned content in.
 */
export function recordScannerBreadcrumb(
  event: ScannerBreadcrumbEvent,
  mode: ScannerMode,
  counts?: Record<string, unknown>,
): void {
  const sanitized = sanitizeScannerBreadcrumbData(counts);

  if (event === 'scan_received') {
    recordScannerDiagnosticEvent(undefined, sanitized as Record<string, unknown>);
  }

  if (event === 'item_failed') {
    const cause =
      typeof counts?.cause === 'string' && counts.cause in createDefaultScannerDiagnostics()
        ? (counts.cause as ScannerFailureReason)
        : undefined;
    recordScannerDiagnosticEvent(cause, sanitized as Record<string, unknown>);
  }

  addBreadcrumb(SCANNER_BREADCRUMB_CATEGORY, `${mode}:${event}`, {
    mode,
    event,
    ...sanitized,
  });
}

/** The scanner screen opened and is ready to scan. */
export function recordScanStarted(mode: ScannerMode): void {
  recordScannerBreadcrumb('scan_started', mode);
}

/** A QR code was decoded (counts only — never the payload). */
export function recordScanReceived(
  mode: ScannerMode,
  counts?: Record<string, unknown>,
): void {
  recordScannerBreadcrumb('scan_received', mode, counts);
}

/** A decoded QR code was dropped by the duplicate-scan debounce. */
export function recordItemDeduped(
  mode: ScannerMode,
  counts?: Record<string, unknown>,
): void {
  recordScannerBreadcrumb('item_deduped', mode, counts);
}

/** A decoded QR code was dropped as a cross-session duplicate. */
export function recordItemDedupedCrossSession(
  mode: ScannerMode,
  counts?: Record<string, unknown>,
): void {
  recordScannerBreadcrumb('item_deduped_cross_session', mode, counts);
}

/** A valid package was accepted and handed to the verification flow. */
export function recordItemQueued(
  mode: ScannerMode,
  counts?: Record<string, unknown>,
): void {
  recordScannerBreadcrumb('item_queued', mode, counts);
}

/** A decode or verification attempt failed. */
export function recordItemFailed(
  mode: ScannerMode,
  counts?: Record<string, unknown>,
): void {
  recordScannerBreadcrumb('item_failed', mode, counts);
}
