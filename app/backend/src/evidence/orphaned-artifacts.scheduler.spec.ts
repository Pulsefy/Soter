import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrphanedArtifactsScheduler } from './orphaned-artifacts.scheduler';
import { OrphanedArtifactsService } from './orphaned-artifacts.service';

describe('OrphanedArtifactsScheduler', () => {
  let scheduler: OrphanedArtifactsScheduler;
  let service: any;
  let configService: any;

  beforeEach(async () => {
    service = {
      processOrphanedArtifacts: jest.fn().mockResolvedValue({
        dryRun: false,
        orphansFound: 2,
        newlyFlagged: 2,
        totalSizeBytes: 10000,
      }),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'ORPHAN_ARTIFACTS_ENABLED') return 'true';
        if (key === 'ORPHAN_ARTIFACTS_DRY_RUN') return 'true';
        if (key === 'ORPHAN_ARTIFACT_GRACE_PERIOD_HOURS') return '48';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrphanedArtifactsScheduler,
        { provide: OrphanedArtifactsService, useValue: service },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    scheduler = module.get<OrphanedArtifactsScheduler>(
      OrphanedArtifactsScheduler,
    );
  });

  it('runs scheduled detection with config parameters', async () => {
    await scheduler.scheduleOrphanedArtifactsDetection();

    expect(service.processOrphanedArtifacts).toHaveBeenCalledWith({
      dryRun: true,
      gracePeriodHours: 48,
    });
  });

  it('skips run when disabled by config', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'ORPHAN_ARTIFACTS_ENABLED') return 'false';
      return undefined;
    });

    await scheduler.scheduleOrphanedArtifactsDetection();

    expect(service.processOrphanedArtifacts).not.toHaveBeenCalled();
  });

  it('catches and logs errors without throwing unhandled exceptions', async () => {
    service.processOrphanedArtifacts.mockRejectedValue(
      new Error('DB connection failed'),
    );

    await expect(
      scheduler.scheduleOrphanedArtifactsDetection(),
    ).resolves.not.toThrow();
  });
});
