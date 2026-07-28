import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../cache/redis.service';

/**
 * Service for managing cache invalidation across the application.
 * Provides convenient methods to invalidate specific cache patterns.
 */
@Injectable()
export class CacheInvalidationService {
  private readonly logger = new Logger(CacheInvalidationService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * Invalidate all verification-related caches for a specific verification ID
   */
  async invalidateVerification(verificationId: string): Promise<void> {
    const patterns = [
      `cache:response:*verification*${verificationId}*`,
      `cache:response:*verification/${verificationId}*`,
      `cache:response:*claims/${verificationId}*`,
    ];

    for (const pattern of patterns) {
      const deleted = await this.redisService.delByPattern(pattern);
      if (deleted > 0) {
        this.logger.debug(
          `Invalidated ${deleted} verification cache entries for ID ${verificationId}`,
        );
      }
    }
  }

  /**
   * Invalidate all verification metrics caches
   */
  async invalidateVerificationMetrics(): Promise<void> {
    const deleted = await this.redisService.delByPattern(
      'cache:response:*verification*metrics*',
    );
    if (deleted > 0) {
      this.logger.debug(
        `Invalidated ${deleted} verification metrics cache entries`,
      );
    }
  }

  /**
   * Invalidate all caches for a specific user
   */
  async invalidateUserCaches(userId: string): Promise<void> {
    const patterns = [
      `cache:response:*user/${userId}*`,
      `cache:response:*userId=${userId}*`,
    ];

    for (const pattern of patterns) {
      const deleted = await this.redisService.delByPattern(pattern);
      if (deleted > 0) {
        this.logger.debug(
          `Invalidated ${deleted} user cache entries for user ${userId}`,
        );
      }
    }
  }

  /**
   * Invalidate all aid package caches for a specific package ID
   */
  async invalidateAidPackage(packageId: string): Promise<void> {
    const patterns = [
      `cache:response:*packages/${packageId}*`,
      `cache:response:*aid-escrow*${packageId}*`,
    ];

    for (const pattern of patterns) {
      const deleted = await this.redisService.delByPattern(pattern);
      if (deleted > 0) {
        this.logger.debug(
          `Invalidated ${deleted} aid package cache entries for ID ${packageId}`,
        );
      }
    }
  }

  /**
   * Invalidate all aid package statistics caches
   */
  async invalidateAidPackageStats(): Promise<void> {
    const deleted = await this.redisService.delByPattern(
      'cache:response:*aid-escrow*stats*',
    );
    if (deleted > 0) {
      this.logger.debug(
        `Invalidated ${deleted} aid package stats cache entries`,
      );
    }
  }

  /**
   * Invalidate transaction status caches for a specific transaction hash
   */
  async invalidateTransaction(txHash: string): Promise<void> {
    const patterns = [
      `cache:response:*transactions/${txHash}*`,
      `cache:response:*transaction*${txHash}*`,
    ];

    for (const pattern of patterns) {
      const deleted = await this.redisService.delByPattern(pattern);
      if (deleted > 0) {
        this.logger.debug(
          `Invalidated ${deleted} transaction cache entries for hash ${txHash}`,
        );
      }
    }
  }

  /**
   * Invalidate all analytics caches
   */
  async invalidateAnalytics(): Promise<void> {
    const deleted = await this.redisService.delByPattern(
      'cache:response:*analytics*',
    );
    if (deleted > 0) {
      this.logger.debug(`Invalidated ${deleted} analytics cache entries`);
    }
  }

  /**
   * Invalidate all response caches (nuclear option)
   */
  async invalidateAll(): Promise<void> {
    const deleted = await this.redisService.delByPattern('cache:response:*');
    this.logger.warn(`Invalidated ALL cache entries (${deleted} keys)`);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalKeys: number;
    patterns: { pattern: string; count: number }[];
  } {
    // This would require implementing a SCAN-based key counter
    // For now, return a placeholder
    return {
      totalKeys: 0,
      patterns: [],
    };
  }
}
