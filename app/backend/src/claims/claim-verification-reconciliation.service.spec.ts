import 'reflect-metadata';

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronExpression } from '@nestjs/schedule';
import { ClaimStatus } from '@prisma/client';

import { MetricsService } from '../observability/metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CLAIM_VERIFICATION_DRIFT_COUNT_GAUGE,
  CLAIM_VERIFICATION_DRIFT_METRIC,
  ClaimVerificationReconciliationService,
} from './claim-verification-reconciliation.service';
import { ClaimVerificationStateService } from './claim-verification-state.service';

interface AuditRow {
  entityId: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

interface AuditArgs {
  where?: {
    entityId?: string | { in: string[] };
  };
}

describe('ClaimVerificationReconciliationService', () => {
  let service: ClaimVerificationReconciliationService;

  let claimRows: { id: string; status: ClaimStatus }[];
  let verificationRows: AuditRow[];

  const completedAt = new Date('2026-09-25T10:00:00.000Z');

  const verificationRecord = (
    entityId: string,
    metadata: Record<string, unknown>,
  ): AuditRow => ({ entityId, metadata, timestamp: completedAt });

  const prismaMock = {
    claim: {
      findMany: jest.fn<{ id: string; status: ClaimStatus }[], [unknown]>(),
    },
    auditLog: {
      findMany: jest.fn<AuditRow[], [AuditArgs]>(),
    },
  };

  const metricsMock = {
    incrementCounter: jest.fn(),
    setGauge: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    claimRows = [];
    verificationRows = [];

    prismaMock.claim.findMany.mockImplementation(() => claimRows);
    prismaMock.auditLog.findMany.mockImplementation(args => {
      const entityId = args?.where?.entityId;
      return verificationRows.filter(row => {
        if (typeof entityId === 'string') {
          return row.entityId === entityId;
        }
        if (entityId && Array.isArray(entityId.in)) {
          return entityId.in.includes(row.entityId);
        }
        return true;
      });
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimVerificationReconciliationService,
        ClaimVerificationStateService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: MetricsService, useValue: metricsMock },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'VERIFICATION_THRESHOLD' ? '0.7' : undefined,
            ),
          },
        },
      ],
    }).compile();

    service = module.get(ClaimVerificationReconciliationService);
  });

  it('reports claims whose status disagrees with their verification record', async () => {
    claimRows = [
      { id: 'claim-1', status: ClaimStatus.verified },
      { id: 'claim-2', status: ClaimStatus.requested },
      { id: 'claim-3', status: ClaimStatus.verified },
    ];
    verificationRows = [
      verificationRecord('claim-2', { score: 0.9, status: 'verified' }),
      verificationRecord('claim-3', { score: 0.95, status: 'verified' }),
    ];

    const report = await service.reconcile();

    expect(report.scanned).toBe(3);
    expect(report.driftCount).toBe(2);
    expect(report.drift).toEqual([
      {
        claimId: 'claim-1',
        claimStatus: ClaimStatus.verified,
        kind: 'verified_without_verification_record',
        verificationScore: null,
      },
      {
        claimId: 'claim-2',
        claimStatus: ClaimStatus.requested,
        kind: 'verification_record_not_reflected',
        verificationScore: 0.9,
      },
    ]);

    expect(metricsMock.incrementCounter).toHaveBeenCalledTimes(2);
    expect(metricsMock.incrementCounter).toHaveBeenCalledWith(
      CLAIM_VERIFICATION_DRIFT_METRIC,
      {
        kind: 'verified_without_verification_record',
        claim_status: ClaimStatus.verified,
      },
    );
    expect(metricsMock.incrementCounter).toHaveBeenCalledWith(
      CLAIM_VERIFICATION_DRIFT_METRIC,
      {
        kind: 'verification_record_not_reflected',
        claim_status: ClaimStatus.requested,
      },
    );
    expect(metricsMock.setGauge).toHaveBeenCalledWith(
      CLAIM_VERIFICATION_DRIFT_COUNT_GAUGE,
      2,
    );
  });

  it('reports nothing when claim status and verification records agree', async () => {
    claimRows = [
      { id: 'claim-1', status: ClaimStatus.verified },
      { id: 'claim-2', status: ClaimStatus.requested },
    ];
    verificationRows = [
      verificationRecord('claim-1', { score: 0.8, status: 'verified' }),
    ];

    const report = await service.reconcile();

    expect(report.driftCount).toBe(0);
    expect(report.drift).toEqual([]);
    expect(metricsMock.incrementCounter).not.toHaveBeenCalled();
    expect(metricsMock.setGauge).toHaveBeenCalledWith(
      CLAIM_VERIFICATION_DRIFT_COUNT_GAUGE,
      0,
    );
  });

  it('scans the statuses that either await or presuppose verification', async () => {
    await service.reconcile();

    expect(prismaMock.claim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          status: {
            in: [
              ClaimStatus.requested,
              ClaimStatus.verified,
              ClaimStatus.approved,
              ClaimStatus.disbursed,
            ],
          },
        },
      }),
    );
  });

  it('is registered as an hourly scheduled job', () => {
    const metadata = Reflect.getOwnMetadata(
      'SCHEDULE_CRON_OPTIONS',
      service.handleClaimVerificationReconciliation,
    ) as { cronTime?: string } | undefined;

    expect(metadata?.cronTime).toBe(CronExpression.EVERY_HOUR);
  });

  it('logs drifted claims and stays silent about a clean scan', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    claimRows = [{ id: 'claim-1', status: ClaimStatus.verified }];

    await service.handleClaimVerificationReconciliation();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('claim-1=verified_without_verification_record'),
    );
    expect(logSpy).not.toHaveBeenCalled();

    warnSpy.mockClear();
    verificationRows = [
      verificationRecord('claim-1', { score: 0.9, status: 'verified' }),
    ];

    await service.handleClaimVerificationReconciliation();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('reconciliation clean'),
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('logs a scan failure instead of throwing', async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    prismaMock.claim.findMany.mockImplementationOnce(() => {
      throw new Error('database down');
    });

    await expect(
      service.handleClaimVerificationReconciliation(),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      'Claim/verification reconciliation failed',
      expect.stringContaining('database down'),
    );

    errorSpy.mockRestore();
  });
});
