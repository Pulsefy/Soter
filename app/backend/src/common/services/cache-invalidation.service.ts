import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../cache/redis.service';
import { MetricsService } from '../../observability/metrics/metrics.service';

export interface CacheKeyGroupStats {
  name: string;
  pattern: string;
  count: number;
}

export interface CacheStats {
  totalKeys: number;
  keyGroups: CacheKeyGroupStats[];
  hits: number;
  misses: number;
  invalidations: number;
}

/**
 * Service for managing cache invalidation across the application.
 * Provides convenient methods to invalidate specific cache patterns.
 */
@Injectable()
export class CacheInvalidationService {
  private readonly logger = new Logger(CacheInvalidationService.name);

  /**
   * Logical cache key groups, used both for invalidation and for
   * reporting real, Redis-backed key counts per domain in getCacheStats().
   * Patterns are not mutually exclusive by design (e.g. a verification
   * claim may also match the "claims" wildcard elsewhere), so key-group
   * counts should be read as coverage per domain, not a strict partition.
   */
  private readonly keyGroups: { name: string; pattern: string }[] = [
    { name: 'verification', pattern: 'cache:response:*verification*' },
    { name: 'user', pattern: 'cache:response:*user*' },
    { name: 'aid-package', pattern: 'cache:response:*packages*' },
    { name: 'aid-escrow', pattern: 'cache:response:*aid-escrow*' },
    { name: 'transaction', pattern: 'cache:response:*transaction*' },
    { name: 'analytics', pattern: 'cache:response:*analytics*' },
  ];

  private readonly allResponsesPattern = 'cache:response:*';

  constructor(
    private readonly redisService: RedisService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Delete all keys matching the given patterns and record an invalidation
   * metric under `keyGroup` for every pattern that actually deleted a key.
   */
  private async invalidatePatterns(
    keyGroup: string,
    patterns: string[],
  ): Promise<number> {
    let totalDeleted = 0;
    for (const pattern of patterns) {
      const deleted = await this.redisService.delByPattern(pattern);
      if (deleted > 0) {
        totalDeleted += deleted;
        this.metricsService.incrementCacheInvalidation(keyGroup);
        this.logger.debug(
          `Invalidated ${deleted} ${keyGroup} cache entries (pattern: ${pattern})`,
        );
      }
    }
    return totalDeleted;
  }

  /**
   * Invalidate all verification-related caches for a specific verification ID
   */
  async invalidateVerification(verificationId: string): Promise<void> {
    await this.invalidatePatterns('verification', [
      `cache:response:*verification*${verificationId}*`,
      `cache:response:*verification/${verificationId}*`,
      `cache:response:*claims/${verificationId}*`,
    ]);
  }

  /**
   * Invalidate all verification metrics caches
   */
  async invalidateVerificationMetrics(): Promise<void> {
    await this.invalidatePatterns('verification', [
      'cache:response:*verification*metrics*',
    ]);
  }

  /**
   * Invalidate all caches for a specific user
   */
  async invalidateUserCaches(userId: string): Promise<void> {
    await this.invalidatePatterns('user', [
      `cache:response:*user/${userId}*`,
      `cache:response:*userId=${userId}*`,
    ]);
  }

  /**
   * Invalidate all aid package caches for a specific package ID
   */
  async invalidateAidPackage(packageId: string): Promise<void> {
    await this.invalidatePatterns('aid-package', [
      `cache:response:*packages/${packageId}*`,
      `cache:response:*aid-escrow*${packageId}*`,
    ]);
  }

  /**
   * Invalidate all aid package statistics caches
   */
  async invalidateAidPackageStats(): Promise<void> {
    await this.invalidatePatterns('aid-package', [
      'cache:response:*aid-escrow*stats*',
    ]);
  }

  /**
   * Invalidate transaction status caches for a specific transaction hash
   */
  async invalidateTransaction(txHash: string): Promise<void> {
    await this.invalidatePatterns('transaction', [
      `cache:response:*transactions/${txHash}*`,
      `cache:response:*transaction*${txHash}*`,
    ]);
  }

  /**
   * Invalidate all analytics caches
   */
  async invalidateAnalytics(): Promise<void> {
    await this.invalidatePatterns('analytics', ['cache:response:*analytics*']);
  }

  /**
   * Invalidate all response caches (nuclear option)
   */
  async invalidateAll(): Promise<void> {
    const deleted = await this.redisService.delByPattern(
      this.allResponsesPattern,
    );
    this.metricsService.incrementCacheInvalidation('all');
    this.logger.warn(`Invalidated ALL cache entries (${deleted} keys)`);
  }

  /**
   * Get real, Redis-backed cache statistics: total key count, per key-group
   * key counts (Redis key health), and cumulative hit/miss/invalidation
   * counters collected from the response cache.
   */
  async getCacheStats(): Promise<CacheStats> {
    const [totalKeys, keyGroups, hits, misses, invalidations] =
      await Promise.all([
        this.redisService.countKeysByPattern(this.allResponsesPattern),
        Promise.all(
          this.keyGroups.map(async group => ({
            name: group.name,
            pattern: group.pattern,
            count: await this.redisService.countKeysByPattern(group.pattern),
          })),
        ),
        this.metricsService.getCacheHitsTotal(),
        this.metricsService.getCacheMissesTotal(),
        this.metricsService.getCacheInvalidationsTotal(),
      ]);

    this.metricsService.setCacheKeyGroupSize('total', totalKeys);
    for (const group of keyGroups) {
      this.metricsService.setCacheKeyGroupSize(group.name, group.count);
    }

    return { totalKeys, keyGroups, hits, misses, invalidations };
  }
}
