import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityLinkingService } from './entity-linking.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EntityLinkingService', () => {
  let service: EntityLinkingService;
  let prisma: PrismaService;

  const mockPrisma = {
    entityLink: {
      create: jest.fn(),
      findMany: jest.fn(),
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntityLinkingService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<EntityLinkingService>(EntityLinkingService);
    prisma = module.get<PrismaService>(PrismaService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('linkEntity', () => {
    it('should create entity link with valid data', async () => {
      const dto = {
        sourceType: 'claim' as const,
        sourceId: 'claim-123',
        extractedName: 'Test Organization',
        entityType: 'organization' as const,
        confidenceScore: 0.95,
        matchMethod: 'exact',
      };

      mockPrisma.entityLink.create.mockResolvedValue({
        id: 'link-1',
        ...dto,
        organizationId: 'org-1',
        locationId: null,
        assetId: null,
        projectId: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.linkEntity(dto);

      expect(result).toBeDefined();
      expect(result.sourceType).toBe('claim');
      expect(result.extractedName).toBe('Test Organization');
      expect(result.confidenceScore).toBe(0.95);
      expect(prisma.entityLink.create).toHaveBeenCalled();
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

  describe('reviewLink', () => {
    it('should update link review status', async () => {
      const mockUpdated = {
        id: 'link-1',
        sourceType: 'claim',
        sourceId: 'claim-123',
        extractedName: 'Test',
        entityType: 'organization',
        confidenceScore: 0.9,
        reviewedBy: 'user-1',
        reviewedAt: new Date(),
        isActive: false,
        reviewNotes: 'Incorrect match',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.entityLink.update.mockResolvedValue(mockUpdated);

      const result = await service.reviewLink('link-1', {
        reviewedBy: 'user-1',
        isActive: false,
        reviewNotes: 'Incorrect match',
      });

      expect(result.isActive).toBe(false);
      expect(result.reviewedBy).toBe('user-1');
      expect(prisma.entityLink.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: expect.objectContaining({
          reviewedBy: 'user-1',
          isActive: false,
          reviewNotes: 'Incorrect match',
        }),
      });
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
