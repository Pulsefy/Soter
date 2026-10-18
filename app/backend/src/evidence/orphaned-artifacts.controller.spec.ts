import { Test, TestingModule } from '@nestjs/testing';
import { OrphanedArtifactsController } from './orphaned-artifacts.controller';
import { OrphanedArtifactsService } from './orphaned-artifacts.service';
import { Reflector } from '@nestjs/core';
import { AppRole } from '../auth/app-role.enum';
import { ROLES_KEY } from '../auth/roles.decorator';

describe('OrphanedArtifactsController', () => {
  let controller: OrphanedArtifactsController;
  let service: any;
  let reflector: Reflector;

  beforeEach(async () => {
    service = {
      getOrphanReport: jest.fn().mockResolvedValue({
        totalCount: 3,
        totalSizeBytes: 12345,
        flaggedCount: 1,
        flaggedSizeBytes: 5000,
        unflaggedCount: 2,
        unflaggedSizeBytes: 7345,
        items: [],
      }),
      processOrphanedArtifacts: jest.fn().mockResolvedValue({
        dryRun: true,
        orphansFound: 3,
        newlyFlagged: 2,
        alreadyFlagged: 1,
        totalSizeBytes: 12345,
        action: 'detected_only',
        orphans: [],
      }),
      deleteReviewedOrphan: jest.fn().mockResolvedValue({
        message: 'Reviewed orphaned artifact deleted successfully',
        deletedId: 'orphan-1',
        reclaimedBytes: 5000,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrphanedArtifactsController],
      providers: [
        { provide: OrphanedArtifactsService, useValue: service },
        Reflector,
      ],
    }).compile();

    controller = module.get<OrphanedArtifactsController>(
      OrphanedArtifactsController,
    );
    reflector = module.get<Reflector>(Reflector);
  });

  describe('roles', () => {
    it('requires admin role for getReport', () => {
      const roles = reflector.get<AppRole[]>(ROLES_KEY, controller.getReport);
      expect(roles).toEqual([AppRole.admin]);
    });

    it('requires admin role for triggerScan', () => {
      const roles = reflector.get<AppRole[]>(ROLES_KEY, controller.triggerScan);
      expect(roles).toEqual([AppRole.admin]);
    });

    it('requires admin role for deleteReviewed', () => {
      const roles = reflector.get<AppRole[]>(
        ROLES_KEY,
        controller.deleteReviewed,
      );
      expect(roles).toEqual([AppRole.admin]);
    });
  });

  describe('getReport', () => {
    it('calls service.getOrphanReport with parsed query params', async () => {
      const result = await controller.getReport('48', 'org-123');

      expect(service.getOrphanReport).toHaveBeenCalledWith({
        gracePeriodHours: 48,
        orgId: 'org-123',
      });
      expect(result.totalCount).toBe(3);
      expect(result.totalSizeBytes).toBe(12345);
    });
  });

  describe('triggerScan', () => {
    it('calls service.processOrphanedArtifacts with body params', async () => {
      const result = await controller.triggerScan(true, 72, 'org-abc');

      expect(service.processOrphanedArtifacts).toHaveBeenCalledWith({
        dryRun: true,
        gracePeriodHours: 72,
        orgId: 'org-abc',
      });
      expect(result.dryRun).toBe(true);
      expect(result.orphansFound).toBe(3);
    });
  });

  describe('deleteReviewed', () => {
    it('calls service.deleteReviewedOrphan with admin user id', async () => {
      const mockReq: any = {
        user: { apiKeyId: 'admin-key-1', role: 'admin' },
      };

      const result = await controller.deleteReviewed('orphan-1', mockReq);

      expect(service.deleteReviewedOrphan).toHaveBeenCalledWith(
        'orphan-1',
        'admin-key-1',
      );
      expect(result.deletedId).toBe('orphan-1');
    });
  });
});
