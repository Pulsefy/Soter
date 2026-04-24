import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Campaign, CampaignStatus, Prisma } from '@prisma/client';
import { CampaignsService } from './campaigns.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { AnalyticsService } from '../analytics/analytics.service';

describe('CampaignsService', () => {
  let service: CampaignsService;
  let prismaMock: DeepMockProxy<PrismaService>;
  let analyticsServiceMock: {
    invalidateAnalyticsCache: jest.Mock;
  };

  const now = new Date('2026-01-25T00:00:00.000Z');

  const baseCampaign: Campaign = {
    id: 'c1',
    name: 'Winter Relief 2026',
    status: CampaignStatus.draft,
    budget: 1000,
    metadata: { region: 'Lagos' } as Prisma.JsonValue,
    ngoId: null,
    archivedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    prismaMock = mockDeep<PrismaService>();
    analyticsServiceMock = {
      invalidateAnalyticsCache: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AnalyticsService, useValue: analyticsServiceMock },
      ],
    }).compile();

    service = moduleRef.get(CampaignsService);
  });

  it('create(): creates a campaign with Decimal budget', async () => {
    prismaMock.campaign.create.mockResolvedValue(baseCampaign);

    const created = await service.create({
      name: 'Winter Relief 2026',
      budget: 1000,
      metadata: { region: 'Lagos' },
      status: CampaignStatus.draft,
    });

    const createArgs = prismaMock.campaign.create.mock.calls[0]?.[0];

    expect(createArgs).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Winter Relief 2026',
          status: CampaignStatus.draft,
          budget: expect.any(Number),
        }),
      }),
    );

    expect(analyticsServiceMock.invalidateAnalyticsCache).toHaveBeenCalledWith(
      'campaign created',
    );
    expect(created).toEqual(baseCampaign);
  });

  it('create(): attaches ngoId when provided', async () => {
    prismaMock.campaign.create.mockResolvedValue({
      ...baseCampaign,
      ngoId: 'ngo-1',
    });

    await service.create({ name: 'Test', budget: 100 }, 'ngo-1');

    const createArgs = prismaMock.campaign.create.mock.calls[0]?.[0];

    expect(createArgs?.data).toMatchObject({ ngoId: 'ngo-1' });
    expect(analyticsServiceMock.invalidateAnalyticsCache).toHaveBeenCalledWith(
      'campaign created',
    );
  });

  it('findAll(): excludes archived and deleted campaigns by default', async () => {
    prismaMock.campaign.findMany.mockResolvedValue([]);

    await service.findAll(false);

    const args = prismaMock.campaign.findMany.mock.calls[0]?.[0];

    expect(args?.where).toMatchObject({ archivedAt: null, deletedAt: null });
  });

  it('findAll(): scopes by ngoId when provided', async () => {
    prismaMock.campaign.findMany.mockResolvedValue([]);

    await service.findAll(false, 'ngo-42');

    const args = prismaMock.campaign.findMany.mock.calls[0]?.[0];

    expect(args?.where).toMatchObject({ ngoId: 'ngo-42' });
  });

  it('findAll(true): includes archived campaigns', async () => {
    prismaMock.campaign.findMany.mockResolvedValue([]);

    await service.findAll(true);

    const args = prismaMock.campaign.findMany.mock.calls[0]?.[0];

    expect(args?.where).not.toHaveProperty('archivedAt');
  });

  it('findOne(): throws NotFoundException when missing', async () => {
    prismaMock.campaign.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('findOne(): throws NotFoundException when soft-deleted', async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      ...baseCampaign,
      deletedAt: now,
    });

    await expect(service.findOne('c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update(): throws NotFoundException if campaign does not exist', async () => {
    prismaMock.campaign.findUnique.mockResolvedValue(null);

    await expect(
      service.update('missing', { name: 'New Name' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prismaMock.campaign.update).not.toHaveBeenCalled();
    expect(
      analyticsServiceMock.invalidateAnalyticsCache,
    ).not.toHaveBeenCalled();
  });

  it('archive(): idempotent when already archived', async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      ...baseCampaign,
      status: CampaignStatus.archived,
      archivedAt: now,
    });

    const result = await service.archive('c1');

    expect(result.alreadyArchived).toBe(true);
    expect(prismaMock.campaign.update).not.toHaveBeenCalled();
    expect(
      analyticsServiceMock.invalidateAnalyticsCache,
    ).not.toHaveBeenCalled();
  });

  it('softDelete(): sets deletedAt on the campaign', async () => {
    prismaMock.campaign.findUnique.mockResolvedValue(baseCampaign);
    prismaMock.campaign.update.mockResolvedValue({
      ...baseCampaign,
      deletedAt: now,
    });

    const result = await service.softDelete('c1');

    const updateArgs = prismaMock.campaign.update.mock.calls[0]?.[0];

    expect(updateArgs?.data).toMatchObject({ deletedAt: expect.any(Date) });
    expect(analyticsServiceMock.invalidateAnalyticsCache).toHaveBeenCalledWith(
      'campaign deleted',
    );
    expect(result.deletedAt).not.toBeNull();
  });
});
