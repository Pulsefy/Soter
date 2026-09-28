import { Test, TestingModule } from '@nestjs/testing';
import { CacheStatsController } from './cache-stats.controller';
import { CacheInvalidationService } from '../services/cache-invalidation.service';

describe('CacheStatsController', () => {
  let controller: CacheStatsController;
  const mockCacheInvalidationService = {
    getCacheStats: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CacheStatsController],
      providers: [
        {
          provide: CacheInvalidationService,
          useValue: mockCacheInvalidationService,
        },
      ],
    }).compile();

    controller = module.get<CacheStatsController>(CacheStatsController);
  });

  it('returns the real cache stats payload from the service, not a placeholder', async () => {
    const stats = {
      totalKeys: 42,
      keyGroups: [
        {
          name: 'verification',
          pattern: 'cache:response:*verification*',
          count: 12,
        },
      ],
      hits: 1024,
      misses: 87,
      invalidations: 13,
    };
    mockCacheInvalidationService.getCacheStats.mockResolvedValue(stats);

    const result = await controller.getStats();

    expect(result).toEqual(stats);
    expect(result.totalKeys).not.toBe(0);
    expect(mockCacheInvalidationService.getCacheStats).toHaveBeenCalledTimes(1);
  });
});
