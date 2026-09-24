import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityLinkingService } from './entity-linking.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { ENTITY_LINK_CONFIDENCE_CONFIG } from '../common/config/entity-link-confidence.config';

describe('EntityLinkingService', () => {
  let service: EntityLinkingService;
  let prisma: PrismaService;
  let auditService: jest.Mocked<AuditService>;
  let metricsService: jest.Mocked<MetricsService>;

  const mockPrisma = {
    entityLink: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    registryOrganization: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    registryLocation: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    registryAsset: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    registryProject: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockAuditService = {
    record: jest.fn(),
  };

  const mockMetricsService = {
    adjustEntityLinkReviewQueueDepth: jest.fn(),
    setEntityLinkReviewQueueDepth: jest.fn(),
    incrementEntityLinkReviewDecision: jest.fn(),
    recordEntityLinkReviewDuration: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntityLinkingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    service = module.get<EntityLinkingService>(EntityLinkingService);
    prisma = module.get<PrismaService>(PrismaService);
    auditService = module.get(AuditService);
    metricsService = module.get(MetricsService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('linkEntity - confidence banding', () => {
    it('auto-accepts a link at or above the threshold', async () => {
      const dto = {
        sourceType: 'claim' as const,
        sourceId: 'claim-123',
        extractedName: 'Test Organization',
        entityType: 'organization' as const,
        confidenceScore: ENTITY_LINK_CONFIDENCE_CONFIG.AUTO_ACCEPT_THRESHOLD,
        matchMethod: 'exact',
      };

      mockPrisma.entityLink.create.mockResolvedValue({
        id: 'link-1',
        ...dto,
        organizationId: 'org-1',
        locationId: null,
        assetId: null,
        projectId: null,
        reviewStatus: 'auto_accepted',
        queuedAt: null,
        isActive: true,
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.linkEntity(dto);

      expect(result.reviewStatus).toBe('auto_accepted');
      expect(result.isActive).toBe(true);
      expect(prisma.entityLink.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reviewStatus: 'auto_accepted',
            isActive: true,
            queuedAt: null,
          }),
        }),
      );
      expect(
        metricsService.adjustEntityLinkReviewQueueDepth,
      ).not.toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'EntityLink',
          entityId: 'link-1',
          action: 'auto_accepted',
        }),
      );
    });

    it('routes a below-threshold link to the review queue instead of applying it', async () => {
      const belowThreshold =
        ENTITY_LINK_CONFIDENCE_CONFIG.AUTO_ACCEPT_THRESHOLD - 0.1;
      const dto = {
        sourceType: 'claim' as const,
        sourceId: 'claim-123',
        extractedName: 'Ambiguous Org',
        entityType: 'organization' as const,
        confidenceScore: belowThreshold,
        matchMethod: 'fuzzy',
      };

      mockPrisma.entityLink.create.mockResolvedValue({
        id: 'link-2',
        ...dto,
        organizationId: null,
        locationId: null,
        assetId: null,
        projectId: null,
        reviewStatus: 'pending_review',
        queuedAt: new Date(),
        isActive: false,
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.linkEntity(dto);

      expect(result.reviewStatus).toBe('pending_review');
      expect(result.isActive).toBe(false);
      expect(prisma.entityLink.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reviewStatus: 'pending_review',
            isActive: false,
            queuedAt: expect.any(Date),
          }),
        }),
      );
      expect(
        metricsService.adjustEntityLinkReviewQueueDepth,
      ).toHaveBeenCalledWith('organization', 1);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'queued_for_review',
          metadata: expect.objectContaining({
            confidenceScore: belowThreshold,
          }),
        }),
      );
    });

    it('should throw BadRequestException for invalid confidence score', async () => {
      const dto = {
        sourceType: 'claim' as const,
        sourceId: 'claim-123',
        extractedName: 'Test',
        entityType: 'organization' as const,
        confidenceScore: 1.5, // Invalid: > 1
      };

      await expect(service.linkEntity(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException for non-existent registry ID', async () => {
      const dto = {
        sourceType: 'claim' as const,
        sourceId: 'claim-123',
        extractedName: 'Test',
        entityType: 'organization' as const,
        registryId: 'ORG-NONEXISTENT',
        confidenceScore: 0.9,
      };

      mockPrisma.registryOrganization.findUnique.mockResolvedValue(null);

      await expect(service.linkEntity(dto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('queryLinks', () => {
    it('should return filtered entity links', async () => {
      const mockLinks = [
        {
          id: 'link-1',
          sourceType: 'claim',
          sourceId: 'claim-123',
          extractedName: 'Test Org',
          entityType: 'organization',
          confidenceScore: 0.9,
          reviewStatus: 'auto_accepted',
          queuedAt: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.entityLink.findMany.mockResolvedValue(mockLinks);
      mockPrisma.entityLink.count.mockResolvedValue(1);

      const result = await service.queryLinks({
        sourceType: 'claim',
        minConfidence: 0.8,
      });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(prisma.entityLink.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceType: 'claim',
            confidenceScore: { gte: 0.8 },
          }),
        }),
      );
    });

    it('filters by reviewStatus when provided', async () => {
      mockPrisma.entityLink.findMany.mockResolvedValue([]);
      mockPrisma.entityLink.count.mockResolvedValue(0);

      await service.queryLinks({ reviewStatus: 'pending_review' });

      expect(prisma.entityLink.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ reviewStatus: 'pending_review' }),
        }),
      );
    });
  });

  describe('getLinksByCampaign', () => {
    it('should return links for a specific campaign', async () => {
      const mockLinks = [
        {
          id: 'link-1',
          sourceType: 'campaign',
          sourceId: 'campaign-123',
          extractedName: 'Location A',
          entityType: 'location',
          confidenceScore: 0.85,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.entityLink.findMany.mockResolvedValue(mockLinks);

      const result = await service.getLinksByCampaign('campaign-123');

      expect(result).toHaveLength(1);
      expect(result[0].sourceId).toBe('campaign-123');
      expect(prisma.entityLink.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            sourceType: 'campaign',
            sourceId: 'campaign-123',
          },
        }),
      );
    });
  });

  describe('getLinksByClaim', () => {
    it('should return links for a specific claim', async () => {
      const mockLinks = [
        {
          id: 'link-1',
          sourceType: 'claim',
          sourceId: 'claim-456',
          extractedName: 'Project X',
          entityType: 'project',
          confidenceScore: 0.92,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.entityLink.findMany.mockResolvedValue(mockLinks);

      const result = await service.getLinksByClaim('claim-456');

      expect(result).toHaveLength(1);
      expect(result[0].sourceId).toBe('claim-456');
    });
  });

  describe('getLinksByVerification', () => {
    it('should return links for a specific verification', async () => {
      const mockLinks = [
        {
          id: 'link-1',
          sourceType: 'verification',
          sourceId: 'verification-789',
          extractedName: 'Asset Y',
          entityType: 'asset',
          confidenceScore: 0.88,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrisma.entityLink.findMany.mockResolvedValue(mockLinks);

      const result = await service.getLinksByVerification('verification-789');

      expect(result).toHaveLength(1);
      expect(result[0].sourceId).toBe('verification-789');
    });
  });

  describe('getReviewQueue', () => {
    it('lists only pending_review links, oldest queued first', async () => {
      mockPrisma.entityLink.findMany.mockResolvedValue([]);
      mockPrisma.entityLink.count.mockResolvedValue(0);

      await service.getReviewQueue({ entityType: 'organization' });

      expect(prisma.entityLink.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reviewStatus: 'pending_review', entityType: 'organization' },
          orderBy: { queuedAt: 'asc' },
        }),
      );
    });
  });

  describe('decideReview', () => {
    const queuedLink = {
      id: 'link-1',
      sourceType: 'claim',
      sourceId: 'claim-123',
      extractedName: 'Ambiguous Org',
      entityType: 'organization',
      organizationId: null,
      locationId: null,
      assetId: null,
      projectId: null,
      confidenceScore: 0.6,
      matchMethod: 'fuzzy',
      reviewStatus: 'pending_review',
      queuedAt: new Date(Date.now() - 60_000),
      isActive: false,
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      createdAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 60_000),
    };

    it('throws NotFoundException for a nonexistent link', async () => {
      mockPrisma.entityLink.findUnique.mockResolvedValue(null);

      await expect(
        service.decideReview('missing', { action: 'accept' }, 'reviewer-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the link is not pending review', async () => {
      mockPrisma.entityLink.findUnique.mockResolvedValue({
        ...queuedLink,
        reviewStatus: 'accepted',
      });

      await expect(
        service.decideReview('link-1', { action: 'accept' }, 'reviewer-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a queued link: activates it and records audit + metrics', async () => {
      mockPrisma.entityLink.findUnique.mockResolvedValue(queuedLink);
      mockPrisma.entityLink.update.mockResolvedValue({
        ...queuedLink,
        reviewStatus: 'accepted',
        isActive: true,
        reviewedBy: 'reviewer-1',
        reviewedAt: new Date(),
        reviewNotes: 'looks right',
      });

      const result = await service.decideReview(
        'link-1',
        { action: 'accept', reviewNotes: 'looks right' },
        'reviewer-1',
      );

      expect(result.reviewStatus).toBe('accepted');
      expect(result.isActive).toBe(true);
      expect(prisma.entityLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: expect.objectContaining({
          reviewStatus: 'accepted',
          isActive: true,
          reviewedBy: 'reviewer-1',
          reviewNotes: 'looks right',
        }),
      });
      expect(
        metricsService.adjustEntityLinkReviewQueueDepth,
      ).toHaveBeenCalledWith('organization', -1);
      expect(
        metricsService.incrementEntityLinkReviewDecision,
      ).toHaveBeenCalledWith('accept');
      expect(
        metricsService.recordEntityLinkReviewDuration,
      ).toHaveBeenCalledWith('accept', expect.any(Number));
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'reviewer-1',
          entity: 'EntityLink',
          entityId: 'link-1',
          action: 'review_accept',
          metadata: expect.objectContaining({ decision: 'accept' }),
        }),
      );
    });

    it('rejects a queued link: deactivates it without touching registry fields', async () => {
      mockPrisma.entityLink.findUnique.mockResolvedValue(queuedLink);
      mockPrisma.entityLink.update.mockResolvedValue({
        ...queuedLink,
        reviewStatus: 'rejected',
        isActive: false,
        reviewedBy: 'reviewer-1',
        reviewedAt: new Date(),
      });

      const result = await service.decideReview(
        'link-1',
        { action: 'reject', reviewNotes: 'wrong entity' },
        'reviewer-1',
      );

      expect(result.reviewStatus).toBe('rejected');
      expect(result.isActive).toBe(false);
      expect(prisma.entityLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: expect.objectContaining({
          reviewStatus: 'rejected',
          isActive: false,
        }),
      });
      expect(
        metricsService.incrementEntityLinkReviewDecision,
      ).toHaveBeenCalledWith('reject');
    });

    it('remaps a queued link to a different registry entity', async () => {
      mockPrisma.entityLink.findUnique.mockResolvedValue(queuedLink);
      mockPrisma.registryLocation.findUnique.mockResolvedValue({
        id: 'loc-99',
        registryId: 'LOC-099',
      });
      mockPrisma.entityLink.update.mockResolvedValue({
        ...queuedLink,
        entityType: 'location',
        organizationId: null,
        locationId: 'loc-99',
        confidenceScore: 1.0,
        matchMethod: 'manual',
        reviewStatus: 'remapped',
        isActive: true,
        reviewedBy: 'reviewer-1',
        reviewedAt: new Date(),
      });

      const result = await service.decideReview(
        'link-1',
        {
          action: 'remap',
          remapEntityType: 'location',
          remapRegistryId: 'LOC-099',
          reviewNotes: 'actually a location',
        },
        'reviewer-1',
      );

      expect(result.reviewStatus).toBe('remapped');
      expect(result.locationId).toBe('loc-99');
      expect(prisma.entityLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: expect.objectContaining({
          entityType: 'location',
          organizationId: null,
          locationId: 'loc-99',
          matchMethod: 'manual',
          confidenceScore: 1.0,
          reviewStatus: 'remapped',
          isActive: true,
        }),
      });
      expect(
        metricsService.incrementEntityLinkReviewDecision,
      ).toHaveBeenCalledWith('remap');
    });

    it('rejects a remap decision missing the target registry record', async () => {
      mockPrisma.entityLink.findUnique.mockResolvedValue(queuedLink);

      await expect(
        service.decideReview(
          'link-1',
          { action: 'remap', remapEntityType: 'location' },
          'reviewer-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the remap target registry record does not exist', async () => {
      mockPrisma.entityLink.findUnique.mockResolvedValue(queuedLink);
      mockPrisma.registryLocation.findUnique.mockResolvedValue(null);

      await expect(
        service.decideReview(
          'link-1',
          {
            action: 'remap',
            remapEntityType: 'location',
            remapRegistryId: 'LOC-MISSING',
          },
          'reviewer-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('searchRegistry', () => {
    it('should search organization registry', async () => {
      const mockOrgs = [
        {
          id: 'org-1',
          registryId: 'ORG-001',
          name: 'Test Organization',
          aliases: '["Test Org", "TO"]',
        },
      ];

      mockPrisma.registryOrganization.findMany.mockResolvedValue(mockOrgs);

      const result = await service.searchRegistry('organization', 'Test');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Test Organization');
      expect(result[0].entityType).toBe('organization');
      expect(result[0].confidenceScore).toBeGreaterThan(0);
    });

    it('should search location registry', async () => {
      const mockLocations = [
        {
          id: 'loc-1',
          registryId: 'LOC-001',
          name: 'Camp Alpha',
          country: 'Country A',
          region: 'Region B',
        },
      ];

      mockPrisma.registryLocation.findMany.mockResolvedValue(mockLocations);

      const result = await service.searchRegistry('location', 'Camp');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Camp Alpha');
      expect(result[0].entityType).toBe('location');
    });

    it('should search asset registry', async () => {
      const mockAssets = [
        {
          id: 'ast-1',
          registryId: 'AST-001',
          name: 'Warehouse 1',
          type: 'warehouse',
        },
      ];

      mockPrisma.registryAsset.findMany.mockResolvedValue(mockAssets);

      const result = await service.searchRegistry('asset', 'Warehouse');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Warehouse 1');
      expect(result[0].entityType).toBe('asset');
    });

    it('should search project registry', async () => {
      const mockProjects = [
        {
          id: 'prj-1',
          registryId: 'PRJ-001',
          name: 'Relief Project A',
          description: 'Emergency relief',
        },
      ];

      mockPrisma.registryProject.findMany.mockResolvedValue(mockProjects);

      const result = await service.searchRegistry('project', 'Relief');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Relief Project A');
      expect(result[0].entityType).toBe('project');
    });
  });
});
