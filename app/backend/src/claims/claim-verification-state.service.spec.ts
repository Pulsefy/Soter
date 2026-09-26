import 'reflect-metadata';

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClaimStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  ClaimVerificationStateService,
  VERIFICATION_AUDIT_ENTITY,
  VERIFICATION_COMPLETE_ACTION,
} from './claim-verification-state.service';

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

describe('ClaimVerificationStateService', () => {
  let service: ClaimVerificationStateService;

  let claimRow: { id: string; status: ClaimStatus } | null;
  let verificationRows: AuditRow[];
  let recordCommitted: boolean;

  const completedAt = new Date('2026-09-25T10:00:00.000Z');

  const verificationRecord = (
    entityId: string,
    metadata: Record<string, unknown>,
  ): AuditRow => ({ entityId, metadata, timestamp: completedAt });

  const prismaMock = {
    claim: {
      findUnique: jest.fn<
        { id: string; status: ClaimStatus } | null,
        [unknown]
      >(),
    },
    auditLog: {
      findMany: jest.fn<AuditRow[], [AuditArgs]>(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    claimRow = { id: 'claim-1', status: ClaimStatus.requested };
    verificationRows = [];
    recordCommitted = true;

    prismaMock.claim.findUnique.mockImplementation(() => claimRow);
    prismaMock.auditLog.findMany.mockImplementation(args => {
      // Emulates the indexed lookup: nothing is visible until the pipeline has
      // committed its verification record.
      if (!recordCommitted) {
        return [];
      }

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
        ClaimVerificationStateService,
        { provide: PrismaService, useValue: prismaMock },
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

    service = module.get(ClaimVerificationStateService);
  });

  it('reads the pipeline record the verification audit entry describes', async () => {
    claimRow = { id: 'claim-1', status: ClaimStatus.verified };
    verificationRows = [
      verificationRecord('claim-1', { score: 0.93, status: 'verified' }),
    ];

    const state = await service.getState('claim-1');

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entity: VERIFICATION_AUDIT_ENTITY,
          action: VERIFICATION_COMPLETE_ACTION,
          entityId: 'claim-1',
        }),
      }),
    );
    expect(state).toEqual({
      claimId: 'claim-1',
      claimStatus: ClaimStatus.verified,
      record: {
        claimId: 'claim-1',
        score: 0.93,
        passed: true,
        completedAt: completedAt.toISOString(),
      },
      complete: true,
      drift: null,
    });
  });

  it('falls back to the configured threshold for records without a status', async () => {
    claimRow = { id: 'claim-1', status: ClaimStatus.verified };
    verificationRows = [verificationRecord('claim-1', { score: 0.72 })];

    const state = await service.getState('claim-1');

    expect(state?.record?.passed).toBe(true);
    expect(state?.complete).toBe(true);
    expect(state?.drift).toBeNull();
  });

  it('flags a claim past requested with no verification record', async () => {
    claimRow = { id: 'claim-1', status: ClaimStatus.verified };
    verificationRows = [];

    const state = await service.getState('claim-1');

    expect(state?.complete).toBe(false);
    expect(state?.drift).toBe('verified_without_verification_record');
  });

  it('flags a claim past requested whose verification did not pass', async () => {
    claimRow = { id: 'claim-1', status: ClaimStatus.approved };
    verificationRows = [
      verificationRecord('claim-1', { score: 0.2, status: 'requested' }),
    ];

    const state = await service.getState('claim-1');

    expect(state?.complete).toBe(false);
    expect(state?.drift).toBe('verified_without_verification_record');
  });

  it('flags a passing verification record the claim never reflected', async () => {
    claimRow = { id: 'claim-1', status: ClaimStatus.requested };
    verificationRows = [
      verificationRecord('claim-1', { score: 0.91, status: 'verified' }),
    ];

    const state = await service.getState('claim-1');

    expect(state?.complete).toBe(true);
    expect(state?.drift).toBe('verification_record_not_reflected');
  });

  it('keeps a claim awaiting verification consistent', async () => {
    claimRow = { id: 'claim-1', status: ClaimStatus.requested };
    verificationRows = [];

    const state = await service.getState('claim-1');

    expect(state?.complete).toBe(false);
    expect(state?.drift).toBeNull();
  });

  it('returns null for a claim that no longer exists', async () => {
    claimRow = null;

    await expect(service.getState('missing')).resolves.toBeNull();
    await expect(service.isVerificationComplete('missing')).resolves.toBe(
      false,
    );
  });

  it('resolves a batch of claims with a single record query', async () => {
    verificationRows = [
      verificationRecord('claim-2', { score: 0.88, status: 'verified' }),
    ];

    const states = await service.getStates([
      { id: 'claim-1', status: ClaimStatus.verified },
      { id: 'claim-2', status: ClaimStatus.requested },
      { id: 'claim-3', status: ClaimStatus.requested },
    ]);

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entityId: { in: ['claim-1', 'claim-2', 'claim-3'] },
        }),
      }),
    );
    expect(states.map(state => state.drift)).toEqual([
      'verified_without_verification_record',
      'verification_record_not_reflected',
      null,
    ]);
  });

  describe('concurrent verification completion and claim status reads', () => {
    it('forces the race between the status write and the record write', async () => {
      // The pipeline flips the claim status first and writes the verification
      // record afterwards, so there is a window where the claim claims a
      // verification that is not readable yet.
      claimRow = { id: 'claim-1', status: ClaimStatus.verified };
      verificationRows = [
        verificationRecord('claim-1', { score: 0.93, status: 'verified' }),
      ];
      recordCommitted = false;

      // Read A lands inside that window.
      const partial = await service.getState('claim-1');

      // Read B is dispatched while the worker commits its record, and lands
      // after the commit.
      const concurrentRead = service.getState('claim-1');
      recordCommitted = true;
      const committed = await concurrentRead;

      // The read that saw the partial write reports the disagreement instead
      // of a completion it cannot prove.
      expect(partial).toMatchObject({
        claimStatus: ClaimStatus.verified,
        record: null,
        complete: false,
        drift: 'verified_without_verification_record',
      });

      // The read that ran after the commit sees both halves agree.
      expect(committed).toMatchObject({
        claimStatus: ClaimStatus.verified,
        complete: true,
        drift: null,
      });
      expect(committed?.record?.score).toBe(0.93);

      // The answer is a function of the two halves, so re-reading after the
      // commit is stable: no drift, no stale completion.
      const afterCommit = service.buildState(
        { id: 'claim-1', status: ClaimStatus.verified },
        committed?.record ?? null,
      );
      expect(afterCommit).toMatchObject({ complete: true, drift: null });
    });
  });
});
