import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrphanedArtifactsService } from './orphaned-artifacts.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from './storage/storage.service';
import { AppException } from '../common/dto/error-response.dto';

describe('OrphanedArtifactsService', () => {
  let service: OrphanedArtifactsService;
  let prisma: any;
  let auditService: any;
  let storageService: any;
  let configService: any;

  beforeEach(async () => {
    prisma = {
      evidenceQueueItem: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      claim: {
        findMany: jest.fn(),
      },
      verificationRequest: {
        findMany: jest.fn(),
      },
    };

    auditService = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    storageService = {
      remove: jest.fn().mockResolvedValue(undefined),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'ORPHAN_ARTIFACT_GRACE_PERIOD_HOURS') return '24';
        if (key === 'ORPHAN_ARTIFACTS_DRY_RUN') return 'false';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrphanedArtifactsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        { provide: StorageService, useValue: storageService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<OrphanedArtifactsService>(OrphanedArtifactsService);
  });

  describe('identifyOrphans', () => {
    it('returns empty list when no artifacts exist past grace period', async () => {
      prisma.evidenceQueueItem.findMany.mockResolvedValue([]);

      const result = await service.identifyOrphans();

      expect(result.orphans).toEqual([]);
      expect(result.totalSizeBytes).toBe(0);
      expect(result.gracePeriodHours).toBe(24);
      expect(prisma.claim.findMany).not.toHaveBeenCalled();
    });

    it('identifies artifacts with no corresponding claim or verification record', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const items = [
        {
          id: 'art-orphan-1',
          fileName: 'doc1.pdf',
          size: 1024,
          mimeType: 'application/pdf',
          createdAt: oldDate,
          updatedAt: oldDate,
          ownerId: 'user-1',
          orgId: 'org-1',
          status: 'completed',
          storageKey: 'key-1',
          filePath: null,
          metadata: { claimId: 'non-existent-claim' },
        },
        {
          id: 'art-with-claim',
          fileName: 'doc2.pdf',
          size: 2048,
          mimeType: 'application/pdf',
          createdAt: oldDate,
          updatedAt: oldDate,
          ownerId: 'user-1',
          orgId: 'org-1',
          status: 'completed',
          storageKey: 'key-2',
          filePath: null,
          metadata: { claimId: 'live-claim-1' },
        },
        {
          id: 'art-with-ref',
          fileName: 'doc3.pdf',
          size: 4096,
          mimeType: 'application/pdf',
          createdAt: oldDate,
          updatedAt: oldDate,
          ownerId: 'user-1',
          orgId: 'org-1',
          status: 'completed',
          storageKey: 'key-3',
          filePath: null,
          metadata: {},
        },
        {
          id: 'art-orphan-2',
          fileName: 'doc4.pdf',
          size: 8192,
          mimeType: 'application/pdf',
          createdAt: oldDate,
          updatedAt: oldDate,
          ownerId: 'user-1',
          orgId: 'org-1',
          status: 'completed',
          storageKey: 'key-4',
          filePath: null,
          metadata: null,
        },
      ];

      prisma.evidenceQueueItem.findMany.mockResolvedValue(items);
      // live-claim-1 matches by ID; art-with-ref matches by evidenceRef
      prisma.claim.findMany.mockResolvedValue([
        { id: 'live-claim-1', evidenceRef: null },
        { id: 'live-claim-2', evidenceRef: 'art-with-ref' },
      ]);
      prisma.verificationRequest.findMany.mockResolvedValue([]);

      const result = await service.identifyOrphans();

      expect(result.orphans).toHaveLength(2);
      expect(result.orphans.map(o => o.id)).toEqual([
        'art-orphan-1',
        'art-orphan-2',
      ]);
      expect(result.totalSizeBytes).toBe(1024 + 8192);
    });

    it('identifies artifacts linked to deleted claims as orphans', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const items = [
        {
          id: 'art-deleted-claim',
          fileName: 'doc.pdf',
          size: 1500,
          mimeType: 'application/pdf',
          createdAt: oldDate,
          updatedAt: oldDate,
          ownerId: 'user-1',
          orgId: null,
          status: 'completed',
          storageKey: 'key-del',
          filePath: null,
          metadata: { claimId: 'deleted-claim-id' },
        },
      ];

      prisma.evidenceQueueItem.findMany.mockResolvedValue(items);
      // Query filters out deleted claims (deletedAt: null), so none returned
      prisma.claim.findMany.mockResolvedValue([]);

      const result = await service.identifyOrphans();

      expect(result.orphans).toHaveLength(1);
      expect(result.orphans[0].id).toBe('art-deleted-claim');
      expect(result.totalSizeBytes).toBe(1500);
    });

    it('recognizes artifacts linked to live verification requests as non-orphans', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const items = [
        {
          id: 'art-verif',
          fileName: 'id.jpg',
          size: 3000,
          mimeType: 'image/jpeg',
          createdAt: oldDate,
          updatedAt: oldDate,
          ownerId: 'user-2',
          orgId: 'org-1',
          status: 'completed',
          storageKey: 'key-verif',
          filePath: null,
          metadata: { verificationRequestId: 'verif-123' },
        },
      ];

      prisma.evidenceQueueItem.findMany.mockResolvedValue(items);
      prisma.claim.findMany.mockResolvedValue([]);
      prisma.verificationRequest.findMany.mockResolvedValue([
        { id: 'verif-123' },
      ]);

      const result = await service.identifyOrphans();

      expect(result.orphans).toHaveLength(0);
      expect(result.totalSizeBytes).toBe(0);
    });
  });

  describe('processOrphanedArtifacts', () => {
    it('dryRun mode reports orphans without updating database', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const orphanItem = {
        id: 'orphan-1',
        fileName: 'orphan.pdf',
        size: 5000,
        mimeType: 'application/pdf',
        createdAt: oldDate,
        updatedAt: oldDate,
        ownerId: 'user-1',
        orgId: 'org-1',
        status: 'completed',
        storageKey: 'key-1',
        filePath: null,
        metadata: {},
      };

      prisma.evidenceQueueItem.findMany.mockResolvedValue([orphanItem]);
      prisma.claim.findMany.mockResolvedValue([]);
      prisma.verificationRequest.findMany.mockResolvedValue([]);

      const result = await service.processOrphanedArtifacts({ dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.action).toBe('detected_only');
      expect(result.orphansFound).toBe(1);
      expect(result.newlyFlagged).toBe(1);
      expect(result.totalSizeBytes).toBe(5000);
      expect(prisma.evidenceQueueItem.update).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('live mode flags orphaned artifacts for review and records audit logs', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const orphanItem = {
        id: 'orphan-1',
        fileName: 'orphan.pdf',
        size: 5000,
        mimeType: 'application/pdf',
        createdAt: oldDate,
        updatedAt: oldDate,
        ownerId: 'user-1',
        orgId: 'org-1',
        status: 'completed',
        storageKey: 'key-1',
        filePath: null,
        metadata: { uploadContext: 'claim-step-1' },
      };

      prisma.evidenceQueueItem.findMany.mockResolvedValue([orphanItem]);
      prisma.evidenceQueueItem.findUnique.mockResolvedValue(orphanItem);
      prisma.claim.findMany.mockResolvedValue([]);
      prisma.verificationRequest.findMany.mockResolvedValue([]);
      prisma.evidenceQueueItem.update.mockResolvedValue({});

      const result = await service.processOrphanedArtifacts({ dryRun: false });

      expect(result.dryRun).toBe(false);
      expect(result.action).toBe('flagged_for_review');
      expect(result.orphansFound).toBe(1);
      expect(result.newlyFlagged).toBe(1);
      expect(result.alreadyFlagged).toBe(0);

      expect(prisma.evidenceQueueItem.update).toHaveBeenCalledWith({
        where: { id: 'orphan-1' },
        data: {
          metadata: expect.objectContaining({
            isOrphan: true,
            flaggedForReview: true,
            reviewStatus: 'pending_review',
            uploadContext: 'claim-step-1',
          }),
        },
      });

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'orphan_flagged_for_review',
          entityId: 'orphan-1',
        }),
      );
    });

    it('skips updating artifacts that are already flagged for review', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const alreadyFlaggedItem = {
        id: 'orphan-flagged',
        fileName: 'orphan.pdf',
        size: 5000,
        mimeType: 'application/pdf',
        createdAt: oldDate,
        updatedAt: oldDate,
        ownerId: 'user-1',
        orgId: 'org-1',
        status: 'completed',
        storageKey: 'key-1',
        filePath: null,
        metadata: { flaggedForReview: true, reviewStatus: 'pending_review' },
      };

      prisma.evidenceQueueItem.findMany.mockResolvedValue([alreadyFlaggedItem]);
      prisma.claim.findMany.mockResolvedValue([]);
      prisma.verificationRequest.findMany.mockResolvedValue([]);

      const result = await service.processOrphanedArtifacts({ dryRun: false });

      expect(result.alreadyFlagged).toBe(1);
      expect(result.newlyFlagged).toBe(0);
      expect(prisma.evidenceQueueItem.update).not.toHaveBeenCalled();
    });
  });

  describe('getOrphanReport', () => {
    it('returns counts, total size, and breakdown of flagged/unflagged orphans', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const items = [
        {
          id: 'unflagged-1',
          fileName: 'doc1.pdf',
          size: 1000,
          mimeType: 'application/pdf',
          createdAt: oldDate,
          updatedAt: oldDate,
          ownerId: 'user-1',
          orgId: 'org-1',
          status: 'completed',
          storageKey: 'key-1',
          filePath: null,
          metadata: {},
        },
        {
          id: 'flagged-1',
          fileName: 'doc2.pdf',
          size: 2500,
          mimeType: 'application/pdf',
          createdAt: oldDate,
          updatedAt: oldDate,
          ownerId: 'user-1',
          orgId: 'org-1',
          status: 'completed',
          storageKey: 'key-2',
          filePath: null,
          metadata: { flaggedForReview: true },
        },
      ];

      prisma.evidenceQueueItem.findMany.mockResolvedValue(items);
      prisma.claim.findMany.mockResolvedValue([]);
      prisma.verificationRequest.findMany.mockResolvedValue([]);

      const report = await service.getOrphanReport();

      expect(report.totalCount).toBe(2);
      expect(report.totalSizeBytes).toBe(3500);
      expect(report.flaggedCount).toBe(1);
      expect(report.flaggedSizeBytes).toBe(2500);
      expect(report.unflaggedCount).toBe(1);
      expect(report.unflaggedSizeBytes).toBe(1000);
      expect(report.items).toHaveLength(2);
    });
  });

  describe('deleteReviewedOrphan', () => {
    it('rejects deletion if artifact was not flagged for review', async () => {
      prisma.evidenceQueueItem.findUnique.mockResolvedValue({
        id: 'art-unflagged',
        metadata: {},
      });

      await expect(
        service.deleteReviewedOrphan('art-unflagged', 'admin-1'),
      ).rejects.toThrow(AppException);

      expect(prisma.evidenceQueueItem.delete).not.toHaveBeenCalled();
      expect(storageService.remove).not.toHaveBeenCalled();
    });

    it('deletes storage and record if artifact was flagged for review', async () => {
      prisma.evidenceQueueItem.findUnique.mockResolvedValue({
        id: 'art-flagged',
        fileName: 'file.pdf',
        size: 3000,
        storageKey: 'storage-key-1',
        filePath: null,
        orgId: 'org-1',
        metadata: { flaggedForReview: true },
      });
      prisma.evidenceQueueItem.delete.mockResolvedValue({});

      const result = await service.deleteReviewedOrphan(
        'art-flagged',
        'admin-1',
      );

      expect(result.deletedId).toBe('art-flagged');
      expect(result.reclaimedBytes).toBe(3000);
      expect(storageService.remove).toHaveBeenCalledWith('storage-key-1');
      expect(prisma.evidenceQueueItem.delete).toHaveBeenCalledWith({
        where: { id: 'art-flagged' },
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'reviewed_orphan_deleted',
          entityId: 'art-flagged',
        }),
      );
    });
  });
});
