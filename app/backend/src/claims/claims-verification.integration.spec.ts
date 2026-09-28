import { Test, TestingModule } from '@nestjs/testing';
import { AppException } from '../common/dto/error-response.dto';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { getQueueToken } from '@nestjs/bullmq';
import { ClaimStatus } from '@prisma/client';

import { ClaimsService } from './claims.service';
import { VerificationService } from '../verification/verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetService } from '../common/budget/budget.service';
import { ONCHAIN_ADAPTER_TOKEN } from '../onchain/onchain.adapter';
import { LoggerService } from '../logger/logger.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { SorobanTransactionLifecycleService } from '../onchain/soroban-transaction-lifecycle.service';
import { SorobanTransactionScheduler } from '../onchain/soroban-transaction.scheduler';
import { VerificationMetadataService } from '../verification/metadata.service';
import { CorrelationPropagationUtil } from '../common/utils/correlation-propagation.util';
import type { VerificationJobData } from '../verification/interfaces/verification-job.interface';

type ClaimRow = {
  id: string;
  campaignId: string;
  status: string;
  amount: number;
  recipientRef: string;
  tokenAddress?: string;
  evidenceRef?: string | null;
  anchorMetadata?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const TOKEN_ADDRESS =
  'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN';

/**
 * Claims <-> verification integration.
 *
 * Covers the path the two subsystems had no contact over before:
 * create() -> verification job is queued -> the job runs through
 * VerificationService -> the claim row reflects the outcome.
 *
 * Prisma and the BullMQ queue are faked with an in-memory claim store so the
 * whole wiring runs without Redis or Postgres; everything else is the real
 * ClaimsService and VerificationService.
 */
describe('Claims -> verification pipeline integration', () => {
  let claimsService: ClaimsService;
  let verificationService: VerificationService;

  let queuedJobs: VerificationJobData[];
  let storedClaims: Map<string, ClaimRow>;
  let config: Record<string, string>;

  const campaign = { id: 'campaign-1', name: 'Test Campaign', metadata: null };

  const prismaMock = {
    campaign: { findUnique: jest.fn() },
    claim: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    sorobanEventCorrelation: { findFirst: jest.fn() },
    auditLog: { findMany: jest.fn(), findFirst: jest.fn() },
    balanceLedger: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const defaultQueueAdd = (_name: string, data: VerificationJobData) => {
    queuedJobs.push(data);
    return { id: `job-${queuedJobs.length}` };
  };

  const buildModule = async (
    queueAdd: jest.Mock = jest.fn(defaultQueueAdd),
  ): Promise<TestingModule> =>
    Test.createTestingModule({
      providers: [
        ClaimsService,
        VerificationService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => config[key]) },
        },
        { provide: getQueueToken('verification'), useValue: { add: queueAdd } },
        {
          provide: AuditService,
          useValue: { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
        },
        {
          provide: HttpService,
          useValue: { get: jest.fn(), post: jest.fn() },
        },
        {
          provide: VerificationMetadataService,
          useValue: {
            enhanceWithMetadata: jest.fn((dto: Record<string, unknown>) => ({
              ...dto,
              warnings: [],
              validationErrors: [],
            })),
          },
        },
        { provide: CorrelationPropagationUtil, useValue: {} },
        {
          provide: MetricsService,
          useValue: {
            incrementVerificationJobEnqueued: jest.fn(),
            incrementClaimsCreated: jest.fn(),
            incrementClaimsVerified: jest.fn(),
            adjustClaimsInFunnel: jest.fn(),
            recordClaimFunnelDuration: jest.fn(),
            incrementCounter: jest.fn(),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
          },
        },
        {
          provide: EncryptionService,
          useValue: {
            encrypt: jest.fn((value: string) => value),
            decrypt: jest.fn((value: string) => value),
            encryptDeterministic: jest.fn((value: string) => value),
            decryptDeterministic: jest.fn((value: string) => value),
          },
        },
        {
          provide: BudgetService,
          useValue: {
            assertWithinBudget: jest.fn().mockResolvedValue(undefined),
            reserveBudget: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: ONCHAIN_ADAPTER_TOKEN, useValue: null },
        {
          provide: SorobanTransactionLifecycleService,
          useValue: { createTransaction: jest.fn() },
        },
        {
          provide: SorobanTransactionScheduler,
          useValue: { scheduleTransaction: jest.fn() },
        },
      ],
    }).compile();

  beforeEach(() => {
    jest.clearAllMocks();

    queuedJobs = [];
    storedClaims = new Map();
    config = {
      VERIFICATION_MODE: 'test',
      // Not '0': VerificationService falls back to 0.7 for any falsy parsed
      // threshold, so a negative threshold is the deterministic way to make
      // every fixture score pass.
      VERIFICATION_THRESHOLD: '-1',
      ONCHAIN_ENABLED: 'false',
    };

    prismaMock.campaign.findUnique.mockResolvedValue(campaign);

    prismaMock.claim.create.mockImplementation(
      ({ data }: { data: Partial<ClaimRow> }) => {
        const row: ClaimRow = {
          id: 'claim-1',
          status: ClaimStatus.requested,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(data as ClaimRow),
        };
        storedClaims.set(row.id, row);
        return { ...row, campaign };
      },
    );

    prismaMock.claim.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        storedClaims.get(where.id) ?? null,
    );

    prismaMock.claim.update.mockImplementation(
      ({ where, data }: { where: { id: string }; data: object }) => {
        const row = {
          ...(storedClaims.get(where.id) as ClaimRow),
          ...data,
        };
        storedClaims.set(where.id, row);
        return row;
      },
    );

    prismaMock.$transaction.mockImplementation(async (callback: unknown) =>
      (callback as (tx: unknown) => Promise<unknown>)({
        claim: prismaMock.claim,
        balanceLedger: { create: jest.fn().mockResolvedValue({}) },
        $queryRaw: jest
          .fn()
          .mockResolvedValue([{ id: campaign.id, budget: 1_000_000 }]),
      }),
    );
  });

  const createClaim = () =>
    claimsService.create({
      campaignId: campaign.id,
      amount: 100,
      recipientRef: 'recipient-1',
      tokenAddress: TOKEN_ADDRESS,
    });

  const readVerification = (claimId: string) =>
    (
      storedClaims.get(claimId) as ClaimRow & {
        anchorMetadata?: { verification?: Record<string, unknown> };
      }
    ).anchorMetadata?.verification;

  it('queues a verification job on create and reflects the result on the claim', async () => {
    const moduleRef = await buildModule();
    claimsService = moduleRef.get(ClaimsService);
    verificationService = moduleRef.get(VerificationService);

    const claim = await createClaim();

    expect(queuedJobs).toHaveLength(1);
    expect(queuedJobs[0].claimId).toBe(claim.id);

    // The worker picks the job up and runs the verification pipeline.
    const result = await verificationService.processVerification(queuedJobs[0]);

    const stored = storedClaims.get(claim.id) as ClaimRow;
    expect(stored.status).toBe(ClaimStatus.verified);

    const verification = readVerification(claim.id);
    expect(verification).toMatchObject({
      passed: true,
      score: result.score,
      confidence: result.confidence,
      factors: result.details.factors,
    });

    // ... and the outcome is visible through the claims API.
    const dto = (await claimsService.findOne(claim.id)) as {
      verification: { passed: boolean; score: number } | null;
    };
    expect(dto.verification).toMatchObject({
      passed: true,
      score: result.score,
    });

    // An operator re-applying the same decision is a no-op, not an error.
    await expect(claimsService.verify(claim.id)).resolves.toMatchObject({
      id: claim.id,
    });
  });

  it('leaves the claim in requested and blocks verify() when the score misses the threshold', async () => {
    config.VERIFICATION_THRESHOLD = '2';

    const moduleRef = await buildModule();
    claimsService = moduleRef.get(ClaimsService);
    verificationService = moduleRef.get(VerificationService);

    const claim = await createClaim();
    const result = await verificationService.processVerification(queuedJobs[0]);

    expect(result.score).toBeLessThan(2);

    const stored = storedClaims.get(claim.id) as ClaimRow;
    expect(stored.status).toBe(ClaimStatus.requested);
    expect(readVerification(claim.id)).toMatchObject({ passed: false });

    await expect(claimsService.verify(claim.id)).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it('keeps the claim when the verification queue is unavailable', async () => {
    const moduleRef = await buildModule(
      jest.fn().mockRejectedValue(new Error('redis unavailable')),
    );
    claimsService = moduleRef.get(ClaimsService);

    const claim = await createClaim();

    expect(claim.id).toBe('claim-1');
    expect(storedClaims.get(claim.id)?.status).toBe(ClaimStatus.requested);
    expect(readVerification(claim.id)).toBeUndefined();

    // With no verification record the claim can never be marked verified.
    await expect(claimsService.verify(claim.id)).rejects.toBeInstanceOf(
      AppException,
    );
  });
});
