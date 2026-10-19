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
      redisMock.get.mockResolved(cached);

      const result = await service.getGlobalStats({});

      expect(result).toBe(cached);
      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'global-stats',
        'hit',
      );
      expect(prismaMock.claim.findMany).not.toHaveBeenCalled();
    });

    it('computes and caches on miss, records cache miss', async () => {
      redisMock.get.mockResolved(null);
      prismaMock.claim.findMany.mockResolved([]);
      prismaMock.campaign.count.mockResolved(0);
      prismaMock.claim.count.mockResolved(0);
      prismaMock.aidPackage.count.mockResolved(0);
      prismaMock.verificationRequest.count.mockResolved(0);

      await service.getGlobalStats({});

      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'global-stats',
        'miss',
      );
      expect(redisMock.set).toHaveBeenCalled();
    });

    it('returns dashboard summary card totals from database counts', async () => {
      redisMock.get.mockResolved(null);
      prismaMock.claim.findMany.mockResolved([]);
      prismaMock.campaign.count.mockResolved(3);

      // Mock the four parallel count queries used by summary cards:
      // totalClaims, totalPackages, pendingReviews, totalDisbursements
      prismaMock.claim.count
        .mockResolvedOnce(42) // totalClaims
        .mockResolvedOnce(15); // totalDisbursements (disbursed claims)
      prismaMock.aidPackage.count.mockResolved(18);
      prismaMock.verificationRequest.count.mockResolved(7);

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
      redisMock.get.mockResolved(cached);

      const result = await service.getMapData({});

      expect(result).toBe(cached);
      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'map-data',
        'hit',
      );
    });

    it('computes and caches on miss, records cache miss', async () => {
      redisMock.get.mockResolved(null);
      prismaMock.claim.findMany.mockResolved([]);

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
      redisMock.delByPattern.mockResolved(3);

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
      redisMock.get.mockResolved(cached);

      const result = await service.getContractAggregates({});

      expect(result).toBe(cached);
      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'contract-aggregates',
        'hit',
      );
      expect(onchainAdapterMock.getAidPackageCount).not.toHaveBeenCalled();
    });

    it('computes and caches on miss, records cache miss', async () => {
      redisMock.get.mockResolved(null);
      onchainAdapterMock.getAidPackageCount.mockResolved({
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
      redisMock.get.mockResolved(null);
      onchainAdapterMock.getAidPackageCount.mockResolved({
        aggregates: {
          totalCommitted: '5000000000',
          totalClaimed: '2000000000',
          totalExpiredCancelled: '500000000',
        },
        timestamp: new Date(),
      });

      const token = 'GATEMHCCkCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN';
      await service.getContractAggregates({ token });

      expect(onchainAdapterMock.getAidPackageCount).toHaveBeenCalledWith({
        token,
      });
    });
  });

  describe('getVerificationThroughput()', () => {
    const window = {
      from: '2026-03-30T00:00:00.000Z',
      to: '2026-03-30T23:59:59.999Z',
    };

    it('returns cached value and records cache hit', async () => {
      const cached = {
        window,
        claimsProcessed: 10,
        claimsPerHour: 10,
        averageTimeToDecisionMs: 1200,
        distribution: { pass: 6, review: 3, reject: 1 },
        computedAt: '2026-03-30T23:00:00.000Z',
      } as any;
      redisMock.get.mockResolved(cached);

      const result = await service.getVerificationThroughput(window);

      expect(result).toBe(cached);
      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'verification-throughput',
        'hit',
      );
      expect(prismaMock.decisionAudit.findMany).not.toHaveBeenCalled();
    });

    it('returns zero aggregates for an empty window', async () => {
      redisMock.get.mockResolved(null);
      prismaMock.decisionAudit.findMany.mockResolved([]);

      const result = await service.getVerificationThroughput(window);

      expect(result.claimsProcessed).toBe(0);
      expect(result.claimsPerHour).toBe(0);
      expect(result.averageTimeToDecisionMs).toBe(0);
      expect(result.distribution).toEqual({
        pass: 0,
        review: 0,
        reject: 0,
      });
      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'verification-throughput',
        'miss',
      );
      expect(redisMock.set).toHaveBeenCalled();
    });

    it('aggregates a representative mix of outcomes', async () => {
      redisMock.get.mockResolved(null);
      const base = new Date('2026-03-30T00:00:00.000Z').getTime();
      prismaMock.decisionAudit.findMany.mockResolved([
        {
          outcome: 'PASS',
          decidedAt: new Date(base + 1000),
          createdAt: new Date(base),
        },
        {
          outcome: 'PASS',
          decidedAt: new Date(base + 2000),
          createdAt: new Date(base),
        },
        {
          outcome: 'REVIEW',
          decidedAt: new Date(base + 3000),
          createdAt: new Date(base),
        },
        {
          outcome: 'REJECT',
          decidedAt: new Date(base + 4000),
          createdAt: new Date(base),
        },
      ] as any);

      const result = await service.getVerificationThroughput(window);

      expect(result.claimsProcessed).toBe(4);
      expect(result.distribution).toEqual({
        pass: 2,
        review: 1,
        reject: 1,
      });
      // Average of 1000, 2000, 3000, 4000 ms => 2500 ms.
      expect(result.averageTimeToDecisionMs).toBe(2500);
      // 24-hour window with 4 claims => ~0.17 claims/hour.
      expect(result.claimsPerHour).toBeCloseTo(4 / 24, 5);
      expect(redisMock.set).toHaveBeenCalled();
    });

    it('queries only the requested window', async () => {
      redisMock.get.mockResolved(null);
      prismaMock.decisionAudit.findMany.mockResolved([]);

      await service.getVerificationThroughput(window);

      expect(prismaMock.decisionAudit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            decidedAt: {
              gte: new Date(window.from),
              lte: new Date(window.to),
            },
          }),
        }),
      );
    });
  });
});
