import { Test, TestingModule } from '@nestjs/testing';
import { SorobanTransactionLifecycleService } from '../soroban-transaction-lifecycle.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricsService } from '../../observability/metrics/metrics.service';
import { ONCHAIN_ADAPTER_TOKEN } from '../onchain.adapter';
import { SorobanTransactionStatus, SorobanOperationType } from '@prisma/client';

function createMockPrisma() {
  return {
    sorobanTransaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      fields: { maxAttempts: 5 },
    },
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };
}

function createMockMetrics() {
  return {
    incrementCounter: jest.fn(),
    recordSorobanTransactionLatency: jest.fn(),
  };
}

function createMockAdapter() {
  return {
    createClaim: jest.fn(),
    disburse: jest.fn(),
    initEscrow: jest.fn(),
  };
}

function makeTx(overrides: Record<string, any> = {}) {
  return {
    id: 'tx-001',
    claimId: 'claim-001',
    operation: SorobanOperationType.create_claim,
    status: SorobanTransactionStatus.pending,
    txHash: null,
    attemptCount: 0,
    maxAttempts: 5,
    lastRetryAt: null,
    nextRetryAt: new Date(),
    lastError: null,
    errorType: null,
    isRetryable: true,
    operatorAddress: null,
    recipientAddress: null,
    amount: null,
    tokenAddress: null,
    initiatedAt: new Date('2026-01-01T00:00:00Z'),
    submittedAt: null,
    confirmedAt: null,
    failedAt: null,
    expiredAt: null,
    correlationId: null,
    metadata: null,
    packageId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:01:00Z'),
    ...overrides,
  };
}

describe('SorobanTransactionLifecycleService', () => {
  let service: SorobanTransactionLifecycleService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let metrics: ReturnType<typeof createMockMetrics>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    metrics = createMockMetrics();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanTransactionLifecycleService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetricsService, useValue: metrics },
        { provide: ONCHAIN_ADAPTER_TOKEN, useValue: createMockAdapter() },
      ],
    }).compile();

    service = module.get<SorobanTransactionLifecycleService>(
      SorobanTransactionLifecycleService,
    );

    // Set a short age threshold for tests
    service.configureStuckDetection({ maxAgeMs: 5 * 60 * 1000 }); // 5 minutes
  });

  // ── detectStuckTransactions ──────────────────────────────────────

  describe('detectStuckTransactions', () => {
    it('should flag transactions older than maxAgeMs as stuck', async () => {
      const txOld = makeTx({
        id: 'tx-old',
        operation: SorobanOperationType.create_claim,
        status: SorobanTransactionStatus.submitted,
        createdAt: new Date(Date.now() - 600_000), // 10 min ago
      });

      // Only return the old tx since the service filters by createdAt < cutoff
      prisma.sorobanTransaction.findMany.mockResolvedValue([txOld]);

      const stuck = await service.detectStuckTransactions();

      // txOld: 10min > 5min → stuck
      // txYoung: 1min ≤ 5min → not stuck
      expect(stuck).toHaveLength(1);
      expect(stuck[0].id).toBe('tx-old');
      expect(stuck[0].ageInMs).toBeGreaterThanOrEqual(599_000);
      expect(stuck[0].operationType).toBe('create_claim');
    });

    it('should only query pending and submitted statuses', async () => {
      prisma.sorobanTransaction.findMany.mockResolvedValue([]);

      await service.detectStuckTransactions();

      expect(prisma.sorobanTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: {
              in: [
                SorobanTransactionStatus.pending,
                SorobanTransactionStatus.submitted,
              ],
            },
          }),
        }),
      );
    });

    it('should mark stuck transactions with isRetryable info', async () => {
      const txRetryable = makeTx({
        id: 'tx-r',
        operation: SorobanOperationType.create_claim,
        status: SorobanTransactionStatus.pending,
        isRetryable: true,
        errorType: 'network_timeout',
        lastError: 'Connection timed out',
        createdAt: new Date(Date.now() - 600_000),
      });

      prisma.sorobanTransaction.findMany.mockResolvedValue([txRetryable]);

      const stuck = await service.detectStuckTransactions();

      expect(stuck).toHaveLength(1);
      expect(stuck[0].isRetryable).toBe(true);
      expect(stuck[0].errorType).toBe('network_timeout');
      expect(stuck[0].lastError).toBe('Connection timed out');
    });

    it('should mark non-retryable stuck transactions correctly', async () => {
      const txTerminal = makeTx({
        id: 'tx-t',
        operation: SorobanOperationType.disburse_claim,
        status: SorobanTransactionStatus.pending,
        isRetryable: false,
        createdAt: new Date(Date.now() - 600_000),
      });

      prisma.sorobanTransaction.findMany.mockResolvedValue([txTerminal]);

      const stuck = await service.detectStuckTransactions();

      expect(stuck).toHaveLength(1);
      expect(stuck[0].isRetryable).toBe(false);
    });

    it('should return empty when no stuck transactions', async () => {
      prisma.sorobanTransaction.findMany.mockResolvedValue([]);

      const stuck = await service.detectStuckTransactions();

      expect(stuck).toHaveLength(0);
    });
  });

  // ── getStuckMetrics ─────────────────────────────────────────────

  describe('getStuckMetrics', () => {
    it('should aggregate stuck counts by operation type', async () => {
      const txs = [
        makeTx({
          id: 'tx-1',
          operation: SorobanOperationType.create_claim,
          status: SorobanTransactionStatus.submitted,
          createdAt: new Date(Date.now() - 600_000),
        }),
        makeTx({
          id: 'tx-2',
          operation: SorobanOperationType.create_claim,
          status: SorobanTransactionStatus.pending,
          createdAt: new Date(Date.now() - 700_000),
        }),
        makeTx({
          id: 'tx-3',
          operation: SorobanOperationType.disburse_claim,
          status: SorobanTransactionStatus.submitted,
          createdAt: new Date(Date.now() - 800_000),
        }),
      ];

      prisma.sorobanTransaction.findMany.mockResolvedValue(txs);

      await service.detectStuckTransactions();
      const metrics = service.getStuckMetrics();

      expect(metrics.totalStuck).toBe(3);
      expect(metrics.byOperationType).toEqual({
        create_claim: 2,
        disburse_claim: 1,
      });
      expect(metrics.oldestStuckAgeMs).toBeGreaterThanOrEqual(799_000);
      expect(metrics.generatedAt).toBeInstanceOf(Date);
    });

    it('should aggregate stuck counts by error type', async () => {
      const txs = [
        makeTx({
          id: 'tx-r1',
          operation: SorobanOperationType.create_claim,
          status: SorobanTransactionStatus.submitted,
          errorType: 'network_timeout',
          createdAt: new Date(Date.now() - 600_000),
        }),
        makeTx({
          id: 'tx-r2',
          operation: SorobanOperationType.create_claim,
          status: SorobanTransactionStatus.submitted,
          errorType: 'network_timeout',
          createdAt: new Date(Date.now() - 700_000),
        }),
        makeTx({
          id: 'tx-r3',
          operation: SorobanOperationType.disburse_claim,
          status: SorobanTransactionStatus.pending,
          errorType: 'rate_limit',
          createdAt: new Date(Date.now() - 800_000),
        }),
      ];

      prisma.sorobanTransaction.findMany.mockResolvedValue(txs);

      await service.detectStuckTransactions();
      const metrics = service.getStuckMetrics();

      expect(metrics.byErrorType).toEqual({
        network_timeout: 2,
        rate_limit: 1,
      });
    });

    it('should return zero metrics when no stuck transactions', async () => {
      prisma.sorobanTransaction.findMany.mockResolvedValue([]);

      await service.detectStuckTransactions();
      const metrics = service.getStuckMetrics();

      expect(metrics.totalStuck).toBe(0);
      expect(metrics.byOperationType).toEqual({});
      expect(metrics.byErrorType).toEqual({});
      expect(metrics.oldestStuckAgeMs).toBeNull();
    });
  });

  // ── recovered transactions ──────────────────────────────────────

  describe('recovered transactions', () => {
    it('should not flag a transaction as stuck after it transitions to confirmed', async () => {
      // Initially stuck
      prisma.sorobanTransaction.findMany.mockResolvedValue([
        makeTx({
          id: 'tx-rec',
          status: SorobanTransactionStatus.submitted,
          createdAt: new Date(Date.now() - 600_000),
        }),
      ]);

      const stuckBefore = await service.detectStuckTransactions();
      expect(stuckBefore).toHaveLength(1);

      // Transaction confirmed — it won't show up in non-terminal query anymore
      prisma.sorobanTransaction.findMany.mockResolvedValue([]);

      const stuckAfter = await service.detectStuckTransactions();
      expect(stuckAfter).toHaveLength(0);
    });

    it('should not flag a transaction as stuck after it transitions to failed', async () => {
      prisma.sorobanTransaction.findMany.mockResolvedValue([
        makeTx({
          id: 'tx-fail',
          status: SorobanTransactionStatus.submitted,
          createdAt: new Date(Date.now() - 600_000),
        }),
      ]);

      const stuckBefore = await service.detectStuckTransactions();
      expect(stuckBefore).toHaveLength(1);

      // Terminal failure — no longer shows up
      prisma.sorobanTransaction.findMany.mockResolvedValue([]);

      const stuckAfter = await service.detectStuckTransactions();
      expect(stuckAfter).toHaveLength(0);
    });

    it('should still flag a transaction as stuck if it remains pending', async () => {
      prisma.sorobanTransaction.findMany.mockResolvedValue([
        makeTx({
          id: 'tx-still',
          status: SorobanTransactionStatus.pending,
          createdAt: new Date(Date.now() - 600_000),
        }),
      ]);

      const stuck1 = await service.detectStuckTransactions();
      expect(stuck1).toHaveLength(1);

      // Still pending, still stuck
      prisma.sorobanTransaction.findMany.mockResolvedValue([
        makeTx({
          id: 'tx-still',
          status: SorobanTransactionStatus.pending,
          createdAt: new Date(Date.now() - 600_000),
        }),
      ]);

      const stuck2 = await service.detectStuckTransactions();
      expect(stuck2).toHaveLength(1);
    });
  });

  // ── configuration ───────────────────────────────────────────────

  describe('configuration', () => {
    it('should update config via configureStuckDetection()', () => {
      service.configureStuckDetection({ maxAgeMs: 1000 });
      const config = service.getStuckDetectionConfig();
      expect(config.maxAgeMs).toBe(1000);
    });

    it('should return a copy from getStuckDetectionConfig()', () => {
      const config1 = service.getStuckDetectionConfig();
      (config1 as any).maxAgeMs = 999;
      const config2 = service.getStuckDetectionConfig();
      expect(config2.maxAgeMs).not.toBe(999);
    });
  });

  // ── multiple operation types in metrics ─────────────────────────

  describe('multiple operation types in metrics', () => {
    it('should produce correct per-operation-type and per-error-type breakdown', async () => {
      const txs = [
        makeTx({
          id: 'tx-1',
          operation: SorobanOperationType.create_claim,
          status: SorobanTransactionStatus.submitted,
          errorType: 'network_timeout',
          createdAt: new Date(Date.now() - 600_000),
        }),
        makeTx({
          id: 'tx-2',
          operation: SorobanOperationType.create_claim,
          status: SorobanTransactionStatus.submitted,
          errorType: 'rate_limit',
          createdAt: new Date(Date.now() - 700_000),
        }),
        makeTx({
          id: 'tx-3',
          operation: SorobanOperationType.disburse_claim,
          status: SorobanTransactionStatus.pending,
          errorType: 'congestion',
          createdAt: new Date(Date.now() - 800_000),
        }),
        makeTx({
          id: 'tx-4',
          operation: SorobanOperationType.init_escrow,
          status: SorobanTransactionStatus.submitted,
          createdAt: new Date(Date.now() - 900_000),
        }),
      ];

      prisma.sorobanTransaction.findMany.mockResolvedValue(txs);

      await service.detectStuckTransactions();
      const metrics = service.getStuckMetrics();

      expect(metrics.totalStuck).toBe(4);
      expect(metrics.byOperationType).toEqual({
        create_claim: 2,
        disburse_claim: 1,
        init_escrow: 1,
      });
      expect(metrics.byErrorType).toEqual({
        network_timeout: 1,
        rate_limit: 1,
        congestion: 1,
      });
      expect(metrics.oldestStuckAgeMs).toBeGreaterThanOrEqual(899_000);
    });
  });
});
