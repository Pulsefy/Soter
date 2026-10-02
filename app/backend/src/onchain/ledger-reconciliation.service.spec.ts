import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';

import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { OnchainAdapter } from './onchain.adapter';
import {
  LEDGER_RECONCILIATION_AUDIT_ENTITY,
  LEDGER_RECONCILIATION_DISCREPANCY_METRIC,
  LEDGER_RECONCILIATION_DISCREPANCIES_GAUGE,
  LedgerReconciliationService,
} from './ledger-reconciliation.service';

describe('LedgerReconciliationService', () => {
  let service: LedgerReconciliationService;

  const prismaMock = {
    balanceLedger: {
      aggregate: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    sorobanTransaction: {
      findMany: jest.fn(),
    },
  };

  const queueMock = {
    add: jest.fn(),
    getJob: jest.fn(),
  };

  const adapterMock = {
    getCampaignTokenTotals: jest.fn(),
  };

  const configMock = {
    get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
  };

  const metricsMock = {
    incrementCounter: jest.fn(),
    setGauge: jest.fn(),
    recordHistogram: jest.fn(),
  };

  const auditMock = {
    record: jest.fn(),
  };

  const onchainTotals = (
    campaignRef: string,
    tokenAddress: string,
    totalLocked: string,
    totalClaimed = '0',
  ) => ({
    totals: {
      campaignRef,
      tokenAddress,
      totalLocked,
      totalClaimed,
    },
    timestamp: new Date(),
  });

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.balanceLedger.aggregate.mockResolvedValue({
      _sum: { amount: 0 },
    });
    prismaMock.balanceLedger.count.mockResolvedValue(0);
    prismaMock.balanceLedger.findMany.mockResolvedValue([]);
    prismaMock.sorobanTransaction.findMany.mockResolvedValue([]);
    configMock.get.mockImplementation(
      (_key: string, defaultValue?: unknown) => defaultValue,
    );

    service = new LedgerReconciliationService(
      prismaMock as unknown as PrismaService,
      queueMock as unknown as Queue,
      adapterMock as unknown as OnchainAdapter,
      configMock as unknown as ConfigService,
      metricsMock as unknown as MetricsService,
      auditMock as unknown as AuditService,
    );
  });

  it('reports a campaign/token whose ledger total disagrees with the chain', async () => {
    prismaMock.balanceLedger.findMany.mockResolvedValue([
      { campaignId: 'campaign-1' },
    ]);
    prismaMock.sorobanTransaction.findMany.mockResolvedValue([
      { tokenAddress: 'token-A', claim: { campaignId: 'campaign-1' } },
    ]);
    prismaMock.balanceLedger.aggregate.mockResolvedValue({
      _sum: { amount: 1000 },
    });
    prismaMock.balanceLedger.count.mockResolvedValue(3);
    adapterMock.getCampaignTokenTotals.mockResolvedValue(
      onchainTotals('campaign-1', 'token-A', '900', '250'),
    );

    const report = await service.reconcileBalances();

    expect(report.pairsChecked).toBe(1);
    expect(report.summary.totalDiscrepancies).toBe(1);
    expect(report.summary.withinTolerance).toBe(0);
    expect(report.discrepancies).toEqual([
      {
        campaignId: 'campaign-1',
        tokenAddress: 'token-A',
        expected: '900',
        actual: '1000',
        difference: '100',
        differencePercent: 11.1111,
        tolerance: '4',
        severity: 'high',
        onchainClaimed: '250',
        ledgerEntryCount: 3,
      },
    ]);
    expect(report.actionable).toBe(true);

    expect(metricsMock.incrementCounter).toHaveBeenCalledWith(
      LEDGER_RECONCILIATION_DISCREPANCY_METRIC,
      {
        campaign_id: 'campaign-1',
        token_address: 'token-A',
        severity: 'high',
      },
    );
    expect(metricsMock.setGauge).toHaveBeenCalledWith(
      LEDGER_RECONCILIATION_DISCREPANCIES_GAUGE,
      1,
    );

    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: LEDGER_RECONCILIATION_AUDIT_ENTITY,
        entityId: report.runId,
        action: 'balance_discrepancy_high',
        metadata: expect.objectContaining({
          campaignId: 'campaign-1',
          tokenAddress: 'token-A',
          expected: '900',
          actual: '1000',
          difference: '100',
        }),
      }),
    );
  });

  it('reports nothing when the ledger agrees with the chain within tolerance', async () => {
    prismaMock.balanceLedger.findMany.mockResolvedValue([
      { campaignId: 'campaign-1' },
    ]);
    prismaMock.sorobanTransaction.findMany.mockResolvedValue([
      { tokenAddress: 'token-A', claim: { campaignId: 'campaign-1' } },
    ]);
    prismaMock.balanceLedger.aggregate.mockResolvedValue({
      _sum: { amount: 902 },
    });
    adapterMock.getCampaignTokenTotals.mockResolvedValue(
      onchainTotals('campaign-1', 'token-A', '900'),
    );

    const report = await service.reconcileBalances();

    expect(report.discrepancies).toEqual([]);
    expect(report.summary.totalDiscrepancies).toBe(0);
    expect(report.summary.withinTolerance).toBe(1);
    expect(report.actionable).toBe(false);
    expect(auditMock.record).not.toHaveBeenCalled();
    expect(metricsMock.setGauge).toHaveBeenCalledWith(
      LEDGER_RECONCILIATION_DISCREPANCIES_GAUGE,
      0,
    );
  });

  it('honours an explicit tolerance override', async () => {
    prismaMock.balanceLedger.findMany.mockResolvedValue([
      { campaignId: 'campaign-1' },
    ]);
    prismaMock.sorobanTransaction.findMany.mockResolvedValue([
      { tokenAddress: 'token-A', claim: { campaignId: 'campaign-1' } },
    ]);
    prismaMock.balanceLedger.aggregate.mockResolvedValue({
      _sum: { amount: 1000 },
    });
    adapterMock.getCampaignTokenTotals.mockResolvedValue(
      onchainTotals('campaign-1', 'token-A', '900'),
    );

    const report = await service.reconcileBalances({ tolerancePercent: 20 });

    expect(report.tolerancePercent).toBe(20);
    expect(report.discrepancies).toEqual([]);
  });

  it('does not persist or emit discrepancy metrics on a dry run', async () => {
    prismaMock.balanceLedger.findMany.mockResolvedValue([
      { campaignId: 'campaign-1' },
    ]);
    prismaMock.sorobanTransaction.findMany.mockResolvedValue([
      { tokenAddress: 'token-A', claim: { campaignId: 'campaign-1' } },
    ]);
    prismaMock.balanceLedger.aggregate.mockResolvedValue({
      _sum: { amount: 1000 },
    });
    adapterMock.getCampaignTokenTotals.mockResolvedValue(
      onchainTotals('campaign-1', 'token-A', '900'),
    );

    const report = await service.reconcileBalances({ dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.discrepancies).toHaveLength(1);
    expect(auditMock.record).not.toHaveBeenCalled();
    expect(metricsMock.incrementCounter).not.toHaveBeenCalled();
    expect(metricsMock.setGauge).not.toHaveBeenCalled();
    expect(service.getLastBalanceReconciliationReport()).toBe(report);
  });

  it('skips campaigns that have no on-chain token reference', async () => {
    prismaMock.balanceLedger.findMany.mockResolvedValue([
      { campaignId: 'campaign-1' },
      { campaignId: 'campaign-2' },
    ]);
    prismaMock.sorobanTransaction.findMany.mockResolvedValue([
      { tokenAddress: 'token-A', claim: { campaignId: 'campaign-1' } },
    ]);
    adapterMock.getCampaignTokenTotals.mockResolvedValue(
      onchainTotals('campaign-1', 'token-A', '0'),
    );

    const report = await service.reconcileBalances();

    expect(adapterMock.getCampaignTokenTotals).toHaveBeenCalledTimes(1);
    expect(report.skipped).toEqual([
      {
        campaignId: 'campaign-2',
        tokenAddress: '',
        reason: 'no_onchain_token_reference',
      },
    ]);
  });

  it('accepts explicitly supplied campaign/token pairs', async () => {
    adapterMock.getCampaignTokenTotals.mockResolvedValue(
      onchainTotals('campaign-9', 'token-Z', '500'),
    );
    prismaMock.balanceLedger.aggregate.mockResolvedValue({
      _sum: { amount: 500 },
    });

    const report = await service.reconcileBalances({
      campaigns: [{ campaignId: 'campaign-9', tokenAddress: 'token-Z' }],
    });

    expect(prismaMock.balanceLedger.findMany).not.toHaveBeenCalled();
    expect(adapterMock.getCampaignTokenTotals).toHaveBeenCalledWith({
      campaignRef: 'campaign-9',
      tokenAddress: 'token-Z',
    });
    expect(report.summary.withinTolerance).toBe(1);
  });

  it('records a skipped entry when the on-chain read fails', async () => {
    prismaMock.balanceLedger.findMany.mockResolvedValue([
      { campaignId: 'campaign-1' },
    ]);
    prismaMock.sorobanTransaction.findMany.mockResolvedValue([
      { tokenAddress: 'token-A', claim: { campaignId: 'campaign-1' } },
    ]);
    adapterMock.getCampaignTokenTotals.mockRejectedValue(
      new Error('rpc unavailable'),
    );

    const report = await service.reconcileBalances();

    expect(report.discrepancies).toEqual([]);
    expect(report.skipped).toEqual([
      {
        campaignId: 'campaign-1',
        tokenAddress: 'token-A',
        reason: 'onchain_read_failed: rpc unavailable',
      },
    ]);
  });

  it('is registered as an hourly scheduled job by default', () => {
    const metadata = Reflect.getOwnMetadata(
      'SCHEDULE_CRON_OPTIONS',
      service.handleScheduledBalanceReconciliation,
    ) as { cronTime?: string; name?: string } | undefined;

    expect(metadata?.name).toBe('ledger-balance-reconciliation');
    expect(metadata?.cronTime).toBe(CronExpression.EVERY_HOUR);
  });

  it('still queues the legacy ledger-range reconciliation job', async () => {
    queueMock.add.mockResolvedValue({ id: 'job-1' });

    const report = await service.triggerReconciliation(100, 110, 'campaign-1');

    expect(report.status).toBe('queued');
    expect(report.jobId).toBe('job-1');
    expect(queueMock.add).toHaveBeenCalledWith(
      'ledger-reconciliation',
      expect.objectContaining({
        startLedger: 100,
        endLedger: 110,
        campaignId: 'campaign-1',
      }),
      expect.any(Object),
    );
  });
});
