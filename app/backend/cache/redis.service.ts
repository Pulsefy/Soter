

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  onModuleInit() {
    this.client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => (times <= 3 ? 200 : null),
    });

    this.client.on('connect', () => this.logger.log('Redis connected'));
    this.client.on('error', (err) => this.logger.error('Redis error', err));
  }

  onModuleDestroy() {
    this.client?.disconnect();
  }

  /**
   * Retrieve and deserialise a cached value.
   * Returns `null` on cache miss or if Redis is unavailable.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.logger.warn(`Redis GET failed for key "${key}": ${String(err)}`);
      return null;
    }
  }

  /**
   * Serialize and store a value with a TTL.
   *
   * @param key   - Redis key
   * @param value - Any JSON-serialisable value
   * @param ttlSeconds - Expiry in seconds (e.g. 300 = 5 minutes)
   */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`Redis SET failed for key "${key}": ${String(err)}`);
    }
  }


  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.warn(`Redis DEL failed for key "${key}": ${String(err)}`);
    }
  }
}