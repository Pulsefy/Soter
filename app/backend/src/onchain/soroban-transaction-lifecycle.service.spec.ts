import { Test, TestingModule } from '@nestjs/testing';
import { AsyncLocalStorage } from 'node:async_hooks';
import { SorobanTransactionLifecycleService } from './soroban-transaction-lifecycle.service';
import { ONCHAIN_ADAPTER_TOKEN } from './onchain.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { LoggerService } from '../logger/logger.service';
import { ConfigService } from '@nestjs/config';
import {
  SorobanTransactionStatus,
  SorobanOperationType,
  RetryableErrorType,
  ClaimStatus,
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
    claim: {
      updateMany: jest.fn(),
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
    getAidPackage: jest.fn(),
    getTransactionStatus: jest.fn(),
  };

  // A single in-memory storage keeps nested correlation bindings working the
  // same way the real logger service does.
  const specAsyncLocalStorage = new AsyncLocalStorage<Map<string, unknown>>();

  const mockLoggerService = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    getCorrelationId: jest.fn((): string | undefined => 'spec-correlation-id'),
    getAsyncLocalStorage: jest.fn(() => specAsyncLocalStorage),
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
        { provide: LoggerService, useValue: mockLoggerService },
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
      expect(mockLoggerService.error).toHaveBeenCalledWith(
        expect.stringContaining('operator intervention'),
        undefined,
        expect.any(String),
        expect.objectContaining({ transactionIds: ['tx-1'] }),
      );
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
      mockPrismaService.sorobanTransaction.updateMany.mockResolvedValue({
        count: 1,
      });
      mockOnchainAdapter.createClaim.mockResolvedValue({
        transactionHash: 'tx-hash-success',
      });

      await service.executeTransaction('tx-recover');

      expect(
        mockPrismaService.sorobanTransaction.update,
      ).toHaveBeenNthCalledWith(1, {
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

    it('recovers a submitted disbursement from onchain package state without resubmitting', async () => {
      const submittedTransaction = {
        id: 'tx-submitted',
        operation: SorobanOperationType.disburse_claim,
        status: SorobanTransactionStatus.submitted,
        attemptCount: 1,
        maxAttempts: 5,
        isRetryable: true,
        nextRetryAt: new Date(),
        claimId: 'claim-9',
        packageId: 'pkg-9',
        txHash: null,
      };

      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue(
        submittedTransaction,
      );
      mockPrismaService.claim.updateMany.mockResolvedValue({ count: 1 });
      // The package is Claimed onchain: the disbursement landed even though
      // the local row never reached `confirmed`.
      mockOnchainAdapter.getAidPackage.mockResolvedValue({
        package: { status: 'Claimed', id: 'pkg-9' },
      });

      await service.executeTransaction('tx-submitted');

      expect(mockOnchainAdapter.disburse).not.toHaveBeenCalled();
      expect(mockPrismaService.sorobanTransaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-submitted' },
        data: expect.objectContaining({
          status: SorobanTransactionStatus.confirmed,
        }),
      });
      // The claim is healed to disbursed alongside the recovered transaction.
      expect(mockPrismaService.claim.updateMany).toHaveBeenCalledWith({
        where: { id: 'claim-9', status: ClaimStatus.approved },
        data: { status: ClaimStatus.disbursed },
      });
    });

    it('resubmits a submitted disbursement only after the chain proves it never landed', async () => {
      const submittedTransaction = {
        id: 'tx-submitted-retry',
        operation: SorobanOperationType.disburse_claim,
        status: SorobanTransactionStatus.submitted,
        attemptCount: 1,
        maxAttempts: 5,
        isRetryable: true,
        nextRetryAt: new Date(),
        claimId: 'claim-10',
        packageId: 'pkg-10',
        txHash: null,
      };

      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue(
        submittedTransaction,
      );
      mockPrismaService.sorobanTransaction.updateMany.mockResolvedValue({
        count: 1,
      });
      // Package still Created: the previous submission never reached the chain.
      mockOnchainAdapter.getAidPackage.mockResolvedValue({
        package: { status: 'Created', id: 'pkg-10' },
      });
      mockOnchainAdapter.disburse.mockResolvedValue({
        transactionHash: 'tx-hash-fresh',
      });

      await service.executeTransaction('tx-submitted-retry');

      expect(mockOnchainAdapter.disburse).toHaveBeenCalledTimes(1);
    });

    it('does not resubmit an ambiguous transaction that is still pending onchain', async () => {
      const submittedTransaction = {
        id: 'tx-still-pending',
        operation: SorobanOperationType.disburse_claim,
        status: SorobanTransactionStatus.submitted,
        attemptCount: 0,
        maxAttempts: 5,
        isRetryable: true,
        nextRetryAt: new Date(),
        claimId: 'claim-11',
        packageId: 'pkg-11',
        txHash: 'hash-in-flight',
      };

      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue(
        submittedTransaction,
      );
      mockOnchainAdapter.getTransactionStatus.mockResolvedValue({
        hash: 'hash-in-flight',
        status: 'pending',
        timestamp: new Date(),
      });

      await service.executeTransaction('tx-still-pending');

      expect(mockOnchainAdapter.disburse).not.toHaveBeenCalled();
      expect(
        mockPrismaService.sorobanTransaction.updateMany,
      ).not.toHaveBeenCalled();
    });

    it('skips submission when a concurrent worker already claimed the pending row', async () => {
      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue({
        id: 'tx-race',
        operation: SorobanOperationType.create_claim,
        status: SorobanTransactionStatus.pending,
        attemptCount: 0,
        maxAttempts: 5,
        isRetryable: true,
        nextRetryAt: new Date(),
      });
      mockPrismaService.sorobanTransaction.updateMany.mockResolvedValue({
        count: 0,
      });

      await service.executeTransaction('tx-race');

      expect(mockOnchainAdapter.createClaim).not.toHaveBeenCalled();
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'soroban_submit_guard_total',
        { action: 'skipped_already_claimed', operation: 'create_claim' },
      );
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

  describe('createTransaction idempotency', () => {
    it('stores the idempotency key on the created row', async () => {
      mockPrismaService.sorobanTransaction.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({
          id: 'tx-1',
          ...data,
        }),
      );

      await service.createTransaction({
        operation: SorobanOperationType.disburse_claim,
        claimId: 'claim-1',
        idempotencyKey: 'disburse:claim-1',
      });

      expect(mockPrismaService.sorobanTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idempotencyKey: 'disburse:claim-1',
          }),
        }),
      );
    });

    it('returns the existing row instead of creating a duplicate when the key already exists', async () => {
      const existing = {
        id: 'tx-existing',
        status: SorobanTransactionStatus.submitted,
        idempotencyKey: 'disburse:claim-1',
      };
      mockPrismaService.sorobanTransaction.create.mockRejectedValue({
        code: 'P2002',
      });
      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue(
        existing,
      );

      const result = await service.createTransaction({
        operation: SorobanOperationType.disburse_claim,
        claimId: 'claim-1',
        idempotencyKey: 'disburse:claim-1',
      });

      expect(result).toBe(existing);
      expect(
        mockPrismaService.sorobanTransaction.findUnique,
      ).toHaveBeenCalledWith({ where: { idempotencyKey: 'disburse:claim-1' } });
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'soroban_transaction_deduplicated',
        expect.objectContaining({ operation: 'disburse_claim' }),
      );
    });

    it('rethrows unique-constraint errors when no idempotency key was supplied', async () => {
      const error = { code: 'P2002' };
      mockPrismaService.sorobanTransaction.create.mockRejectedValue(error);

      await expect(
        service.createTransaction({
          operation: SorobanOperationType.disburse_claim,
        }),
      ).rejects.toBe(error);
      expect(
        mockPrismaService.sorobanTransaction.findUnique,
      ).not.toHaveBeenCalled();
    });
  });

  describe('idempotent retry after a crash between submission and confirmation', () => {
    /**
     * Builds a disbursement transaction whose first attempt reaches the chain
     * (the simulated package flips to Claimed) but whose local `confirmed`
     * write fails with a crash-like timeout — the exact partial-failure
     * window from issue #1175. The row is left retryable, and the retry must
     * consult onchain state instead of blindly resubmitting.
     */
    const arrangeCrashedDisbursement = () => {
      const onchain = { packageStatus: 'Created', disburseCalls: 0 };

      mockOnchainAdapter.disburse.mockImplementation(() => {
        onchain.disburseCalls += 1;
        onchain.packageStatus = 'Claimed';
        return { transactionHash: 'hash-crash-1', status: 'success' };
      });
      mockOnchainAdapter.getAidPackage.mockImplementation(
        ({ packageId }: { packageId: string }) => ({
          package: { id: packageId, status: onchain.packageStatus },
        }),
      );

      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue({
        id: 'tx-crash',
        operation: SorobanOperationType.disburse_claim,
        status: SorobanTransactionStatus.pending,
        attemptCount: 0,
        maxAttempts: 5,
        isRetryable: true,
        nextRetryAt: new Date(),
        claimId: 'claim-crash',
        packageId: 'pkg-crash',
        txHash: null,
      });
      mockPrismaService.sorobanTransaction.updateMany.mockResolvedValue({
        count: 1,
      });
      mockPrismaService.claim.updateMany.mockResolvedValue({ count: 1 });

      // The first attempt: the transfer lands onchain, but the process dies
      // (simulated as a timeout on the local write) before `confirmed` is
      // persisted. handleTransactionError classifies the timeout as retryable
      // and leaves the row `pending` for the retry scheduler.
      mockPrismaService.sorobanTransaction.update.mockImplementationOnce(() => {
        throw new Error('timeout waiting for local db write');
      });

      return onchain;
    };

    it('a retry after the crash verifies onchain state and does not double-disburse', async () => {
      const onchain = arrangeCrashedDisbursement();

      // Attempt 1: submission succeeds onchain, local confirmation crashes.
      await service.executeTransaction('tx-crash');
      expect(onchain.disburseCalls).toBe(1);
      // The crash left the row retryable rather than confirmed.
      expect(
        mockPrismaService.sorobanTransaction.update,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SorobanTransactionStatus.pending,
            isRetryable: true,
          }),
        }),
      );

      // The error handler persisted attemptCount 1; the retry reads the row
      // back with that state.
      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue({
        id: 'tx-crash',
        operation: SorobanOperationType.disburse_claim,
        status: SorobanTransactionStatus.pending,
        attemptCount: 1,
        maxAttempts: 5,
        isRetryable: true,
        nextRetryAt: new Date(),
        claimId: 'claim-crash',
        packageId: 'pkg-crash',
        txHash: null,
      });

      // Attempt 2 (e.g. the retry cron after restart): the package is already
      // Claimed onchain, so the row is confirmed locally and the transfer is
      // never resubmitted.
      await service.executeTransaction('tx-crash');

      expect(onchain.disburseCalls).toBe(1);
      expect(mockPrismaService.sorobanTransaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-crash' },
        data: expect.objectContaining({
          status: SorobanTransactionStatus.confirmed,
        }),
      });
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'soroban_submit_guard_total',
        { action: 'recovered_confirmed', operation: 'disburse_claim' },
      );
    });

    it('a retry after the crash resubmits when verification proves nothing landed onchain', async () => {
      const onchain = arrangeCrashedDisbursement();

      // Attempt 1 crashes before reaching the chain: the submission itself
      // times out, so the package is untouched. The crash-window write
      // configured by arrangeCrashedDisbursement never comes into play.
      mockPrismaService.sorobanTransaction.update.mockReset();
      mockOnchainAdapter.disburse.mockRejectedValue(
        new Error('network timeout'),
      );

      await service.executeTransaction('tx-crash');
      expect(onchain.disburseCalls).toBe(0);

      // The timeout left the row pending with attemptCount 1.
      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue({
        id: 'tx-crash',
        operation: SorobanOperationType.disburse_claim,
        status: SorobanTransactionStatus.pending,
        attemptCount: 1,
        maxAttempts: 5,
        isRetryable: true,
        nextRetryAt: new Date(),
        claimId: 'claim-crash',
        packageId: 'pkg-crash',
        txHash: null,
      });
      mockPrismaService.sorobanTransaction.updateMany.mockResolvedValue({
        count: 1,
      });
      // Retry: verification proves the package is still Created, so the
      // disbursement is resubmitted exactly once and confirmed.
      mockOnchainAdapter.disburse.mockImplementation(() => {
        onchain.disburseCalls += 1;
        onchain.packageStatus = 'Claimed';
        return { transactionHash: 'hash-retry-1', status: 'success' };
      });

      await service.executeTransaction('tx-crash');

      expect(onchain.disburseCalls).toBe(1);
      expect(mockPrismaService.sorobanTransaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-crash' },
        data: expect.objectContaining({
          status: SorobanTransactionStatus.confirmed,
        }),
      });
    });
  });

  describe('reconcileInFlightTransactions (worker restart)', () => {
    const makeSubmittedDisbursement = (
      overrides: Record<string, unknown> = {},
    ) => ({
      id: 'tx-inflight',
      operation: SorobanOperationType.disburse_claim,
      status: SorobanTransactionStatus.submitted,
      attemptCount: 0,
      maxAttempts: 5,
      isRetryable: true,
      claimId: 'claim-inflight',
      packageId: 'pkg-inflight',
      txHash: null,
      correlationId: 'corr-inflight',
      lastError: null,
      // Old enough to be past the stuck threshold: a row still being worked
      // on by a live instance is deliberately not touched.
      updatedAt: new Date(Date.now() - 600000),
      createdAt: new Date(Date.now() - 700000),
      ...overrides,
    });

    it('confirms a submitted disbursement that landed onchain and heals the claim', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        makeSubmittedDisbursement(),
      ]);
      mockPrismaService.claim.updateMany.mockResolvedValue({ count: 1 });
      mockOnchainAdapter.getAidPackage.mockResolvedValue({
        package: { id: 'pkg-inflight', status: 'Claimed' },
      });

      const result = await service.reconcileInFlightTransactions();

      // Only rows in-flight past the stuck threshold are inspected, so a
      // live instance's fresh submission is never raced.
      expect(
        mockPrismaService.sorobanTransaction.findMany,
      ).toHaveBeenCalledWith({
        where: {
          status: SorobanTransactionStatus.submitted,
          updatedAt: { lt: expect.any(Date) },
        },
        orderBy: { updatedAt: 'asc' },
        take: 100,
      });
      expect(result.scanned).toBe(1);
      expect(result.byOutcome.confirmed).toBe(1);
      expect(mockOnchainAdapter.disburse).not.toHaveBeenCalled();
      expect(mockPrismaService.sorobanTransaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-inflight' },
        data: expect.objectContaining({
          status: SorobanTransactionStatus.confirmed,
        }),
      });
      expect(mockPrismaService.claim.updateMany).toHaveBeenCalledWith({
        where: { id: 'claim-inflight', status: ClaimStatus.approved },
        data: { status: ClaimStatus.disbursed },
      });
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'soroban_reconciliation_total',
        { operation: 'disburse_claim', outcome: 'confirmed' },
      );
      expect(mockLoggerService.log).toHaveBeenCalledWith(
        expect.stringContaining('Reconciled in-flight Soroban transaction'),
        expect.any(String),
        expect.objectContaining({ outcome: 'confirmed' }),
      );
    });

    it('resets a submitted disbursement that never landed so the retry scheduler can safely rerun it', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        makeSubmittedDisbursement(),
      ]);
      mockOnchainAdapter.getAidPackage.mockResolvedValue({
        package: { id: 'pkg-inflight', status: 'Created' },
      });

      const result = await service.reconcileInFlightTransactions();

      expect(result.byOutcome.reset_for_retry).toBe(1);
      expect(mockPrismaService.sorobanTransaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-inflight' },
        data: expect.objectContaining({
          status: SorobanTransactionStatus.pending,
          isRetryable: true,
          nextRetryAt: expect.any(Date),
        }),
      });
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'soroban_reconciliation_total',
        { operation: 'disburse_claim', outcome: 'reset_for_retry' },
      );
    });

    it('resets via recorded transaction hash when one was persisted before the crash', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        makeSubmittedDisbursement({ txHash: 'hash-persisted' }),
      ]);
      mockOnchainAdapter.getTransactionStatus.mockResolvedValue({
        hash: 'hash-persisted',
        status: 'succeeded',
        timestamp: new Date(),
      });

      const result = await service.reconcileInFlightTransactions();

      expect(result.byOutcome.confirmed).toBe(1);
      expect(mockOnchainAdapter.getTransactionStatus).toHaveBeenCalledWith({
        hash: 'hash-persisted',
      });
      expect(mockOnchainAdapter.getAidPackage).not.toHaveBeenCalled();
    });

    it('leaves transactions still pending onchain untouched', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        makeSubmittedDisbursement({ txHash: 'hash-pending' }),
      ]);
      mockOnchainAdapter.getTransactionStatus.mockResolvedValue({
        hash: 'hash-pending',
        status: 'pending',
        timestamp: new Date(),
      });

      const result = await service.reconcileInFlightTransactions();

      expect(result.byOutcome.still_pending).toBe(1);
      expect(
        mockPrismaService.sorobanTransaction.update,
      ).not.toHaveBeenCalled();
    });

    it('marks a disbursement terminal when retry budget is exhausted on reset', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        makeSubmittedDisbursement({ attemptCount: 5 }),
      ]);
      mockOnchainAdapter.getAidPackage.mockResolvedValue({
        package: { id: 'pkg-inflight', status: 'Created' },
      });

      const result = await service.reconcileInFlightTransactions();

      expect(result.byOutcome.failed_terminal).toBe(1);
      expect(mockPrismaService.sorobanTransaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-inflight' },
        data: expect.objectContaining({
          status: SorobanTransactionStatus.failed,
          isRetryable: false,
        }),
      });
    });

    it('counts unverifiable transactions without touching them', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        makeSubmittedDisbursement(),
      ]);
      mockOnchainAdapter.getAidPackage.mockRejectedValue(
        new Error('rpc unavailable'),
      );

      const result = await service.reconcileInFlightTransactions();

      expect(result.byOutcome.unverifiable).toBe(1);
      expect(
        mockPrismaService.sorobanTransaction.update,
      ).not.toHaveBeenCalled();
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'soroban_reconciliation_total',
        { operation: 'disburse_claim', outcome: 'unverifiable' },
      );
    });
  });
});
