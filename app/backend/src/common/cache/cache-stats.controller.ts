import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import {
  CacheInvalidationService,
  CacheStats,
} from '../services/cache-invalidation.service';
import { Roles } from '../../auth/roles.decorator';
import { AppRole } from '../../auth/app-role.enum';

@ApiTags('Cache Admin')
@Controller('admin/cache')
export class CacheStatsController {
  constructor(
    private readonly cacheInvalidationService: CacheInvalidationService,
  ) {}

  @Get('stats')
  @Roles(AppRole.admin)
  @ApiOperation({
    summary: 'Get cache statistics',
    description:
      'Returns real, Redis-backed cache metrics: total key count, per key-group key counts, and cumulative hit/miss/invalidation counters.',
  })
  @ApiOkResponse({
    description: 'Cache statistics retrieved successfully.',
    schema: {
      example: {
        totalKeys: 42,
        keyGroups: [
          {
            name: 'verification',
            pattern: 'cache:response:*verification*',
            count: 12,
          },
          {
            name: 'analytics',
            pattern: 'cache:response:*analytics*',
            count: 5,
          },
        ],
        hits: 1024,
        misses: 87,
        invalidations: 13,
      },
    },
  })
  async getStats(): Promise<CacheStats> {
    return this.cacheInvalidationService.getCacheStats();
  }
}
