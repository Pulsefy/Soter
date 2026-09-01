import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Campaign, CampaignStatus, Prisma } from '@prisma/client';
import { CampaignsService, CampaignExportRow } from './campaigns.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';

describe('CampaignsService', () => {
  let service: CampaignsService;
  let prismaMock: DeepMockProxy<PrismaService>;

  const now = new Date('2026-01-25T00:00:00.000Z');

  const baseCampaign: Campaign = {
    id: 'c1',
    name: 'Winter Relief 2026',
    status: CampaignStatus.draft,
    budget: new Prisma.Decimal('1000.00') as unknown as number,
    metadata: { region: 'Lagos' },
    ngoId: null,
    orgId: null,
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

    // Clean match validation instead of strict object equivalence structures
    expect(createArgs).toMatchObject({
      data: {
        name: 'Winter Relief 2026',
        status: CampaignStatus.draft,
        budget: 1000,
        metadata: { region: 'Lagos' },
        ngoId: null,
      },
    });

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

  describe('CSV export streaming', () => {
    // Mirrors the shape CampaignsService expects from a Prisma findMany call
    // with { _count: { claims }, balanceLedger } included.
    const makeRawCampaign = (
      id: string,
      overrides: Record<string, unknown> = {},
    ) => ({
      ...baseCampaign,
      id,
      _count: { claims: 2 },
      balanceLedger: [{ amount: 10 }, { amount: 5 }],
      ...overrides,
    });

    it('countExport(): counts using the same filters as the export', async () => {
      prismaMock.campaign.count.mockResolvedValue(42);

      const total = await service.countExport({
        status: CampaignStatus.active,
        orgId: 'org-1',
        ngoId: 'ngo-1',
      });

      expect(total).toBe(42);
      const args = prismaMock.campaign.count.mock.calls[0]?.[0];
      expect(args?.where).toMatchObject({
        deletedAt: null,
        status: CampaignStatus.active,
        orgId: 'org-1',
        ngoId: 'ngo-1',
      });
    });

    it('countExport(): rejects an invalid date filter', async () => {
      await expect(
        service.countExport({ from: 'not-a-date' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('streamExportRows(): pages through results with cursor-based pagination', async () => {
      // A full first page (matching the batch size) signals "there may be
      // more", so the generator issues a second request; a page shorter
      // than the batch size signals "that was the last page".
      const firstPage = Array.from({ length: 500 }, (_, i) =>
        makeRawCampaign(`c${i}`),
      );
      prismaMock.campaign.findMany
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce([makeRawCampaign('c500')]);

      const rows: CampaignExportRow[] = [];
      for await (const row of service.streamExportRows({})) {
        rows.push(row);
      }

      expect(rows).toHaveLength(501);
      expect(rows[0].totalClaims).toBe(2);
      expect(rows[0].totalDisbursed).toBe(15);

      // First page has no cursor; second page continues from the last row's id.
      const firstCallArgs = prismaMock.campaign.findMany.mock.calls[0]?.[0];
      const secondCallArgs = prismaMock.campaign.findMany.mock.calls[1]?.[0];
      expect(firstCallArgs?.cursor).toBeUndefined();
      expect(secondCallArgs?.cursor).toEqual({ id: 'c499' });
      expect(secondCallArgs?.skip).toBe(1);
    });

    it('streamExportRows(): never requests more than the batch size in a single query', async () => {
      prismaMock.campaign.findMany.mockResolvedValue([]);

      const rows: CampaignExportRow[] = [];
      for await (const row of service.streamExportRows({})) {
        rows.push(row);
      }

      for (const call of prismaMock.campaign.findMany.mock.calls) {
        expect(call[0]?.take).toBeLessThanOrEqual(500);
      }
    });

    it('streamExportRows(): does not fetch further pages than the caller consumes (non-buffering)', async () => {
      // Every page is "full" (500 rows), simulating a dataset far larger
      // than what the caller actually reads. A buffering implementation
      // (collect everything into an array, then return) would exhaust every
      // page before yielding a single row. The streaming implementation
      // must only issue the one query needed to satisfy what was consumed.
      const fullPage = Array.from({ length: 500 }, (_, i) =>
        makeRawCampaign(`c${i}`),
      );
      prismaMock.campaign.findMany.mockResolvedValue(fullPage);

      const rows: CampaignExportRow[] = [];
      for await (const row of service.streamExportRows({})) {
        rows.push(row);
        if (rows.length === 3) break;
      }

      expect(rows).toHaveLength(3);
      expect(prismaMock.campaign.findMany).toHaveBeenCalledTimes(1);
    });

    it('streamExportCsv(): yields the header first, then one escaped CSV line per row', async () => {
      prismaMock.campaign.findMany
        .mockResolvedValueOnce([
          makeRawCampaign('c1', { name: 'Has, a comma' }),
        ])
        .mockResolvedValueOnce([]);

      const chunks: string[] = [];
      for await (const chunk of service.streamExportCsv({})) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toBe(
        'id,name,status,budget,orgId,ngoId,createdAt,updatedAt,archivedAt,totalClaims,totalDisbursed\r\n',
      );
      expect(chunks[1]).toContain('"c1"');
      expect(chunks[1]).toContain('"Has, a comma"');
      expect(chunks[1].endsWith('\r\n')).toBe(true);
    });
  });
});
