import { Test } from '@nestjs/testing';
import { DisbursementReconciliationService } from './disbursement-reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanTransactionLifecycleService } from '../onchain/soroban-transaction-lifecycle.service';
import { MetricsService } from '../observability/metrics/metrics.service';

describe('DisbursementReconciliationService', () => {
  let service: DisbursementReconciliationService;
  let prisma: jest.Mocked<PrismaService>;
  let lifecycle: jest.Mocked<SorobanTransactionLifecycleService>;
  let metrics: jest.Mocked<MetricsService>;

  const attemptId = 'att-1';
  const claimId = 'claim-1';
  const idempotencyKey = `claim:${claimId}:disbursement`;
  const txHash = 'abcdef123456';

  const makeAttempt = (overrides: Partial<Record<string, unknown>>) => ({
    id: attemptId,
    claimId,
    idempotencyKey,
    status: 'submitted',
    transactionHash: txHash,
    attemptCount: 1,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      disbursementAttempt: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    lifecycle = {
      getTransactionStatus: jest.fn(),
      submitTransaction: jest.fn(),
    } as unknown as jest.Mocked<SorobanTransactionLifecycleService>;

    metrics = {
      incrementCounter: jest.fn(),
    } as unknown as jest.Mocked<MetricsService>;

    const module = await Test.createTestingModule({
      providers: [
        DisbursementReconciliationService,
        { provide: PrismaService, useValue: prisma },
        { provide: SorobanTransactionLifecycleService, useValue: lifecycle },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();

    service = module.get(DisbursementReconciliationService);
  });

  it('marks an attempt as confirmed when the onchain transaction succeeded', async () => {
    const attempt = makeAttempt({});
    prisma.disbursementAttempt.findMany.mockResolvedValue([attempt]);
    lifecycle.getTransactionStatus.mockResolvedValue('success');
    prisma.disbursementAttempt.update.mockResolvedValue({ ...attempt, status: 'confirmed' });

    const outcomes = await service.reconcileInFlight();

    expect(outcomes).length(1);
    expect(outcomes[0].outcome).toBe('confirmed');
    expect(prisma.disbursementAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: attemptId },
        data: expect.objectContaining({ status: 'confirmed' }),
      }),
    );
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'disbursement_reconciliation_outcomes_total',
      expect.objectContaining({ outcome: 'confirmed' }),
    );
  });

  it('marks an attempt as failed when the transaction was not found onchain', async () => {
    const attempt = makeAttempt({});
    prisma.disbursementAttempt.findMany.mockResolvedValue([attempt]);
    lifecycle.getTransactionStatus.mockResolvedValue('not_found');
    prisma.disbursementAttempt.update.mockResolvedValue({ ...attempt, status: 'failed' });

    const outcomes = await service.reconcileInFlight();

    expect(outcomes[0].outcome).toBe('not_found');
    expect(prisma.disbursementAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: attemptId },
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('skips reconciliation when no transaction hash was recorded', async () => {
    const attempt = makeAttempt({ transactionHash: null, status: 'pending' });
    prisma.disbursementAttempt.findMany.mockResolvedValue([attempt]);

    const outcomes = await service.reconcileInFlight();

    expect(outcomes[0].outcome).toBe('skipped');
    expect(lifecycle.getTransactionStatus).not.toHaveBeenCalled();
    expect(prisma.disbursementAttempt.update).not.toHaveBeenCalled();
  });

  it('leaves the attempt in place when the onchain status cannot be determined', async () => {
    const attempt = makeAttempt({});
    prisma.disbursementAttempt.findMany.mockResolvedValue([attempt]);
    lifecycle.getTransactionStatus.mockRejectedValue(new Error('network unavailable'));

    const outcomes = await service.reconcileInFlight();

    expect(outcomes[0].outcome).toBe('skipped');
    expect(prisma.disbursementAttempt.update).not.toHaveBeenCalled();
  });

  it('forces a crash between submission and confirmation and asserts no double-disbursement', async () => {
    // Simulate the crash: the transaction was submitted and the hash was
    // persisted, but the worker crashed before the local status update.
    // The attempt remains in 'submitted' state.
    const attempt = makeAttempt({ status: 'submitted' });
    prisma.disbursementAttempt.findMany.mockResolvedValue([attempt]);
    // The chain confirms the transaction did land.
    lifecycle.getTransactionStatus.mockResolvedValue('success');
    prisma.disbursementAttempt.update.mockResolvedValue({ ...attempt, status: 'confirmed' });

    // Worker restarts and reconciles.
    const outcomes = await service.reconcileInFlight();

    // The attempt is confirmed, not resubmitted.
    expect(outcomes[0].outcome).toBe('confirmed');
    expect(lifecycle.submitTransaction).not.toHaveBeenCalled();
    expect(prisma.disbursementAttempt.update).toHaveBeenCalledTimes(1);
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'disbursement_reconciliation_outcomes_total',
      expect.objectContaining({ outcome: 'confirmed' }),
    );
  });

  it('reconciles a single attempt by id', async () => {
    const attempt = makeAttempt({});
    prisma.disbursementAttempt.findUnique.mockResolvedValue(attempt);
    lifecycle.getTransactionStatus.mockResolvedValue('success');
    prisma.disbursementAttempt.update.mockResolvedValue({ ...attempt, status: 'confirmed' });

    const outcome = await service.reconcileAttemptId(attemptId);

    expect(outcome?.outcome).toBe('confirmed');
  });
});
