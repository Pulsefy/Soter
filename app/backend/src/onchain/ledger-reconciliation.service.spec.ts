import { NotImplementedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { LedgerReconciliationService } from './ledger-reconciliation.service';
import { StellarLedgerSource } from './stellar-ledger-source';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

const mockQueue = { add: jest.fn(), getJob: jest.fn() };

const mockPrisma = { balanceLedger: { findMany: jest.fn() } };

const mockLedgerSource = {
  isEnabled: jest.fn(),
  fetchLedgerEntries: jest.fn(),
  describeUnavailable: jest.fn(),
  sourceKind: 'soroban-rpc' as const,
};

function makeEntry(overrides: Record<string, any> = {}) {
  return {
    id: 'e1',
    ledger: 1001,
    amount: 1000,
    eventType: 'disburse' as const,
    packageId: 'pkg_testnet',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    txHash: 'abc123',
    eventIndex: 0,
    source: 'soroban-rpc' as const,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LedgerReconciliationService', () => {
  let service: LedgerReconciliationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockLedgerSource.isEnabled.mockReturnValue(true);
    mockLedgerSource.fetchLedgerEntries.mockResolvedValue([]);
    mockLedgerSource.describeUnavailable.mockReturnValue(
      'no on-chain source configured',
    );
    mockPrisma.balanceLedger.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerReconciliationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken('onchain'), useValue: mockQueue },
        { provide: StellarLedgerSource, useValue: mockLedgerSource },
      ],
    }).compile();

    service = module.get<LedgerReconciliationService>(
      LedgerReconciliationService,
    );
  });

  // ── triggerReconciliation ────────────────────────────────────────────────

  describe('triggerReconciliation', () => {
    it('refuses to queue a job that would always pass', async () => {
      mockLedgerSource.isEnabled.mockReturnValue(false);

      await expect(service.triggerReconciliation(1000, 1010)).rejects.toThrow(
        NotImplementedException,
      );
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('queues a job for a configured source', async () => {
      mockQueue.add.mockResolvedValue({ id: 'job_001' });

      const result = await service.triggerReconciliation(1000, 1010);

      expect(mockQueue.add).toHaveBeenCalledWith(
        'ledger-reconciliation',
        expect.objectContaining({ startLedger: 1000, endLedger: 1010 }),
        expect.any(Object),
      );
      expect(result.status).toBe('queued');
      expect(result.totalLedgers).toBe(11);
    });
  });

  // ── processReconciliation ────────────────────────────────────────────────

  describe('processReconciliation', () => {
    it('reports no discrepancy when the chain and the store agree', async () => {
      mockLedgerSource.fetchLedgerEntries.mockResolvedValue([makeEntry()]);
      mockPrisma.balanceLedger.findMany.mockResolvedValue([
        { id: 'e1', amount: 1000, eventType: 'disburse' },
      ]);

      const report = await service.processReconciliation({
        startLedger: 1001,
        endLedger: 1001,
        thresholdPercent: 5,
      });

      expect(report.status).toBe('completed');
      expect(report.checkedLedgers).toBe(1);
      expect(report.summary.totalDiscrepancies).toBe(0);
      expect(report.actionable).toBe(false);
    });

    it('flags a movement present on-chain but missing from the store', async () => {
      mockLedgerSource.fetchLedgerEntries.mockResolvedValue([makeEntry()]);
      mockPrisma.balanceLedger.findMany.mockResolvedValue([]);

      const report = await service.processReconciliation({
        startLedger: 1001,
        endLedger: 1001,
        thresholdPercent: 5,
      });

      expect(report.summary.byType.missing).toBe(1);
      expect(report.summary.bySeverity.high).toBe(1);
      expect(report.actionable).toBe(true);
    });

    it('flags an amount that differs beyond the threshold', async () => {
      mockLedgerSource.fetchLedgerEntries.mockResolvedValue([
        makeEntry({ amount: 1000 }),
      ]);
      mockPrisma.balanceLedger.findMany.mockResolvedValue([
        { id: 'e1', amount: 800, eventType: 'disburse' },
      ]);

      const report = await service.processReconciliation({
        startLedger: 1001,
        endLedger: 1001,
        thresholdPercent: 5,
      });

      expect(report.summary.byType.amount_mismatch).toBe(1);
    });

    it('tolerates an amount difference inside the threshold', async () => {
      mockLedgerSource.fetchLedgerEntries.mockResolvedValue([
        makeEntry({ amount: 1000 }),
      ]);
      mockPrisma.balanceLedger.findMany.mockResolvedValue([
        { id: 'e1', amount: 990, eventType: 'disburse' },
      ]);

      const report = await service.processReconciliation({
        startLedger: 1001,
        endLedger: 1001,
        thresholdPercent: 5,
      });

      expect(report.summary.byType.amount_mismatch).toBe(0);
    });

    it('flags a stored row the chain does not report', async () => {
      mockLedgerSource.fetchLedgerEntries.mockResolvedValue([]);
      mockPrisma.balanceLedger.findMany.mockResolvedValue([
        { id: 'ghost', amount: 10, eventType: 'disburse' },
      ]);

      const report = await service.processReconciliation({
        startLedger: 1001,
        endLedger: 1001,
        thresholdPercent: 5,
      });

      expect(report.summary.byType.missing).toBe(1);
      expect(report.discrepancies[0].severity).toBe('medium');
    });

    it('flags a movement the two sides classify differently', async () => {
      mockLedgerSource.fetchLedgerEntries.mockResolvedValue([
        makeEntry({ eventType: 'lock' }),
      ]);
      mockPrisma.balanceLedger.findMany.mockResolvedValue([
        { id: 'e1', amount: 1000, eventType: 'disburse' },
      ]);

      const report = await service.processReconciliation({
        startLedger: 1001,
        endLedger: 1001,
        thresholdPercent: 5,
      });

      expect(report.summary.byType.event_type_mismatch).toBe(1);
      expect(report.summary.bySeverity.medium).toBe(1);
    });

    it('propagates a source failure rather than reporting a clean run', async () => {
      mockLedgerSource.fetchLedgerEntries.mockRejectedValue(
        new Error('Soroban RPC request failed'),
      );

      await expect(
        service.processReconciliation({
          startLedger: 1001,
          endLedger: 1001,
          thresholdPercent: 5,
        }),
      ).rejects.toThrow('Soroban RPC request failed');
    });
  });
});
