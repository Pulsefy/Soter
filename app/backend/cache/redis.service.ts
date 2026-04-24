import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
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
      retryStrategy: times => (times <= 3 ? 200 : null),
    });

    this.client.on('connect', () => this.logger.log('Redis connected'));
    this.client.on('error', err => this.logger.error('Redis error', err));
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

  async del(keys: string | string[]): Promise<number> {
    try {
      const keysToDelete = Array.isArray(keys) ? keys : [keys];

      if (keysToDelete.length === 0) {
        return 0;
      }

      return await this.client.del(...keysToDelete);
    } catch (err) {
      this.logger.warn(`Redis DEL failed: ${String(err)}`);
      return 0;
    }
  }

  async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    try {
      do {
        const [nextCursor, matchedKeys] = await this.client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );

        cursor = nextCursor;
        keys.push(...matchedKeys);
      } while (cursor !== '0');

      return keys;
    } catch (err) {
      this.logger.warn(
        `Redis SCAN failed for pattern "${pattern}": ${String(err)}`,
      );
      return [];
    }
  }
}
