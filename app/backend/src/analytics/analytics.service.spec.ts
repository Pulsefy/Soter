import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../../cache/redis.service';
import { PrivacyService } from './privacy.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import {
  OnchainAdapter,
  ONCHAIN_ADAPTER_TOKEN,
} from '../onchain/onchain.adapter';
import { getCacheTTL } from '../common/config/cache.config';
import { GlobalStatsDto } from './dto';
import { ClaimStatus } from '@prisma/client';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';

describe('AnalyticsService', () => {
  const TOKEN = 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN';

  let service: AnalyticsService;
  let redisMock: DeepMockProxy<RedisService>;
  let metricsMock: DeepMockProxy<MetricsService>;
  let prismaMock: DeepMockProxy<PrismaService>;
  let onchainMock: DeepMockProxy<OnchainAdapter>;

  beforeEach(async () => {
    redisMock = mockDeep<RedisService>();
    metricsMock = mockDeep<MetricsService>();
    prismaMock = mockDeep<PrismaService>();
    onchainMock = mockDeep<OnchainAdapter>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        PrivacyService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
        { provide: MetricsService, useValue: metricsMock },
        { provide: ONCHAIN_ADAPTER_TOKEN, useValue: onchainMock },
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

  describe('getOnchainSummary()', () => {
    const onchainRead = {
      tokenAddress: TOKEN,
      aggregates: {
        totalCommitted: '500000000',
        totalClaimed: '2500000000',
        totalExpiredCancelled: '0',
      },
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
    };

    const cachedAggregates = {
      tokenAddress: TOKEN,
      totalLocked: '500000000',
      totalClaimed: '2500000000',
      totalExpiredCancelled: '0',
      fetchedAt: '2026-01-01T00:00:00.000Z',
      cached: false,
    };

    const summaryWith = (totalAidDisbursed: number): GlobalStatsDto => ({
      totalClaims: 0,
      totalPackages: 0,
      pendingReviews: 0,
      totalDisbursements: 0,
      totalAidDisbursed,
      totalRecipients: 0,
      activeCampaigns: 0,
      byToken: [],
      byRegion: [],
      timeSeries: [],
      computedAt: '2026-01-01T00:00:00.000Z',
    });

    it('reads aggregates from the adapter on a cache miss and reports no divergence', async () => {
      redisMock.get.mockResolvedValue(null);
      // 250 display units off-chain vs 2500000000 base units on-chain (7 decimals).
      prismaMock.claim.findMany.mockResolvedValue([
        {
          id: 'claim-1',
          amount: 250,
          recipientRef: 'recipient-1',
          status: ClaimStatus.disbursed,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          campaign: { metadata: { token: 'USDC', region: 'Lagos' } },
        } as never,
      ]);
      prismaMock.campaign.count.mockResolvedValue(1);
      prismaMock.claim.count.mockResolvedValue(1);
      prismaMock.aidPackage.count.mockResolvedValue(1);
      prismaMock.verificationRequest.count.mockResolvedValue(0);
      onchainMock.getAggregates.mockResolvedValue(onchainRead);

      const result = await service.getOnchainSummary({ token: TOKEN });

      expect(onchainMock.getAggregates).toHaveBeenCalledWith(TOKEN);
      expect(result.onchain).toMatchObject({
        tokenAddress: TOKEN,
        totalLocked: '500000000',
        totalClaimed: '2500000000',
        totalExpiredCancelled: '0',
        cached: false,
      });
      expect(result.summary.totalAidDisbursed).toBe(250);
      expect(result.divergence.hasDivergence).toBe(false);
      expect(result.divergence.fields[0]).toMatchObject({
        field: 'totalDisbursed',
        database: 250,
        onchain: 250,
        delta: 0,
        divergent: false,
      });
      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'onchain-aggregates',
        'miss',
      );
      expect(redisMock.set).toHaveBeenCalledWith(
        `analytics:onchain-aggregates:${TOKEN}`,
        expect.objectContaining({ totalClaimed: '2500000000' }),
        getCacheTTL().ONCHAIN_AGGREGATES,
      );
    });

    it('flags divergence when the database and on-chain totals disagree', async () => {
      jest.spyOn(service, 'getGlobalStats').mockResolvedValue(summaryWith(0));
      redisMock.get.mockResolvedValue(null);
      onchainMock.getAggregates.mockResolvedValue({
        ...onchainRead,
        aggregates: {
          totalCommitted: '0',
          totalClaimed: '5000000000',
          totalExpiredCancelled: '0',
        },
      });

      const result = await service.getOnchainSummary({ token: TOKEN });

      expect(result.divergence.hasDivergence).toBe(true);
      expect(result.divergence.fields[0].divergent).toBe(true);
      expect(result.divergence.fields[0].delta).toBe(-500);
    });

    it('serves aggregates from cache without calling the adapter', async () => {
      jest.spyOn(service, 'getGlobalStats').mockResolvedValue(summaryWith(0));
      redisMock.get.mockResolvedValue(cachedAggregates);

      const result = await service.getOnchainSummary({ token: TOKEN });

      expect(onchainMock.getAggregates).not.toHaveBeenCalled();
      expect(result.onchain.cached).toBe(true);
      expect(result.onchain.totalClaimed).toBe('2500000000');
      expect(redisMock.set).not.toHaveBeenCalled();
      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'onchain-aggregates',
        'hit',
      );
    });

    it('re-reads the adapter once the cached entry expires', async () => {
      jest.spyOn(service, 'getGlobalStats').mockResolvedValue(summaryWith(0));
      onchainMock.getAggregates.mockResolvedValue(onchainRead);

      // Fresh entry: served from cache, adapter not consulted.
      redisMock.get.mockResolvedValueOnce(cachedAggregates);
      const first = await service.getOnchainSummary({ token: TOKEN });
      expect(first.onchain.cached).toBe(true);
      expect(onchainMock.getAggregates).not.toHaveBeenCalled();

      // TTL elapses: Redis now misses, so the adapter is re-read and re-cached.
      redisMock.get.mockResolvedValue(null);
      const second = await service.getOnchainSummary({ token: TOKEN });
      expect(onchainMock.getAggregates).toHaveBeenCalledTimes(1);
      expect(second.onchain.cached).toBe(false);
      expect(redisMock.set).toHaveBeenCalledWith(
        `analytics:onchain-aggregates:${TOKEN}`,
        expect.any(Object),
        getCacheTTL().ONCHAIN_AGGREGATES,
      );
      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'onchain-aggregates',
        'miss',
      );
    });

    it('rejects a request without a token', async () => {
      await expect(service.getOnchainSummary({})).rejects.toThrow(
        'A token address is required to read on-chain aggregates.',
      );
      expect(onchainMock.getAggregates).not.toHaveBeenCalled();
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
});
