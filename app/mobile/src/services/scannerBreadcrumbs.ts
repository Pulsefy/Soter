import { addBreadcrumb } from './crashReporting';

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
  | 'item_queued'
  | 'item_failed';

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
] as const;

export type ScannerCounters = Partial<
  Record<(typeof ALLOWED_COUNT_KEYS)[number], number>
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
  addBreadcrumb(SCANNER_BREADCRUMB_CATEGORY, `${mode}:${event}`, {
    mode,
    event,
    ...sanitizeScannerBreadcrumbData(counts),
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
