import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AdminSearchService } from './admin-search.service';

describe('AdminSearchService', () => {
  const findMany = () => jest.fn();

  async function makeService(overrides?: Record<string, unknown>) {
    const prisma = {
      searchIndexEntry: {
        count: jest.fn(),
        findMany: findMany(),
      },
      campaign: { findMany: findMany() },
      claim: { findMany: findMany() },
      verificationSession: { findMany: findMany() },
      ...overrides,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSearchService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    return {
      service: module.get<AdminSearchService>(AdminSearchService),
      prisma,
    };
  }

  beforeEach(() => jest.clearAllMocks());

  describe('with a populated index', () => {
    it('searches the index and maps entries to results', async () => {
      const { service, prisma } = await makeService();
      prisma.searchIndexEntry.count.mockResolvedValue(12);
      prisma.searchIndexEntry.findMany.mockResolvedValue([
        {
          id: 'entry-1',
          entityType: 'campaign',
          entityId: 'campaign-1',
          orgId: 'org-1',
          label: 'Food Aid',
          status: 'active',
          searchText: 'food aid campaign-1',
        },
        {
          id: 'entry-2',
          entityType: 'claim',
          entityId: 'claim-1',
          orgId: 'org-1',
          label: 'Claim claim-1',
          status: 'approved',
          searchText: 'claim-1 recipient-77',
        },
      ]);

      const results = await service.search('food', undefined, 'org-1');

      expect(prisma.searchIndexEntry.findMany).toHaveBeenCalledWith({
        where: {
          orgId: 'org-1',
          searchText: { contains: 'food' },
        },
        orderBy: { entityType: 'asc' },
        take: 10,
      });
      expect(results).toEqual([
        {
          type: 'campaign',
          label: 'Food Aid',
          status: 'active',
          id: 'campaign-1',
        },
        {
          type: 'claim',
          label: 'Claim claim-1',
          status: 'approved',
          id: 'claim-1',
        },
      ]);
      expect(prisma.campaign.findMany).not.toHaveBeenCalled();
    });

    it('filters by entity type when provided', async () => {
      const { service, prisma } = await makeService();
      prisma.searchIndexEntry.count.mockResolvedValue(1);
      prisma.searchIndexEntry.findMany.mockResolvedValue([]);

      await service.search('food', 'verification', 'org-1');

      expect(prisma.searchIndexEntry.findMany).toHaveBeenCalledWith({
        where: {
          orgId: 'org-1',
          entityType: 'verification',
          searchText: { contains: 'food' },
        },
        orderBy: { entityType: 'asc' },
        take: 10,
      });
    });
  });

  describe('with an empty index', () => {
    it('falls back to live queries over backend entities', async () => {
      const { service, prisma } = await makeService();
      prisma.searchIndexEntry.count.mockResolvedValue(0);
      prisma.campaign.findMany.mockResolvedValue([
        { id: 'campaign-1', name: 'Food Aid', status: 'active' },
      ]);
      prisma.claim.findMany.mockResolvedValue([]);
      prisma.verificationSession.findMany.mockResolvedValue([]);

      const results = await service.search('food', undefined, 'org-1');

      expect(results).toEqual([
        {
          type: 'campaign',
          label: 'Food Aid',
          status: 'active',
          id: 'campaign-1',
        },
      ]);
      expect(prisma.campaign.findMany).toHaveBeenCalled();
      expect(prisma.searchIndexEntry.findMany).not.toHaveBeenCalled();
    });
  });

  it('returns an empty result set when no org is scoped', async () => {
    const { service, prisma } = await makeService();
    const results = await service.search('food', undefined, '');
    expect(results).toEqual([]);
    expect(prisma.searchIndexEntry.count).not.toHaveBeenCalled();
  });
});
