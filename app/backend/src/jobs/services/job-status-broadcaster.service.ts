/**
 * Job Status Broadcaster Service
 * Manages Redis Pub/Sub channels for job status event streaming
 * Handles event publishing and subscription management with reconnect support
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { JobStatusEvent } from '../dtos/job-status-event.dto';

@Injectable()
export class JobStatusBroadcaster {
  private readonly logger = new Logger(JobStatusBroadcaster.name);

  /**
   * Redis channel prefix for job status events
   */
  private readonly CHANNEL_PREFIX = 'job_status:';

  /**
   * Redis key for storing recent job status history
   * Used for handling reconnects and missed updates
   */
  private readonly HISTORY_KEY = 'job_status_history:';

  /**
   * Redis key for storing active subscriptions metadata
   */
  private readonly SUBSCRIPTIONS_KEY = 'job_subscriptions:';

  /**
   * Maximum number of historical events to keep per job
   */
  private readonly MAX_HISTORY_SIZE = 100;

  /**
   * TTL for historical events (24 hours)
   */
  private readonly HISTORY_TTL = 86400;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Get the channel name for a job
   * @param jobId - The job ID
   * @returns Channel name
   */
  private getJobChannel(jobId: string): string {
    return `${this.CHANNEL_PREFIX}${jobId}`;
  }

  /**
   * Get the broadcast channel for all job updates
   * @returns Broadcast channel name
   */
  private getBroadcastChannel(): string {
    return `${this.CHANNEL_PREFIX}broadcast`;
  }

  /**
   * Get the history key for a job
   * @param jobId - The job ID
   * @returns History key
   */
  private getHistoryKey(jobId: string): string {
    return `${this.HISTORY_KEY}${jobId}`;
  }

  /**
   * Broadcast a job status update to subscribers
   * @param event - The job status event
   */
  async broadcastJobStatus(event: JobStatusEvent): Promise<void> {
    const correlationId = event.correlationId || uuidv4();

    try {
      const eventData = JSON.stringify(event);

      // Publish to job-specific channel
      const jobChannel = this.getJobChannel(event.job.id);
      await this.redis.publish(jobChannel, eventData);

      // Publish to broadcast channel (for all job updates)
      const broadcastChannel = this.getBroadcastChannel();
      await this.redis.publish(broadcastChannel, eventData);

      // Store in history for reconnect scenarios
      const historyKey = this.getHistoryKey(event.job.id);
      const pipeline = this.redis.pipeline();

      // Add to history list (keep recent updates)
      pipeline.lpush(historyKey, eventData);
      pipeline.ltrim(historyKey, 0, this.MAX_HISTORY_SIZE - 1);

      // Set TTL for history cleanup
      pipeline.expire(historyKey, this.HISTORY_TTL);

      await pipeline.exec();

      this.logger.debug(
        `Broadcasted job status: ${event.job.id} (${event.job.status}) [${correlationId}]`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to broadcast job status for ${event.job.id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  /**
   * Get recent job status updates from history
   * @param jobId - The job ID
   * @param limit - Maximum number of updates to retrieve
   * @returns Array of job status events
   */
  async getJobHistory(
    jobId: string,
    limit: number = 50,
  ): Promise<JobStatusEvent[]> {
    try {
      const historyKey = this.getHistoryKey(jobId);
      const events = await this.redis.lrange(
        historyKey,
        0,
        Math.min(limit - 1, this.MAX_HISTORY_SIZE - 1),
      );

      return events
        .map(data => {
          try {
            return JSON.parse(data) as JobStatusEvent;
          } catch {
            return null;
          }
        })
        .filter((event): event is JobStatusEvent => event !== null)
        .reverse(); // Return in chronological order (oldest first)
    } catch (error) {
      this.logger.error(
        `Failed to retrieve job history for ${jobId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Record a subscription for tracking active subscribers
   * @param jobId - The job ID
   * @param subscriptionId - The subscription ID
   * @param userId - Optional user ID for filtering
   * @param ttl - TTL for subscription record (seconds)
   */
  async recordSubscription(
    jobId: string,
    subscriptionId: string,
    userId?: string,
    ttl: number = 3600,
  ): Promise<void> {
    try {
      const key = this.SUBSCRIPTIONS_KEY + jobId;
      const data = JSON.stringify({
        subscriptionId,
        userId,
        subscribedAt: new Date().toISOString(),
      });

      await this.redis.hset(key, subscriptionId, data);
      await this.redis.expire(key, ttl);

      this.logger.debug(
        `Recorded subscription: ${subscriptionId} for job ${jobId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to record subscription: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Remove a subscription record
   * @param jobId - The job ID
   * @param subscriptionId - The subscription ID
   */
  async removeSubscription(
    jobId: string,
    subscriptionId: string,
  ): Promise<void> {
    try {
      const key = this.SUBSCRIPTIONS_KEY + jobId;
      await this.redis.hdel(key, subscriptionId);

      this.logger.debug(
        `Removed subscription: ${subscriptionId} for job ${jobId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to remove subscription: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get count of active subscriptions for a job
   * @param jobId - The job ID
   * @returns Number of active subscriptions
   */
  async getSubscriptionCount(jobId: string): Promise<number> {
    try {
      const key = this.SUBSCRIPTIONS_KEY + jobId;
      return await this.redis.hlen(key);
    } catch (error) {
      this.logger.error(
        `Failed to get subscription count: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Clean up expired history records
   * Can be called periodically as a maintenance task
   * @param jobId - Specific job ID to clean, or undefined for all jobs
   */
  async cleanupHistory(jobId?: string): Promise<number> {
    try {
      let keysToDelete: string[] = [];

      if (jobId) {
        // Clean specific job history
        keysToDelete = [this.getHistoryKey(jobId)];
      } else {
        // Clean all expired job history (TTL handles this automatically in Redis)
        // This method is for manual cleanup if needed
        const pattern = this.HISTORY_KEY + '*';
        keysToDelete = await this.redis.keys(pattern);
      }

      if (keysToDelete.length > 0) {
        const deleted = await this.redis.del(...keysToDelete);
        this.logger.debug(`Cleaned up ${deleted} job history records`);
        return deleted;
      }

      return 0;
    } catch (error) {
      this.logger.error(
        `Failed to cleanup history: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Get metrics about current job status streaming
   */
  async getMetrics(): Promise<Record<string, unknown>> {
    try {
      // Count total history records
      const historyPattern = this.HISTORY_KEY + '*';
      const historyKeys = await this.redis.keys(historyPattern);

      // Count total subscriptions
      const subscriptionPattern = this.SUBSCRIPTIONS_KEY + '*';
      const subscriptionKeys = await this.redis.keys(subscriptionPattern);

      let totalHistoryEvents = 0;
      for (const key of historyKeys) {
        totalHistoryEvents += await this.redis.llen(key);
      }

      let totalSubscriptions = 0;
      for (const key of subscriptionKeys) {
        totalSubscriptions += await this.redis.hlen(key);
      }

      return {
        historyRecords: historyKeys.length,
        totalHistoryEvents,
        subscriptionHolders: subscriptionKeys.length,
        totalActiveSubscriptions: totalSubscriptions,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get metrics: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {};
    }
  }
}
