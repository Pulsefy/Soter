import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../../cache/redis.service';
import { PrivacyService } from './privacy.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import {
  OnchainAdapter,
  ONCHAIN_ADAPTER_TOKEN,
} from '../onchain/onchain.adapter';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let redisMock: DeepMockProxy<RedisService>;
  let metricsMock: DeepMockProxy<MetricsService>;
  let prismaMock: DeepMockProxy<PrismaService>;
  let onchainAdapterMock: DeepMockProxy<OnchainAdapter>;

  beforeEach(async () => {
    redisMock = mockDeep<RedisService>();
    metricsMock = mockDeep<MetricsService>();
    prismaMock = mockDeep<PrismaService>();
    onchainAdapterMock = mockDeep<OnchainAdapter>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        PrivacyService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
        { provide: MetricsService, useValue: metricsMock },
        { provide: ONCHAIN_ADAPTER_TOKEN, useValue: onchainAdapterMock },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  describe('getGlobalStats()', () => {
    it('returns cached value and records cache hit', async () => {
      const cached = { totalAidDisbursed: 100, computedAt: 'now' } as any;
      redisMock.get.mockResolvedValue(cached);

      const result = await service.getGlobalStats({});

      expect(result).toBe(cached);
      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'global-stats',
        'hit',
      );
      expect(prismaMock.claim.findMany).not.toHaveBeenCalled();
    });

    it('computes and caches on miss, records cache miss', async () => {
      redisMock.get.mockResolvedValue(null);
      prismaMock.claim.findMany.mockResolvedValue([]);
      prismaMock.campaign.count.mockResolvedValue(0);
      prismaMock.claim.count.mockResolvedValue(0);
      prismaMock.aidPackage.count.mockResolvedValue(0);
      prismaMock.verificationRequest.count.mockResolvedValue(0);

      await service.getGlobalStats({});

      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'global-stats',
        'miss',
      );
      expect(redisMock.set).toHaveBeenCalled();
    });

    it('returns dashboard summary card totals from database counts', async () => {
      redisMock.get.mockResolvedValue(null);
      prismaMock.claim.findMany.mockResolvedValue([]);
      prismaMock.campaign.count.mockResolvedValue(3);

      // Mock the four parallel count queries used by summary cards:
      // totalClaims, totalPackages, pendingReviews, totalDisbursements
      prismaMock.claim.count
        .mockResolvedValueOnce(42) // totalClaims
        .mockResolvedValueOnce(15); // totalDisbursements (disbursed claims)
      prismaMock.aidPackage.count.mockResolvedValue(18);
      prismaMock.verificationRequest.count.mockResolvedValue(7);

      const result = await service.getGlobalStats({});

      expect(result.totalClaims).toBe(42);
      expect(result.totalPackages).toBe(18);
      expect(result.pendingReviews).toBe(7);
      expect(result.totalDisbursements).toBe(15);
      expect(result.activeCampaigns).toBe(3);
    });
  });

  describe('getMapData()', () => {
    it('returns cached value and records cache hit', async () => {
      const cached = { points: [], computedAt: 'now' } as any;
      redisMock.get.mockResolvedValue(cached);

      const result = await service.getMapData({});

      expect(result).toBe(cached);
      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'map-data',
        'hit',
      );
    });

    it('computes and caches on miss, records cache miss', async () => {
      redisMock.get.mockResolvedValue(null);
      prismaMock.claim.findMany.mockResolvedValue([]);

      await service.getMapData({});

      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'map-data',
        'miss',
      );
      expect(redisMock.set).toHaveBeenCalled();
    });
  });

  describe('invalidateCache()', () => {
    it('deletes all analytics keys and increments invalidation counter', async () => {
      redisMock.delByPattern.mockResolvedValue(3);

      await service.invalidateCache('campaign_updated');

      expect(redisMock.delByPattern).toHaveBeenCalledWith('analytics:*');
      expect(
        metricsMock.incrementAnalyticsCacheInvalidation,
      ).toHaveBeenCalledWith('campaign_updated');
    });
  });

  describe('getContractAggregates()', () => {
    it('returns cached value and records cache hit', async () => {
      const cached = {
        aggregates: {
          totalCommitted: '5000000000',
          totalClaimed: '2000000000',
          totalExpiredCancelled: '500000000',
        },
        timestamp: '2026-03-30T12:30:00.000Z',
      } as any;
      redisMock.get.mockResolvedValue(cached);

      const result = await service.getContractAggregates({});

      expect(result).toBe(cached);
      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'contract-aggregates',
        'hit',
      );
      expect(onchainAdapterMock.getAidPackageCount).not.toHaveBeenCalled();
    });

    it('computes and caches on miss, records cache miss', async () => {
      redisMock.get.mockResolvedValue(null);
      prismaMock.aidPackage.findMany.mockResolvedValue([]);
      onchainAdapterMock.getAidPackageCount.mockResolvedValue({
        aggregates: {
          totalCommitted: '5000000000',
          totalClaimed: '2000000000',
          totalExpiredCancelled: '500000000',
        },
        timestamp: new Date(),
      });

      await service.getContractAggregates({});

      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'contract-aggregates',
        'miss',
      );
      expect(onchainAdapterMock.getAidPackageCount).toHaveBeenCalled();
      expect(redisMock.set).toHaveBeenCalled();
    });

    it('uses provided token parameter', async () => {
      redisMock.get.mockResolvedValue(null);
      prismaMock.aidPackage.findMany.mockResolvedValue([]);
      onchainAdapterMock.getAidPackageCount.mockResolvedValue({
        aggregates: {
          totalCommitted: '5000000000',
          totalClaimed: '2000000000',
          totalExpiredCancelled: '500000000',
        },
        timestamp: new Date(),
      });

      const token = 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN';
      await service.getContractAggregates({ token });

      expect(onchainAdapterMock.getAidPackageCount).toHaveBeenCalledWith({
        token,
      });
    });

    it('returns database totals and flags per-metric divergence', async () => {
      redisMock.get.mockResolvedValue(null);
      const token = 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN';
      onchainAdapterMock.getAidPackageCount.mockResolvedValue({
        aggregates: {
          totalCommitted: '1200',
          totalClaimed: '300',
          totalExpiredCancelled: '40',
        },
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
      });
      prismaMock.aidPackage.findMany.mockResolvedValue([
        {
          status: 'Active',
          totalAmount: 1200,
          campaign: { metadata: { tokenAddress: token } },
        },
        {
          status: 'Claimed',
          totalAmount: 250,
          campaign: { metadata: { token } },
        },
        {
          status: 'Cancelled',
          totalAmount: 40,
          campaign: { metadata: { token } },
        },
        {
          status: 'Claimed',
          totalAmount: 900,
          campaign: { metadata: { token: 'OTHER_TOKEN' } },
        },
      ] as any);

      const result = await service.getContractAggregates({ token });

      expect(result.databaseAggregates).toEqual({
        totalCommitted: '1200',
        totalClaimed: '250',
        totalExpiredCancelled: '40',
      });
      expect(result.databaseMatches).toEqual({
        totalCommitted: true,
        totalClaimed: false,
        totalExpiredCancelled: true,
      });
      expect(result.matchesDatabase).toBe(false);
    });
  });
});
