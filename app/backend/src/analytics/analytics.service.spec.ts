import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../../cache/redis.service';
import { PrivacyService } from './privacy.service';
import { MetricsService } from '../observability/metrics/metrics.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let redisMock: DeepMockProxy<RedisService>;
  let metricsMock: DeepMockProxy<MetricsService>;
  let prismaMock: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    redisMock = mockDeep<RedisService>();
    metricsMock = mockDeep<MetricsService>();
    prismaMock = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        PrivacyService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
        { provide: MetricsService, useValue: metricsMock },
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

      await service.getGlobalStats({});

      expect(metricsMock.recordAnalyticsCacheResult).toHaveBeenCalledWith(
        'global-stats',
        'miss',
      );
      expect(redisMock.set).toHaveBeenCalled();
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
});
