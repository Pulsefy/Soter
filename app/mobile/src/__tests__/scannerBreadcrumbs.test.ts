import * as Sentry from '@sentry/react-native';
import { initCrashReporting } from '../services/crashReporting';
import {
  recordItemDeduped,
  recordItemFailed,
  recordItemQueued,
  recordScanReceived,
  recordScanStarted,
  sanitizeScannerBreadcrumbData,
} from '../services/scannerBreadcrumbs';

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
  withScope: jest.fn(),
  setExtras: jest.fn(),
  enableSessionTracking: jest.fn(),
  close: jest.fn(),
  flush: jest.fn().mockResolvedValue(true),
}));

const addBreadcrumbMock = Sentry.addBreadcrumb as jest.Mock;
const initMock = Sentry.init as jest.Mock;

const recordedCrumbs = (): any[] =>
  addBreadcrumbMock.mock.calls.map(([crumb]) => crumb);

describe('scanner crash-reporting breadcrumbs', () => {
  beforeEach(() => {
    addBreadcrumbMock.mockClear();
    initMock.mockClear();
  });

  it('records the scanner lifecycle as breadcrumbs consumed by the crash reporter', () => {
    recordScanStarted('bulk');
    recordScanReceived('bulk', { scanned: 1 });
    recordItemDeduped('bulk', { scanned: 1, skipped: 1 });
    recordItemQueued('bulk', { scanned: 1, verified: 1 });

    const crumbs = recordedCrumbs();
    expect(crumbs.map((crumb) => crumb.message)).toEqual([
      'bulk:scan_started',
      'bulk:scan_received',
      'bulk:item_deduped',
      'bulk:item_queued',
    ]);
    expect(crumbs.every((crumb) => crumb.category === 'scanner')).toBe(true);
    expect(addBreadcrumbMock).toHaveBeenCalledTimes(4);
  });

  it('excludes raw scanned content and keeps only numeric counters', () => {
    expect(
      sanitizeScannerBreadcrumbData({
        scanned: 2,
        skipped: Number.NaN,
        qrPayload: 'soter://package/aid-secret-123',
        raw: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
        nested: { evidence: 'data:image/png;base64,AAAA' },
      }),
    ).toEqual({ scanned: 2 });

    recordScanReceived('single', {
      scanned: 1,
      qrPayload: 'soter://package/aid-secret-123',
    });

    expect(recordedCrumbs()[0].data).toEqual({
      mode: 'single',
      event: 'scan_received',
      scanned: 1,
    });
    expect(JSON.stringify(recordedCrumbs())).not.toContain('aid-secret-123');
  });

  it('carries the breadcrumb trail into a simulated crash report', () => {
    initCrashReporting(true);
    const initOptions = initMock.mock.calls[0][0];
    expect(typeof initOptions.beforeSend).toBe('function');

    recordScanStarted('single');
    recordScanReceived('single', { scanned: 1 });
    recordItemFailed('single', { scanned: 1, failed: 1 });

    // A crash during scanning: the queued breadcrumbs are attached to the
    // event, then the reporter's beforeSend scrubber runs over the report.
    const report = initOptions.beforeSend({
      breadcrumbs: {
        values: recordedCrumbs().map((crumb) => ({
          ...crumb,
          data: { ...crumb.data },
        })),
      },
      extra: {},
    });

    expect(report.breadcrumbs.values.map((crumb: any) => crumb.message)).toEqual([
      'single:scan_started',
      'single:scan_received',
      'single:item_failed',
    ]);
    expect(JSON.stringify(report.breadcrumbs)).not.toContain('[REDACTED]');
  });
});
