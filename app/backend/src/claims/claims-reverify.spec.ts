import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClaimStatus } from '@prisma/client';
import { ClaimsService } from './claims.service';

describe('ClaimsService.reverifyClaim', () => {
  let service: ClaimsService;
  // CHECK: declare prismaMock / auditMock / enqueueSpy the same way the existing spec does

  beforeEach(async () => {
    // PASTE the module/mocks setup from claims.service.spec.ts here, then:
    // service = module.get(ClaimsService);
    // enqueueSpy = jest.spyOn(service, 'enqueueVerificationForClaim').mockResolvedValue(undefined as never);
  });

  const claimWithStatus = (status: ClaimStatus) => ({ id: 'claim-1', status });

  it('re-enqueues verification and audits reason and actor', async () => {
    prismaMock.claim.findUnique.mockResolvedValue(claimWithStatus(ClaimStatus.requested));

    const result = await service.reverifyClaim(
      'claim-1',
      { reason: 'Model prompt fixed' },
      'admin-1',
    );

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        entityId: 'claim-1',
        action: 'reverify',
        metadata: expect.objectContaining({
          reason: 'Model prompt fixed',
          override: false,
          previousStatus: ClaimStatus.requested,
        }),
      }),
    );
    expect(result).toEqual({ claimId: 'claim-1', status: ClaimStatus.requested, queued: true });
  });

  it('rejects a disbursed claim without override and does not enqueue', async () => {
    prismaMock.claim.findUnique.mockResolvedValue(claimWithStatus(ClaimStatus.disbursed));

    await expect(
      service.reverifyClaim('claim-1', { reason: 'Evidence corrected' }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(auditMock.record).not.toHaveBeenCalled();
  });

  it('allows a disbursed claim with override and logs the override', async () => {
    prismaMock.claim.findUnique.mockResolvedValue(claimWithStatus(ClaimStatus.disbursed));

    await service.reverifyClaim(
      'claim-1',
      { reason: 'Evidence corrected', override: true },
      'admin-1',
    );

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          override: true,
          previousStatus: ClaimStatus.disbursed,
        }),
      }),
    );
  });

  it('throws NotFound for an unknown claim', async () => {
    prismaMock.claim.findUnique.mockResolvedValue(null);

    await expect(
      service.reverifyClaim('missing', { reason: 'Retry please' }, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});