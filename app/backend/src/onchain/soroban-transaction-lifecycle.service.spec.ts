import { Test, TestingModule } from '@nestjs/testing';
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

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: string) => {
      if (key === 'STUCK_TRANSACTION_THRESHOLD_MS') {
        return '300000';
      }
      return defaultValue;
    }),
  };

  const mockOnchainAdapter = {
    createClaim: jest.fn(),
    disburse: jest.fn(),
    initEscrow: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
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

    service = module.get<SorobanTransactionLifecycleService>(
      SorobanTransactionLifecycleService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('detectStuckTransactions', () => {
    it('should detect transactions stuck in pending state past threshold', async () => {
      const stuckTransaction = {
        id: 'tx-1',
        operation: SorobanOperationType.create_claim,
        status: SorobanTransactionStatus.pending,
        errorType: null,
        lastError: null,
        isRetryable: true,
        updatedAt: new Date(Date.now() - 310000),
        createdAt: new Date(Date.now() - 310000),
        claimId: 'claim-1',
        correlationId: 'corr-1',
      };

      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        stuckTransaction,
      ]);

      const result = await service.detectStuckTransactions();

      expect(result.stuckCount).toBe(1);
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].id).toBe('tx-1');
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_stuck_total',
        1,
      );
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_stuck_by_operation',
        1,
        { operation: 'create_claim' },
      );
    });

    it('should detect transactions stuck in submitted state past threshold', async () => {
      const stuckTransaction = {
        id: 'tx-2',
        operation: SorobanOperationType.disburse_claim,
        status: SorobanTransactionStatus.submitted,
        errorType: RetryableErrorType.network_timeout,
        lastError: 'timeout waiting for response',
        isRetryable: true,
        updatedAt: new Date(Date.now() - 400000),
        createdAt: new Date(Date.now() - 400000),
        claimId: 'claim-2',
        correlationId: 'corr-2',
      };

      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        stuckTransaction,
      ]);

      const result = await service.detectStuckTransactions();

      expect(result.stuckCount).toBe(1);
      expect(result.transactions[0].status).toBe('submitted');
      expect(result.transactions[0].errorType).toBe('network_timeout');
    });

    it('should not flag transactions in terminal states', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([]);

      const result = await service.detectStuckTransactions();

      expect(result.stuckCount).toBe(0);
      expect(result.transactions).toHaveLength(0);
    });

    it('should not flag recently updated non-terminal transactions', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([]);

      const result = await service.detectStuckTransactions();

      expect(result.stuckCount).toBe(0);
    });

    it('should return empty result when no transactions are stuck', async () => {
      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([]);

      const result = await service.detectStuckTransactions();

      expect(result.stuckCount).toBe(0);
      expect(result.transactions).toHaveLength(0);
      expect(mockMetricsService.setGauge).not.toHaveBeenCalled();
    });

    it('should aggregate stuck counts by operation type', async () => {
      const stuckTransactions = [
        {
          id: 'tx-1',
          operation: SorobanOperationType.create_claim,
          status: SorobanTransactionStatus.pending,
          errorType: null,
          lastError: null,
          isRetryable: true,
          updatedAt: new Date(Date.now() - 310000),
          createdAt: new Date(Date.now() - 310000),
          claimId: 'claim-1',
          correlationId: 'corr-1',
        },
        {
          id: 'tx-2',
          operation: SorobanOperationType.create_claim,
          status: SorobanTransactionStatus.submitted,
          errorType: RetryableErrorType.congestion,
          lastError: 'network congestion',
          isRetryable: true,
          updatedAt: new Date(Date.now() - 320000),
          createdAt: new Date(Date.now() - 320000),
          claimId: 'claim-2',
          correlationId: 'corr-2',
        },
        {
          id: 'tx-3',
          operation: SorobanOperationType.disburse_claim,
          status: SorobanTransactionStatus.pending,
          errorType: null,
          lastError: null,
          isRetryable: true,
          updatedAt: new Date(Date.now() - 330000),
          createdAt: new Date(Date.now() - 330000),
          claimId: 'claim-3',
          correlationId: 'corr-3',
        },
      ];

      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue(
        stuckTransactions,
      );

      const result = await service.detectStuckTransactions();

      expect(result.stuckCount).toBe(3);
      expect(mockMetricsService.setGauge).toHaveBeenCalledWith(
        'soroban_transaction_stuck_total',
        3,
      );
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
    });

    it('should include retryable error classification in result', async () => {
      const stuckTransaction = {
        id: 'tx-1',
        operation: SorobanOperationType.init_escrow,
        status: SorobanTransactionStatus.submitted,
        errorType: RetryableErrorType.insufficient_fee,
        lastError: 'fee too low',
        isRetryable: true,
        updatedAt: new Date(Date.now() - 310000),
        createdAt: new Date(Date.now() - 310000),
        claimId: null,
        correlationId: 'corr-1',
      };

      mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
        stuckTransaction,
      ]);

      const result = await service.detectStuckTransactions();

      expect(result.stuckCount).toBe(1);
      expect(result.transactions[0].errorType).toBe('insufficient_fee');
      expect(result.transactions[0].lastError).toBe('fee too low');
      expect(result.transactions[0].isRetryable).toBe(true);
      expect(result.transactions[0].claimId).toBeNull();
    });
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

      expect(mockPrismaService.sorobanTransaction.update).toHaveBeenNthCalledWith(
        2,
        {
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
        },
      );
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

      expect(mockPrismaService.sorobanTransaction.update).toHaveBeenNthCalledWith(
        2,
        {
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
        },
      );
    });
  });
});
