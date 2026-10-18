import { Test, TestingModule } from '@nestjs/testing';
import { CacheInvalidationService } from './cache-invalidation.service';
import { RedisService } from '../../../cache/redis.service';
import { MetricsService } from '../../observability/metrics/metrics.service';

describe('CacheInvalidationService', () => {
  let service: CacheInvalidationService;
  let redisService: jest.Mocked<RedisService>;
  let metricsService: jest.Mocked<MetricsService>;

  const mockRedis = {
    delByPattern: jest.fn(),
    countKeysByPattern: jest.fn(),
  };

  const mockMetrics = {
    incrementCacheInvalidation: jest.fn(),
    setCacheKeyGroupSize: jest.fn(),
    getCacheHitsTotal: jest.fn(),
    getCacheMissesTotal: jest.fn(),
    getCacheInvalidationsTotal: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheInvalidationService,
        { provide: RedisService, useValue: mockRedis },
        { provide: MetricsService, useValue: mockMetrics },
      ],
    }).compile();

    service = module.get<CacheInvalidationService>(CacheInvalidationService);
    redisService = module.get(RedisService);
    metricsService = module.get(MetricsService);
  });

  describe('invalidation metrics', () => {
    it('records an invalidation metric per key group only when keys were actually deleted', async () => {
      redisService.delByPattern.mockResolvedValueOnce(3); // *verification*<id>*
      redisService.delByPattern.mockResolvedValueOnce(0); // *verification/<id>*
      redisService.delByPattern.mockResolvedValueOnce(2); // *claims/<id>*

      await service.invalidateVerification('verif-1');

      expect(redisService.delByPattern).toHaveBeenCalledTimes(3);
      // Only the two patterns that deleted keys should increment the metric.
      expect(metricsService.incrementCacheInvalidation).toHaveBeenCalledTimes(
        2,
      );
      expect(metricsService.incrementCacheInvalidation).toHaveBeenCalledWith(
        'verification',
      );
    });

    it('does not record an invalidation metric when nothing was deleted', async () => {
      redisService.delByPattern.mockResolvedValue(0);

      await service.invalidateUserCaches('user-1');

      expect(metricsService.incrementCacheInvalidation).not.toHaveBeenCalled();
    });

    it('records an "all" invalidation metric for the nuclear option', async () => {
      redisService.delByPattern.mockResolvedValue(10);

      await service.invalidateAll();

      expect(redisService.delByPattern).toHaveBeenCalledWith(
        'cache:response:*',
      );
      expect(metricsService.incrementCacheInvalidation).toHaveBeenCalledWith(
        'all',
      );
    });

    it('labels analytics invalidations with the analytics key group', async () => {
      redisService.delByPattern.mockResolvedValue(1);

      await service.invalidateAnalytics();

      expect(metricsService.incrementCacheInvalidation).toHaveBeenCalledWith(
        'analytics',
      );
    });
  });

  describe('getCacheStats', () => {
    it('returns real, Redis-backed key counts per key group and cumulative counters', async () => {
      redisService.countKeysByPattern.mockImplementation((pattern: string) => {
        if (pattern === 'cache:response:*') return Promise.resolve(42);
        if (pattern.includes('verification')) return Promise.resolve(12);
        if (pattern.includes('user')) return Promise.resolve(5);
        return Promise.resolve(0);
      });
      metricsService.getCacheHitsTotal.mockResolvedValue(1024);
      metricsService.getCacheMissesTotal.mockResolvedValue(87);
      metricsService.getCacheInvalidationsTotal.mockResolvedValue(13);

      const stats = await service.getCacheStats();

      expect(stats.totalKeys).toBe(42);
      expect(stats.hits).toBe(1024);
      expect(stats.misses).toBe(87);
      expect(stats.invalidations).toBe(13);

      const verificationGroup = stats.keyGroups.find(
        g => g.name === 'verification',
      );
      expect(verificationGroup).toBeDefined();
      expect(verificationGroup?.count).toBe(12);

      const userGroup = stats.keyGroups.find(g => g.name === 'user');
      expect(userGroup?.count).toBe(5);

      // No placeholders left: every group must reflect a real SCAN count.
      expect(stats.keyGroups.length).toBeGreaterThan(0);
      expect(redisService.countKeysByPattern).toHaveBeenCalledWith(
        'cache:response:*',
      );
    });

    it('publishes Redis key health gauges per key group and overall total', async () => {
      redisService.countKeysByPattern.mockResolvedValue(7);
      metricsService.getCacheHitsTotal.mockResolvedValue(0);
      metricsService.getCacheMissesTotal.mockResolvedValue(0);
      metricsService.getCacheInvalidationsTotal.mockResolvedValue(0);

      const stats = await service.getCacheStats();

      expect(metricsService.setCacheKeyGroupSize).toHaveBeenCalledWith(
        'total',
        7,
      );
      for (const group of stats.keyGroups) {
        expect(metricsService.setCacheKeyGroupSize).toHaveBeenCalledWith(
          group.name,
          group.count,
        );
      }
    });

    it('returns zero counts when Redis has no matching keys, without placeholders', async () => {
      redisService.countKeysByPattern.mockResolvedValue(0);
      metricsService.getCacheHitsTotal.mockResolvedValue(0);
      metricsService.getCacheMissesTotal.mockResolvedValue(0);
      metricsService.getCacheInvalidationsTotal.mockResolvedValue(0);

      const stats = await service.getCacheStats();

      expect(stats.totalKeys).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.invalidations).toBe(0);
      expect(stats.keyGroups.every(g => g.count === 0)).toBe(true);
    });
  });
});
