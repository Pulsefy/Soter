import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DEFAULT_RECONCILIATION_ALERT_REPORT_URL,
  LedgerReconciliationAlertService,
  reconciliationAlertDedupKey,
} from './ledger-reconciliation-alert.service';
import type { LedgerBalanceReconciliationReport } from './ledger-reconciliation.service';

describe('LedgerReconciliationAlertService', () => {
  let service: LedgerReconciliationAlertService;

  const prismaMock = {
    notificationOutbox: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  const configMock = {
    get: jest.fn(),
  };

  const notificationsMock = {
    sendEmail: jest.fn(),
  };

  const report = (
    overrides: Partial<LedgerBalanceReconciliationReport> = {},
  ): LedgerBalanceReconciliationReport => ({
    runId: 'run-1',
    generatedAt: '2026-10-19T00:00:00.000Z',
    dryRun: false,
    source: 'scheduled',
    tolerancePercent: 0.5,
    toleranceAbsolute: '0',
    pairsChecked: 1,
    discrepancies: [
      {
        campaignId: 'campaign-1',
        tokenAddress: 'token-A',
        expected: '900',
        actual: '1000',
        difference: '100',
        differencePercent: 11.1111,
        tolerance: '4',
        severity: 'high',
        onchainClaimed: '0',
        ledgerEntryCount: 3,
      },
    ],
    skipped: [],
    durationMs: 12,
    actionable: true,
    summary: {
      totalChecked: 1,
      totalDiscrepancies: 1,
      withinTolerance: 0,
      bySeverity: { low: 0, medium: 0, high: 1 },
      byCampaign: { 'campaign-1': 1 },
    },
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    configMock.get.mockImplementation((key: string) => {
      if (key === 'LEDGER_RECONCILIATION_ALERT_RECIPIENTS') {
        return 'ops@example.org';
      }
      return undefined;
    });
    prismaMock.notificationOutbox.findFirst.mockResolvedValue(null);
    prismaMock.notificationOutbox.update.mockResolvedValue({});
    notificationsMock.sendEmail.mockResolvedValue({
      outboxId: 'outbox-1',
      jobId: 'job-1',
    });

    service = new LedgerReconciliationAlertService(
      prismaMock as unknown as PrismaService,
      configMock as unknown as ConfigService,
      notificationsMock as unknown as NotificationsService,
    );
  });

  it('emails operators when a run exceeds the threshold', async () => {
    await service.notifyIfThresholdExceeded(report());

    expect(notificationsMock.sendEmail).toHaveBeenCalledTimes(1);
    const call = notificationsMock.sendEmail.mock.calls[0];
    expect(call[0]).toBe('ops@example.org');
    expect(call[1]).toContain('1 discrepancy found');
    expect(call[2]).toContain('high=1');
    expect(call[2]).toContain('campaign-1=1');
    expect(call[2]).toContain(
      `Full report: ${DEFAULT_RECONCILIATION_ALERT_REPORT_URL}`,
    );

    expect(prismaMock.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: {
        metadata: expect.stringContaining(
          reconciliationAlertDedupKey(report().discrepancies),
        ),
      },
    });
  });

  it('does not re-alert when the same discrepancy set was already reported', async () => {
    prismaMock.notificationOutbox.findFirst.mockResolvedValue({ id: 'old' });

    await service.notifyIfThresholdExceeded(report());

    expect(notificationsMock.sendEmail).not.toHaveBeenCalled();
  });

  it('re-alerts when the discrepancy set changes', async () => {
    const changed = report({
      discrepancies: [
        {
          campaignId: 'campaign-2',
          tokenAddress: 'token-B',
          expected: '0',
          actual: '500',
          difference: '500',
          differencePercent: 100,
          tolerance: '0',
          severity: 'high',
          onchainClaimed: '0',
          ledgerEntryCount: 1,
        },
      ],
    });

    await service.notifyIfThresholdExceeded(changed);

    const dedupKey = reconciliationAlertDedupKey(changed.discrepancies);
    expect(prismaMock.notificationOutbox.findFirst).toHaveBeenCalledWith({
      where: {
        metadata: { contains: `"reconciliationAlertKey":"${dedupKey}"` },
      },
      select: { id: true },
    });
    expect(notificationsMock.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the run is within the configured threshold', async () => {
    configMock.get.mockImplementation((key: string) => {
      if (key === 'LEDGER_RECONCILIATION_ALERT_RECIPIENTS') {
        return 'ops@example.org';
      }
      if (key === 'LEDGER_RECONCILIATION_ALERT_MIN_DISCREPANCIES') {
        return '10';
      }
      return undefined;
    });
    const low = report({
      discrepancies: [
        {
          campaignId: 'campaign-1',
          tokenAddress: 'token-A',
          expected: '900',
          actual: '901',
          difference: '1',
          differencePercent: 0.1,
          tolerance: '4',
          severity: 'low',
          onchainClaimed: '0',
          ledgerEntryCount: 3,
        },
      ],
      summary: {
        totalChecked: 1,
        totalDiscrepancies: 1,
        withinTolerance: 0,
        bySeverity: { low: 1, medium: 0, high: 0 },
        byCampaign: { 'campaign-1': 1 },
      },
    });

    await service.notifyIfThresholdExceeded(low);

    expect(notificationsMock.sendEmail).not.toHaveBeenCalled();
  });

  it('does nothing on a clean run', async () => {
    const clean = report({
      discrepancies: [],
      actionable: false,
      summary: {
        totalChecked: 1,
        totalDiscrepancies: 0,
        withinTolerance: 1,
        bySeverity: { low: 0, medium: 0, high: 0 },
        byCampaign: {},
      },
    });

    await service.notifyIfThresholdExceeded(clean);

    expect(prismaMock.notificationOutbox.findFirst).not.toHaveBeenCalled();
    expect(notificationsMock.sendEmail).not.toHaveBeenCalled();
  });
});
