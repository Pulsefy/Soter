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

  /**
   * Store raw binary data with a TTL.
   */
  async setBuffer(
    key: string,
    value: Buffer,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(
        `Redis SET buffer failed for key "${key}": ${String(err)}`,
      );
    }
  }

  /**
   * Retrieve raw binary data. Returns `null` on miss or error.
   */
  async getBuffer(key: string): Promise<Buffer | null> {
    try {
      const raw = await this.client.getBuffer(key);
      return raw ?? null;
    } catch (err) {
      this.logger.warn(
        `Redis GET buffer failed for key "${key}": ${String(err)}`,
      );
      return null;
    }
  }

  /**
   * Add one or more members to a Redis Set.
   */
  async sadd(key: string, ...members: string[]): Promise<number> {
    try {
      return await this.client.sadd(key, ...members);
    } catch (err) {
      this.logger.warn(`Redis SADD failed for key "${key}": ${String(err)}`);
      return 0;
    }
  }

  /**
   * Return all members of a Redis Set.
   */
  async smembers(key: string): Promise<string[]> {
    try {
      return await this.client.smembers(key);
    } catch (err) {
      this.logger.warn(
        `Redis SMEMBERS failed for key "${key}": ${String(err)}`,
      );
      return [];
    }
  }

  /**
   * Check if a value is a member of a Redis Set.
   */
  async sismember(key: string, member: string): Promise<boolean> {
    try {
      const result = await this.client.sismember(key, member);
      return result === 1;
    } catch (err) {
      this.logger.warn(
        `Redis SISMEMBER failed for key "${key}": ${String(err)}`,
      );
      return false;
    }
  }

  /**
   * Set a TTL on an existing key.
   */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.expire(key, ttlSeconds);
    } catch (err) {
      this.logger.warn(`Redis EXPIRE failed for key "${key}": ${String(err)}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.warn(`Redis DEL failed for key "${key}": ${String(err)}`);
    }
  }

  /**
   * Delete all keys matching a glob pattern using SCAN (non-blocking).
   * Returns the number of keys deleted.
   */
  async delByPattern(pattern: string): Promise<number> {
    try {
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [nextCursor, batch] = await this.client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;
        keys.push(...batch);
      } while (cursor !== '0');

      if (keys.length > 0) {
        await this.client.del(...keys);
      }
      return keys.length;
    } catch (err) {
      this.logger.warn(
        `Redis SCAN/DEL failed for pattern "${pattern}": ${String(err)}`,
      );
      return 0;
    }
  }
}
