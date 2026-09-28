import { Test, TestingModule } from '@nestjs/testing';
import { SorobanCorrelationTraceService } from './soroban-correlation-trace.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoggerService } from '../logger/logger.service';
import {
  SorobanEventTopic,
  SorobanOperationType,
  SorobanTransactionStatus,
} from '@prisma/client';

describe('SorobanCorrelationTraceService', () => {
  let service: SorobanCorrelationTraceService;
  let module: TestingModule;

  const correlationId = 'corr-e2e-1';

  const mockPrismaService = {
    sorobanTransaction: {
      findMany: jest.fn(),
    },
    sorobanEventCorrelation: {
      findMany: jest.fn(),
    },
  };

  const mockLoggerService = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    getCorrelationId: jest.fn(),
  };

  const makeTransaction = (overrides: Record<string, unknown> = {}) => ({
    id: 'tx-1',
    claimId: 'claim-1',
    operation: SorobanOperationType.disburse_claim,
    status: SorobanTransactionStatus.confirmed,
    txHash: 'hash-1',
    attemptCount: 1,
    maxAttempts: 5,
    correlationId,
    createdAt: new Date('2026-08-25T19:50:00.000Z'),
    claim: {
      id: 'claim-1',
      status: 'disbursed',
      amount: 250,
      campaignId: 'campaign-1',
    },
    ...overrides,
  });

  const makeEvent = (overrides: Record<string, unknown> = {}) => ({
    id: 'event-1',
    eventTopic: SorobanEventTopic.claim_disbursed,
    txHash: 'hash-1',
    ledger: 1234567,
    eventIndex: 0,
    claimId: 'claim-1',
    createdAt: new Date('2026-08-25T19:50:12.000Z'),
    ...overrides,
  });

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        SorobanCorrelationTraceService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    service = module.get<SorobanCorrelationTraceService>(
      SorobanCorrelationTraceService,
    );
  });

  it('loads the transactions carrying the correlation ID, oldest first', async () => {
    mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
      makeTransaction(),
    ]);
    mockPrismaService.sorobanEventCorrelation.findMany.mockResolvedValue([
      makeEvent(),
    ]);

    const trace = await service.getTrace(`  ${correlationId}  `);

    expect(mockPrismaService.sorobanTransaction.findMany).toHaveBeenCalledWith({
      where: { correlationId },
      orderBy: { createdAt: 'asc' },
      include: {
        claim: {
          select: {
            id: true,
            status: true,
            amount: true,
            campaignId: true,
          },
        },
      },
    });
    // The incoming ID is normalised before it is echoed back or queried.
    expect(trace.correlationId).toBe(correlationId);
    expect(trace.found).toBe(true);
    expect(trace.claimIds).toEqual(['claim-1']);
    expect(trace.txHashes).toEqual(['hash-1']);
    expect(trace.transactions).toHaveLength(1);
    expect(trace.events).toHaveLength(1);
  });

  it('matches events by transaction hash or claim, oldest ledger first', async () => {
    mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
      makeTransaction(),
      // A transaction that has not been submitted yet has no hash to match on.
      makeTransaction({
        id: 'tx-2',
        txHash: null,
        status: SorobanTransactionStatus.pending,
        claimId: 'claim-2',
        claim: {
          id: 'claim-2',
          status: 'approved',
          amount: 10,
          campaignId: 'campaign-1',
        },
      }),
    ]);
    mockPrismaService.sorobanEventCorrelation.findMany.mockResolvedValue([]);

    const trace = await service.getTrace(correlationId);

    expect(
      mockPrismaService.sorobanEventCorrelation.findMany,
    ).toHaveBeenCalledWith({
      where: {
        OR: [
          { txHash: { in: ['hash-1'] } },
          { claimId: { in: ['claim-1', 'claim-2'] } },
        ],
      },
      orderBy: { ledger: 'asc' },
    });
    expect(trace.txHashes).toEqual(['hash-1']);
    expect(trace.claimIds).toEqual(['claim-1', 'claim-2']);
  });

  it('skips the event query and reports an empty trace when nothing matches', async () => {
    mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([]);

    const trace = await service.getTrace('corr-missing');

    expect(
      mockPrismaService.sorobanEventCorrelation.findMany,
    ).not.toHaveBeenCalled();
    expect(trace.found).toBe(false);
    expect(trace.claimIds).toEqual([]);
    expect(trace.txHashes).toEqual([]);
    expect(trace.events).toEqual([]);
    expect(trace.summary).toEqual({
      transactionCount: 0,
      confirmedTransactionCount: 0,
      failedTransactionCount: 0,
      pendingTransactionCount: 0,
      eventCount: 0,
      startedAt: null,
      lastActivityAt: null,
      durationMs: null,
    });
  });

  it('summarises statuses and the elapsed time of the whole chain', async () => {
    mockPrismaService.sorobanTransaction.findMany.mockResolvedValue([
      makeTransaction({
        id: 'tx-1',
        status: SorobanTransactionStatus.confirmed,
        createdAt: new Date('2026-08-25T19:50:00.000Z'),
      }),
      makeTransaction({
        id: 'tx-2',
        status: SorobanTransactionStatus.failed,
        createdAt: new Date('2026-08-25T19:50:02.000Z'),
      }),
      makeTransaction({
        id: 'tx-3',
        status: SorobanTransactionStatus.submitted,
        createdAt: new Date('2026-08-25T19:50:04.000Z'),
      }),
    ]);
    mockPrismaService.sorobanEventCorrelation.findMany.mockResolvedValue([
      makeEvent({ createdAt: new Date('2026-08-25T19:50:12.000Z') }),
    ]);

    const trace = await service.getTrace(correlationId);

    expect(trace.summary).toEqual({
      transactionCount: 3,
      confirmedTransactionCount: 1,
      failedTransactionCount: 1,
      // `submitted` still counts as in flight.
      pendingTransactionCount: 1,
      eventCount: 1,
      startedAt: new Date('2026-08-25T19:50:00.000Z'),
      lastActivityAt: new Date('2026-08-25T19:50:12.000Z'),
      durationMs: 12000,
    });
    expect(mockLoggerService.debug).toHaveBeenCalledWith(
      'Resolved Soroban correlation trace',
      expect.any(String),
      expect.objectContaining({ correlationId, transactionCount: 3 }),
    );
  });

  afterEach(async () => {
    await module?.close();
    jest.clearAllMocks();
  });
});
