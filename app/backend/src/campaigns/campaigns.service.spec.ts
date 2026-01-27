/* eslint-disable 
  @typescript-eslint/no-unsafe-assignment
*/
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Campaign, CampaignStatus, Prisma } from '@prisma/client';
import { CampaignsService } from './campaigns.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';

describe('CampaignsService', () => {
  let service: CampaignsService;
  let prismaMock: DeepMockProxy<PrismaService>;

  const now = new Date('2026-01-25T00:00:00.000Z');

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock = mockDeep<PrismaService>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = moduleRef.get(CampaignsService);
  });

  it('create(): creates a campaign with Decimal budget', async () => {
    const mockCreated: Campaign = {
      id: 'c1',
      name: 'Winter Relief 2026',
      status: CampaignStatus.draft,
      budget: new Prisma.Decimal('1000.00'),
      metadata: { region: 'Lagos' } as Prisma.JsonValue,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    prismaMock.campaign.create.mockResolvedValue(mockCreated);

    const created = await service.create({
      name: 'Winter Relief 2026',
      budget: 1000,
      metadata: { region: 'Lagos' },
      status: CampaignStatus.draft,
    });

    // Avoid @typescript-eslint/unbound-method: inspect calls instead of asserting on method ref
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

    expect(created).toEqual(mockCreated);
    expect(created.id).toBe('c1');
  });

  it('findAll(): excludes archived campaigns by default', async () => {
    prismaMock.campaign.findMany.mockResolvedValue([]);

    await service.findAll(false);

    const args = prismaMock.campaign.findMany.mock.calls[0]?.[0];
    expect(args).toEqual(
      expect.objectContaining({
        where: { archivedAt: null },
      }),
    );
  });

  it('findAll(true): includes archived campaigns', async () => {
    prismaMock.campaign.findMany.mockResolvedValue([]);

    await service.findAll(true);

    const args = prismaMock.campaign.findMany.mock.calls[0]?.[0];
    expect(args).toEqual(
      expect.objectContaining({
        where: undefined,
      }),
    );
  });

  it('findOne(): throws NotFoundException when missing', async () => {
    prismaMock.campaign.findUnique.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const args = prismaMock.campaign.findUnique.mock.calls[0]?.[0];
    expect(args).toEqual(
      expect.objectContaining({
        where: { id: 'missing' },
      }),
    );
  });

  it('update(): throws NotFoundException if campaign does not exist', async () => {
    prismaMock.campaign.findUnique.mockResolvedValue(null);

    await expect(
      service.update('missing', { name: 'New Name' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prismaMock.campaign.update.mock.calls.length).toBe(0);
  });

  it('archive(): idempotent when already archived (does not call update)', async () => {
    const alreadyArchived: Campaign = {
      id: 'c1',
      name: 'A',
      status: CampaignStatus.archived,
      budget: new Prisma.Decimal('10.00'),
      metadata: null,
      archivedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    prismaMock.campaign.findUnique.mockResolvedValue(alreadyArchived);

    const result = await service.archive('c1');

    expect(result.alreadyArchived).toBe(true);
    expect(prismaMock.campaign.update.mock.calls.length).toBe(0);

    const args = prismaMock.campaign.findUnique.mock.calls[0]?.[0];
    expect(args).toEqual(
      expect.objectContaining({
        where: { id: 'c1' },
      }),
    );
  });
});
