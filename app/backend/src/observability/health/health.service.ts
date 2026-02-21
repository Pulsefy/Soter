/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { RedisService } from '@liaoliaots/nestjs-redis';

@Injectable()
export class HealthService extends HealthIndicator {
  constructor(
    @InjectQueue('default') private readonly queue: Queue,
    private readonly redisService: RedisService,
  ) {
    super();
  }

  /**
   * Check queue connectivity and status
   */
  async checkQueue(key: string): Promise<HealthIndicatorResult> {
    try {
      const isReady = await this.queue.isReady();
      const jobCounts = await this.queue.getJobCounts();

      const status = {
        isReady,
        waiting: jobCounts.waiting,
        active: jobCounts.active,
        completed: jobCounts.completed,
        failed: jobCounts.failed,
        delayed: jobCounts.delayed,
      };

      if (!isReady) {
        throw new Error('Queue is not ready');
      }

      return this.getStatus(key, true, status);
    } catch (error) {
      const status = {
        isReady: false,
        error: error.message,
      };
      throw new HealthCheckError(
        'Queue health check failed',
        this.getStatus(key, false, status),
      );
    }
  }

  /**
   * Check Redis connectivity
   */
  async checkRedis(key: string): Promise<HealthIndicatorResult> {
    try {
      const redis = this.redisService.getOrThrow();
      const start = Date.now();
      await redis.ping();
      const latency = Date.now() - start;

      const info = await redis.info('server');
      const uptimeMatch = info.match(/uptime_in_seconds:(\d+)/);
      const uptime = uptimeMatch ? parseInt(uptimeMatch[1], 10) : null;

      const status = {
        connected: true,
        latency: `${latency}ms`,
        uptime: uptime ? `${uptime}s` : 'unknown',
      };

      return this.getStatus(key, true, status);
    } catch (error) {
      const status = {
        connected: false,
        error: error.message,
      };
      throw new HealthCheckError(
        'Redis health check failed',
        this.getStatus(key, false, status),
      );
    }
  }

  /**
   * Custom health check for external services
   */
  async checkExternalService(
    key: string,
    serviceUrl: string,
  ): Promise<HealthIndicatorResult> {
    try {
      const start = Date.now();
      const response = await fetch(serviceUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      const latency = Date.now() - start;

      const status = {
        available: response.ok,
        statusCode: response.status,
        latency: `${latency}ms`,
      };

      if (!response.ok) {
        throw new Error(`Service returned status ${response.status}`);
      }

      return this.getStatus(key, true, status);
    } catch (error) {
      const status = {
        available: false,
        error: error.message,
      };
      throw new HealthCheckError(
        `External service health check failed for ${key}`,
        this.getStatus(key, false, status),
      );
    }
  }
}
