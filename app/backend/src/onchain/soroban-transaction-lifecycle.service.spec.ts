import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { SorobanTransactionLifecycleService } from './soroban-transaction-lifecycle.service';
import { ONCHAIN_ADAPTER_TOKEN } from './onchain.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { ConfigService } from '@nestjs/config';
import {
  SorobanTransactionStatus,
  SorobanOperationType,
  RetryableErrorType,
} from '@prisma/client';

describe('SorobanTransactionLifecycleService - Stuck Detection', () => {
  let service: SorobanTransactionLifecycleService;
  let testingModules: TestingModule[] = [];

  const mockPrismaService = {
    sorobanTransaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      fields: {
        maxAttempts: 5,
      },
    },
  };

  const mockMetricsService = {
    incrementCounter: jest.fn(),
    recordSorobanTransactionLatency: jest.fn(),
    setGauge: jest.fn(),
    recordHistogram: jest.fn(),
  };

  const mockOnchainAdapter = {
    createClaim: jest.fn(),
    disburse: jest.fn(),
    initEscrow: jest.fn(),
  };

  /**
   * Builds the service with a specific STUCK_TRANSACTION_THRESHOLD_MS value so
   * config parsing and fallback can be exercised.
   */
  const buildService = async (
    threshold?: string,
  ): Promise<SorobanTransactionLifecycleService> => {
    const mockConfigService = {
      get: jest.fn((key: string) =>
        key === 'STUCK_TRANSACTION_THRESHOLD_MS' ? threshold : undefined,
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        SorobanTransactionLifecycleService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: ONCHAIN_ADAPTER_TOKEN,
          useValue: mockOnchainAdapter,
        },
      ],
    }).compile();
    testingModules.push(module);

    return module.get<SorobanTransactionLifecycleService>(
      SorobanTransactionLifecycleService,
    );
  };

  const makeStuckTransaction = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id: 'tx-1',
    operation: SorobanOperationType.create_claim,
    status: SorobanTransactionStatus.pending,
    errorType: null,
    lastError: null,
    isRetryable: true,
    attemptCount: 1,
    maxAttempts: 5,
    updatedAt: new Date(Date.now() - 310000),
    createdAt: new Date(Date.now() - 400000),
    claimId: 'claim-1',
    correlationId: 'corr-1',
    ...overrides,
  });

  beforeEach(async () => {
    service = await buildService('300000');
  });

  afterEach(async () => {
    await Promise.all(testingModules.map(m => m.close()));
    testingModules = [];
    jest.clearAllMocks();
  });

  describe('detectStuckTransactions', () => {
    it('scans only non-terminal transactions older than the configured threshold', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([]);

      await service.detectStuckTransactions();

      expect(
        mockPrismaService.sorobanTransaction.findMany,
      ).toHaveBeenCalledWith({
        where: {
          status: {
            in: [
              SorobanTransactionStatus.pending,
              SorobanTransactionStatus.submitted,
            ],
          },
          updatedAt: {
            lt: expect.any(Date),
          },
        },
        orderBy: {
          updatedAt: 'asc',
        },
      });

      // The cutoff must actually be `threshold` in the past, not "now".
      const cutoff: Date =
        mockPrismaService.sorobanTransaction.findMany.mock.calls[0][0].where
          .updatedAt.lt;
      const cutoffAgeMs = Date.now() - cutoff.getTime();
      expect(cutoffAgeMs).toBeGreaterThanOrEqual(299000);
      expect(cutoffAgeMs).toBeLessThanOrEqual(302000);
    });

    it('flags a pending transaction past the threshold and reports its age', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        makeStuckTransaction(),
      ]);

      const result = await service.detectStuckTransactions();

      expect(result.stuckCount).toBe(1);
      expect(result.thresholdMs).toBe(300000);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]).toMatchObject({
        id: 'tx-1',
        status: SorobanTransactionStatus.pending,
        classification: 'retryable',
      });
      expect(result.transactions[0].stuckAgeMs).toBeGreaterThanOrEqual(300000);
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_stuck_total',
        1,
      );
    });

    it('flags a submitted transaction carrying a retryable error', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        makeStuckTransaction({
          id: 'tx-2',
          operation: SorobanOperationType.disburse_claim,
          status: SorobanTransactionStatus.submitted,
          errorType: RetryableErrorType.network_timeout,
          lastError: 'timeout waiting for response',
          claimId: 'claim-2',
          correlationId: 'corr-2',
        }),
      ]);

      const result = await service.detectStuckTransactions();

      expect(result.stuckCount).toBe(1);
      expect(result.transactions[0].status).toBe(
        SorobanTransactionStatus.submitted,
      );
      expect(result.transactions[0].errorType).toBe(
        RetryableErrorType.network_timeout,
      );
      expect(result.transactions[0].classification).toBe('retryable');
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_stuck_by_class',
        1,
        { classification: 'retryable' },
      );
    });

    it('classifies a non-retryable transaction as terminal and escalates it', async () => {
      const serviceLogger = (service as unknown as { logger: Logger }).logger;
      const loggerErrorSpy = jest
        .spyOn(serviceLogger, 'error')
        .mockImplementation(() => undefined);

      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        makeStuckTransaction({
          isRetryable: false,
          lastError: 'NotAuthorized',
          errorType: null,
        }),
      ]);

      const result = await service.detectStuckTransactions();

      expect(result.stuckCount).toBe(1);
      expect(result.terminalCount).toBe(1);
      expect(result.retryableCount).toBe(0);
      expect(result.transactions[0].classification).toBe('terminal');
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_stuck_by_class',
        1,
        { classification: 'terminal' },
      );
      // Terminal transactions get an explicit operator escalation.
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('operator intervention'),
        expect.objectContaining({ transactionIds: ['tx-1'] }),
      );

      loggerErrorSpy.mockRestore();
    });

    it('classifies a transaction whose retries are exhausted as terminal', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        makeStuckTransaction({ isRetryable: true, attemptCount: 5 }),
      ]);

      const result = await service.detectStuckTransactions();

      expect(result.transactions[0].classification).toBe('terminal');
      expect(result.terminalCount).toBe(1);
    });

    it('aggregates stuck counts per operation type, including zero-valued ones', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        makeStuckTransaction({ id: 'tx-1' }),
        makeStuckTransaction({
          id: 'tx-2',
          operation: SorobanOperationType.create_claim,
          status: SorobanTransactionStatus.submitted,
        }),
        makeStuckTransaction({
          id: 'tx-3',
          operation: SorobanOperationType.disburse_claim,
        }),
      ]);

      const result = await service.detectStuckTransactions();

      expect(result.stuckCount).toBe(3);
      expect(result.byOperation).toEqual({
        create_claim: 2,
        disburse_claim: 1,
        init_escrow: 0,
      });
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_stuck_by_operation',
        2,
        { operation: 'create_claim' },
      );
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_stuck_by_operation',
        1,
        { operation: 'disburse_claim' },
      );
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_stuck_by_operation',
        0,
        { operation: 'init_escrow' },
      );
    });

    it('publishes zero-valued gauges when nothing is stuck so stale alerts clear', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([]);

      const result = await service.detectStuckTransactions();

      expect(result.stuckCount).toBe(0);
      expect(result.transactions).toHaveLength(0);
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_stuck_total',
        0,
      );
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_stuck_by_operation',
        0,
        { operation: 'create_claim' },
      );
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_stuck_by_class',
        0,
        { classification: 'retryable' },
      );
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_stuck_by_class',
        0,
        { classification: 'terminal' },
      );
    });
  });

  describe('configurable threshold', () => {
    it('honours a custom STUCK_TRANSACTION_THRESHOLD_MS', async () => {
      const customService = await buildService('60000');
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([]);

      const result = await customService.detectStuckTransactions();

      expect(result.thresholdMs).toBe(60000);
      const cutoff: Date =
        mockPrismaService.sorobanTransaction.findMany.mock.calls[0][0].where
          .updatedAt.lt;
      expect(Date.now() - cutoff.getTime()).toBeLessThanOrEqual(61000);
    });

    it.each([undefined, '', 'not-a-number', '0', '-1000'])(
      'falls back to the 5 minute default for invalid threshold %p',
      async threshold => {
        const fallbackService = await buildService(threshold);
        mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([]);

        const result = await fallbackService.detectStuckTransactions();

        expect(result.thresholdMs).toBe(300000);
      },
    );
  });

  describe('terminal transitions', () => {
    it('should mark stuck transactions as expired after 24 hours', async () => {
      const expiredAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const oldTransaction = {
        id: 'tx-old',
        operation: SorobanOperationType.create_claim,
        status: SorobanTransactionStatus.pending,
        updatedAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
        createdAt: expiredAt,
      };

      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        oldTransaction,
      ]);
      mockPrismaService.sorobanTransaction.updateMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.markExpiredTransactions();

      expect(result).toBe(1);
      expect(
        mockPrismaService.sorobanTransaction.updateMany,
      ).toHaveBeenCalledWith({
        where: {
          status: {
            in: [
              SorobanTransactionStatus.pending,
              SorobanTransactionStatus.submitted,
            ],
          },
          createdAt: {
            lt: expect.any(Date),
          },
        },
        data: {
          status: SorobanTransactionStatus.expired,
          expiredAt: expect.any(Date),
          isRetryable: false,
        },
      });
    });

    it('should not mark recently created transactions as expired', async () => {
      const recentTransaction = {
        id: 'tx-recent',
        operation: SorobanOperationType.create_claim,
        status: SorobanTransactionStatus.pending,
        updatedAt: new Date(Date.now() - 1000),
        createdAt: new Date(Date.now() - 1000),
      };

      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        recentTransaction,
      ]);
      mockPrismaService.sorobanTransaction.updateMany.mockResolvedValue({
        count: 0,
      });

      const result = await service.markExpiredTransactions();

      expect(result).toBe(0);
    });
  });

  describe('recovery scenarios', () => {
    it('should clear stuck status when transaction completes successfully', async () => {
      const transaction = {
        id: 'tx-recover',
        operation: SorobanOperationType.create_claim,
        status: SorobanTransactionStatus.pending,
        attemptCount: 1,
        maxAttempts: 5,
        isRetryable: true,
        nextRetryAt: new Date(),
      };

      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue(
        transaction,
      );
      mockOnchainAdapter.createClaim.mockResolvedValue({
        transactionHash: 'tx-hash-success',
      });

      await service.executeTransaction('tx-recover');

      expect(
        mockPrismaService.sorobanTransaction.update,
      ).toHaveBeenNthCalledWith(2, {
        where: { id: 'tx-recover' },
        data: {
          status: SorobanTransactionStatus.confirmed,
          txHash: 'tx-hash-success',
          confirmedAt: expect.any(Date),
          attemptCount: 2,
          lastRetryAt: expect.any(Date),
          lastError: null,
          errorType: null,
        },
      });
    });

    it('should transition from submitted to confirmed without stuck detection', async () => {
      const submittedTransaction = {
        id: 'tx-submitted',
        operation: SorobanOperationType.disburse_claim,
        status: SorobanTransactionStatus.submitted,
        attemptCount: 1,
        maxAttempts: 5,
        isRetryable: true,
        nextRetryAt: new Date(),
      };

      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue(
        submittedTransaction,
      );
      mockOnchainAdapter.disburse.mockResolvedValue({
        transactionHash: 'tx-hash-disburse',
      });

      await service.executeTransaction('tx-submitted');

      expect(
        mockPrismaService.sorobanTransaction.update,
      ).toHaveBeenNthCalledWith(2, {
        where: { id: 'tx-submitted' },
        data: {
          status: SorobanTransactionStatus.confirmed,
          txHash: 'tx-hash-disburse',
          confirmedAt: expect.any(Date),
          attemptCount: 2,
          lastRetryAt: expect.any(Date),
          lastError: null,
          errorType: null,
        },
      });
    });

    it('drops recovered transactions from detection and resets the stuck gauge', async () => {
      // Scan 1: one stuck transaction is detected.
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValueOnce([
        makeStuckTransaction(),
      ]);
      const first = await service.detectStuckTransactions();
      expect(first.stuckCount).toBe(1);

      // Scan 2: it recovered, so the DB predicate no longer matches it.
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValueOnce([]);
      const second = await service.detectStuckTransactions();

      expect(second.stuckCount).toBe(0);
      expect(mockMetricsService.setGauge).toHaveBeenLastCalledWith(
        'soroban_transaction_stuck_by_class',
        0,
        { classification: 'terminal' },
      );
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_stuck_total',
        0,
      );
    });
  });
});
