import { Test, TestingModule } from '@nestjs/testing';
import { SorobanTransactionLifecycleService } from './soroban-transaction-lifecycle.service';
import { ONCHAIN_ADAPTER_TOKEN } from './onchain.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { ConfigService } from '@nestjs/config';
import {
  SorobanOperationType,
  SorobanTransactionStatus,
} from '@prisma/client';

/**
 * Idempotency and crash-recovery coverage for disbursement tracking
 * (Pulsefy/Soter#1175).
 *
 * The failure being guarded against: the backend submits a disbursement, the
 * process dies before the local row is updated, and the retry path submits it
 * a second time. These tests drive the two halves of the fix — a stable
 * idempotency key per claim, and reconciliation against on-chain state before
 * any resubmission — with the on-chain adapter stubbed, so no testnet
 * transaction is ever needed.
 */
describe('SorobanTransactionLifecycleService - disbursement idempotency', () => {
  let service: SorobanTransactionLifecycleService;

  const mockPrismaService = {
    sorobanTransaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      fields: { maxAttempts: 5 },
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
    getTransactionStatus: jest.fn(),
    getAidPackage: jest.fn(),
  };

  /** A disbursement row left behind by a crashed submission. */
  const inFlightDisbursement = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id: 'tx-crash-1',
    claimId: 'claim-1',
    operation: SorobanOperationType.disburse_claim,
    status: SorobanTransactionStatus.submitted,
    packageId: '42',
    txHash: null,
    attemptCount: 1,
    maxAttempts: 5,
    isRetryable: true,
    lastError: null,
    errorType: null,
    metadata: null,
    ...overrides,
  });

  const aidPackage = (status: string): { package: Record<string, unknown> } => ({
    package: {
      id: '42',
      recipient: 'GRECIPIENT',
      amount: '100',
      token: 'GTOKEN',
      status,
      createdAt: 1,
      expiresAt: 2,
    },
  });

  /** data payloads passed to sorobanTransaction.update during this test. */
  const updatePayloads = (): Array<Record<string, unknown>> =>
    mockPrismaService.sorobanTransaction.update.mock.calls.map(
      (call) => (call[0] as { data: Record<string, unknown> }).data,
    );

  const updateWithStatus = (status: string) =>
    updatePayloads().find((data) => data.status === status);

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn(() => undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanTransactionLifecycleService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: ONCHAIN_ADAPTER_TOKEN, useValue: mockOnchainAdapter },
      ],
    }).compile();

    service = module.get<SorobanTransactionLifecycleService>(
      SorobanTransactionLifecycleService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('disbursementIdempotencyKey', () => {
    it('is derived from the claim id alone, so a retry cannot mint a new key', () => {
      const first = SorobanTransactionLifecycleService.disbursementIdempotencyKey(
        'claim-1',
      );
      const second =
        SorobanTransactionLifecycleService.disbursementIdempotencyKey(
          'claim-1',
        );

      expect(first).toBe(second);
      expect(first).toContain('claim-1');
      // A timestamp or random suffix would make each attempt look like a new
      // disbursement, which is the bug this replaces.
      expect(first).not.toMatch(/\d{13}/);
    });

    it('separates different claims', () => {
      expect(
        SorobanTransactionLifecycleService.disbursementIdempotencyKey('a'),
      ).not.toBe(
        SorobanTransactionLifecycleService.disbursementIdempotencyKey('b'),
      );
    });
  });

  describe('createOrReuseTransaction', () => {
    it('creates a row when the idempotency key has not been seen', async () => {
      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue(null);
      mockPrismaService.sorobanTransaction.create.mockResolvedValue({
        id: 'tx-1',
      });

      const result = await service.createOrReuseTransaction({
        claimId: 'claim-1',
        operation: SorobanOperationType.disburse_claim,
        idempotencyKey:
          SorobanTransactionLifecycleService.disbursementIdempotencyKey(
            'claim-1',
          ),
      });

      expect(result.created).toBe(true);
      expect(result.transaction).toEqual({ id: 'tx-1' });
      expect(mockPrismaService.sorobanTransaction.create).toHaveBeenCalledTimes(
        1,
      );
    });

    it('reuses the existing row instead of inserting a second attempt', async () => {
      const existing = inFlightDisbursement();
      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue(
        existing,
      );

      const result = await service.createOrReuseTransaction({
        claimId: 'claim-1',
        operation: SorobanOperationType.disburse_claim,
        idempotencyKey:
          SorobanTransactionLifecycleService.disbursementIdempotencyKey(
            'claim-1',
          ),
      });

      expect(result.created).toBe(false);
      expect(result.transaction).toBe(existing);
      expect(
        mockPrismaService.sorobanTransaction.create,
      ).not.toHaveBeenCalled();
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'soroban_transaction_reused',
        expect.objectContaining({
          operation: SorobanOperationType.disburse_claim,
        }),
      );
    });

    it('adopts the winner when a concurrent call hits the unique index', async () => {
      const winner = inFlightDisbursement({ id: 'tx-winner' });
      mockPrismaService.sorobanTransaction.findUnique
        .mockResolvedValueOnce(null) // no row yet
        .mockResolvedValueOnce(winner); // the racing insert won
      mockPrismaService.sorobanTransaction.create.mockRejectedValue({
        code: 'P2002',
      });

      const result = await service.createOrReuseTransaction({
        claimId: 'claim-1',
        operation: SorobanOperationType.disburse_claim,
        idempotencyKey:
          SorobanTransactionLifecycleService.disbursementIdempotencyKey(
            'claim-1',
          ),
      });

      expect(result.created).toBe(false);
      expect(result.transaction).toBe(winner);
      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'soroban_transaction_idempotency_race',
        expect.any(Object),
      );
    });
  });

  describe('reconcileTransaction', () => {
    it('confirms a transaction whose hash succeeded on-chain', async () => {
      mockOnchainAdapter.getTransactionStatus.mockResolvedValue({
        hash: 'abc',
        status: 'succeeded',
        timestamp: new Date(),
      });

      const result = await service.reconcileTransaction(
        inFlightDisbursement({ txHash: 'abc' }) as never,
      );

      expect(result.outcome).toBe('confirmed');
      expect(updateWithStatus(SorobanTransactionStatus.confirmed)).toBeDefined();
    });

    it('makes a transaction retryable when its hash failed on-chain', async () => {
      mockOnchainAdapter.getTransactionStatus.mockResolvedValue({
        hash: 'abc',
        status: 'failed',
        timestamp: new Date(),
        errorMessage: 'tx_failed',
      });

      const result = await service.reconcileTransaction(
        inFlightDisbursement({ txHash: 'abc' }) as never,
      );

      expect(result.outcome).toBe('retryable');
      expect(updateWithStatus(SorobanTransactionStatus.pending)).toBeDefined();
    });

    it('leaves a still-pending hash untouched rather than guessing', async () => {
      mockOnchainAdapter.getTransactionStatus.mockResolvedValue({
        hash: 'abc',
        status: 'pending',
        timestamp: new Date(),
      });

      const result = await service.reconcileTransaction(
        inFlightDisbursement({ txHash: 'abc' }) as never,
      );

      expect(result.outcome).toBe('in_flight');
      expect(mockPrismaService.sorobanTransaction.update).not.toHaveBeenCalled();
    });

    it('confirms when the package is Claimed on-chain but no hash was recorded', async () => {
      mockOnchainAdapter.getAidPackage.mockResolvedValue(aidPackage('Claimed'));

      const result = await service.reconcileTransaction(
        inFlightDisbursement() as never,
      );

      expect(result.outcome).toBe('confirmed');
      expect(updateWithStatus(SorobanTransactionStatus.confirmed)).toBeDefined();
    });

    it('makes it retryable when the package is still Created on-chain', async () => {
      mockOnchainAdapter.getAidPackage.mockResolvedValue(aidPackage('Created'));

      const result = await service.reconcileTransaction(
        inFlightDisbursement() as never,
      );

      expect(result.outcome).toBe('retryable');
    });

    it('treats a package that can no longer be disbursed as terminal', async () => {
      mockOnchainAdapter.getAidPackage.mockResolvedValue(aidPackage('Expired'));

      const result = await service.reconcileTransaction(
        inFlightDisbursement() as never,
      );

      expect(result.outcome).toBe('terminal');
      expect(updateWithStatus(SorobanTransactionStatus.failed)).toBeDefined();
    });

    it('reports unavailable when the row has no on-chain identifier', async () => {
      const result = await service.reconcileTransaction(
        inFlightDisbursement({ packageId: null, txHash: null }) as never,
      );

      expect(result.outcome).toBe('unavailable');
      expect(mockPrismaService.sorobanTransaction.update).not.toHaveBeenCalled();
    });

    it('reports error without mutating the row when the lookup throws', async () => {
      mockOnchainAdapter.getTransactionStatus.mockRejectedValue(
        new Error('horizon unreachable'),
      );

      const result = await service.reconcileTransaction(
        inFlightDisbursement({ txHash: 'abc' }) as never,
      );

      expect(result.outcome).toBe('error');
      expect(mockPrismaService.sorobanTransaction.update).not.toHaveBeenCalled();
    });
  });

  describe('crash between submission and confirmation', () => {
    it('does not submit the disbursement again when the package already went Claimed', async () => {
      // The crash: submission reached the contract, the process died before the
      // local confirmation write, so the row is still `submitted` with no hash.
      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue(
        inFlightDisbursement({ txHash: null, packageId: '42' }),
      );
      mockOnchainAdapter.getAidPackage.mockResolvedValue(aidPackage('Claimed'));
      mockPrismaService.sorobanTransaction.update.mockResolvedValue({});

      await service.executeTransaction('tx-crash-1');

      expect(mockOnchainAdapter.disburse).not.toHaveBeenCalled();
      expect(updateWithStatus(SorobanTransactionStatus.confirmed)).toBeDefined();
      expect(
        mockMetricsService.incrementCounter,
      ).toHaveBeenCalledWith(
        'soroban_transaction_reconciliation_recovered',
        expect.any(Object),
      );
    });

    it('does not resubmit while the on-chain outcome is still unknown', async () => {
      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue(
        inFlightDisbursement({ txHash: 'abc' }),
      );
      mockOnchainAdapter.getTransactionStatus.mockResolvedValue({
        hash: 'abc',
        status: 'unknown',
        timestamp: new Date(),
      });

      await service.executeTransaction('tx-crash-1');

      expect(mockOnchainAdapter.disburse).not.toHaveBeenCalled();
      expect(mockPrismaService.sorobanTransaction.update).not.toHaveBeenCalled();
    });

    it('still retries once reconciliation proves nothing landed', async () => {
      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue(
        inFlightDisbursement({ txHash: null, packageId: '42' }),
      );
      mockOnchainAdapter.getAidPackage.mockResolvedValue(aidPackage('Created'));
      mockPrismaService.sorobanTransaction.update.mockResolvedValue({});
      mockOnchainAdapter.disburse.mockResolvedValue({
        transactionHash: 'new-hash',
        timestamp: new Date(),
        status: 'success',
        amountDisbursed: '100',
      });

      await service.executeTransaction('tx-crash-1');

      expect(mockOnchainAdapter.disburse).toHaveBeenCalledTimes(1);
      expect(updateWithStatus(SorobanTransactionStatus.confirmed)).toBeDefined();
    });

    it('settles a force-retried confirmed row instead of submitting it again', async () => {
      // forceRetry resets status to pending but leaves the recorded hash, so
      // the hash guard is the only thing standing between it and a re-submit.
      mockPrismaService.sorobanTransaction.findUnique.mockResolvedValue(
        inFlightDisbursement({
          status: SorobanTransactionStatus.pending,
          txHash: 'abc',
        }),
      );
      mockOnchainAdapter.getTransactionStatus.mockResolvedValue({
        hash: 'abc',
        status: 'succeeded',
        timestamp: new Date(),
      });
      mockPrismaService.sorobanTransaction.update.mockResolvedValue({});

      await service.executeTransaction('tx-crash-1');

      expect(mockOnchainAdapter.disburse).not.toHaveBeenCalled();
      expect(updateWithStatus(SorobanTransactionStatus.confirmed)).toBeDefined();
    });
  });

  describe('reconcileInFlightTransactions', () => {
    it('counts every outcome and publishes the unresolved backlog', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        inFlightDisbursement({ id: 'tx-1', packageId: '42', txHash: null }),
        inFlightDisbursement({ id: 'tx-2', txHash: 'hash-2' }),
        inFlightDisbursement({ id: 'tx-3', packageId: null, txHash: null }),
      ]);
      mockOnchainAdapter.getAidPackage.mockResolvedValue(aidPackage('Claimed'));
      mockOnchainAdapter.getTransactionStatus.mockResolvedValue({
        hash: 'hash-2',
        status: 'pending',
        timestamp: new Date(),
      });
      mockPrismaService.sorobanTransaction.update.mockResolvedValue({});

      const summary = await service.reconcileInFlightTransactions();

      expect(summary.scanned).toBe(3);
      expect(summary.confirmed).toBe(1);
      expect(summary.inFlight).toBe(1);
      expect(summary.unavailable).toBe(1);

      expect(mockMetricsService.incrementCounter).toHaveBeenCalledWith(
        'soroban_transaction_reconciliation_total',
        expect.objectContaining({ outcome: 'confirmed' }),
      );
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_in_flight',
        2,
      );
    });

    it('does nothing when no transaction is in flight', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([]);

      const summary = await service.reconcileInFlightTransactions();

      expect(summary.scanned).toBe(0);
      expect(mockOnchainAdapter.getAidPackage).not.toHaveBeenCalled();
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_in_flight',
        0,
      );
    });
  });
});
