import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Campaign, CampaignStatus, Prisma } from '@prisma/client';
import { CampaignsService } from './campaigns.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { WebhooksService } from '../webhooks/webhooks.service';

describe('CampaignsService', () => {
  let service: CampaignsService;
  let prismaMock: DeepMockProxy<PrismaService>;
  const webhooksService = {
    enqueueEvent: jest.fn().mockResolvedValue(1),
  };

  const now = new Date('2026-01-25T00:00:00.000Z');

  const baseCampaign: Campaign = {
    id: 'c1',
    name: 'Winter Relief 2026',
    status: CampaignStatus.draft,
    budget: new Prisma.Decimal('1000.00'),
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

    const moduleRef = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WebhooksService, useValue: webhooksService },
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

    expect(prismaMock.campaign.update.mock.calls.length).toBe(0);
  });

  it('archive(): idempotent when already archived', async () => {
    prismaMock.campaign.findUnique.mockResolvedValue({
      ...baseCampaign,
      status: CampaignStatus.archived,
      archivedAt: now,
    });

    const result = await service.archive('c1');

    expect(result.alreadyArchived).toBe(true);
    expect(prismaMock.campaign.update.mock.calls.length).toBe(0);
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
    expect(result.deletedAt).not.toBeNull();
  });

  it('update(): emits campaign.completed when status transitions to completed', async () => {
    const existing: Campaign = {
      id: 'c1',
      name: 'A',
      status: CampaignStatus.active,
      budget: new Prisma.Decimal('10.00'),
      metadata: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const updated: Campaign = {
      ...existing,
      status: CampaignStatus.completed,
      updatedAt: new Date('2026-01-26T00:00:00.000Z'),
    };

    prismaMock.campaign.findUnique.mockResolvedValue(existing);
    prismaMock.campaign.update.mockResolvedValue(updated);

    await service.update('c1', { status: CampaignStatus.completed });

    expect(webhooksService.enqueueEvent).toHaveBeenCalledWith(
      'campaign.completed',
      expect.objectContaining({
        event: 'campaign.completed',
        campaign: expect.objectContaining({
          id: 'c1',
          status: CampaignStatus.completed,
        }),
        previousStatus: CampaignStatus.active,
      }),
    );
  });
});
