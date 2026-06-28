import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of, from } from 'rxjs';
import { tap, switchMap } from 'rxjs/operators';
import { Request } from 'express';
import { RedisService } from '../../../cache/redis.service';
import {
  CACHE_RESPONSE_KEY,
  CacheResponseOptions,
} from '../decorators/cache-response.decorator';
import * as crypto from 'crypto';

@Injectable()
export class CacheResponseInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheResponseInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const options = this.reflector.get<CacheResponseOptions>(
      CACHE_RESPONSE_KEY,
      context.getHandler(),
    );

    // If no cache metadata, skip caching
    if (!options) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const cacheKey = this.generateCacheKey(request, options);

    // Try to retrieve from cache
    return from(this.redisService.get<any>(cacheKey)).pipe(
      switchMap(cachedResponse => {
        if (cachedResponse !== null) {
          this.logger.debug(`Cache HIT: ${cacheKey}`);
          return of(cachedResponse);
        }

        this.logger.debug(`Cache MISS: ${cacheKey}`);

        // Cache miss: execute handler and cache the result
        return next.handle().pipe(
          tap(response => {
            // Fire-and-forget cache set (don't await in tap)
            void this.redisService
              .set(cacheKey, response, options.ttl)
              .then(() => {
                this.logger.debug(
                  `Cached response for key: ${cacheKey} (TTL: ${options.ttl}s)`,
                );
              })
              .catch(err => {
                this.logger.warn(
                  `Failed to cache response for key ${cacheKey}: ${String(err)}`,
                );
              });
          }),
        );
      }),
    );
  }

  /**
   * Generate a normalized cache key from the request
   */
  private generateCacheKey(
    request: Request,
    options: CacheResponseOptions,
  ): string {
    const prefix = options.prefix || 'cache:response';

    // Use custom key generator if provided
    if (options.keyGenerator) {
      return `${prefix}:${options.keyGenerator(request)}`;
    }

    // Default key generation: normalize route + query + optionally body
    const parts: string[] = [
      request.method,
      request.route?.path || request.path,
    ];

    // Sort and serialize query params for consistency
    if (Object.keys(request.query).length > 0) {
      const sortedQuery = this.sortObject(request.query);
      parts.push(JSON.stringify(sortedQuery));
    }

    // Include body if requested (useful for POST with read semantics)
    if (options.includeBody && request.body) {
      const sortedBody = this.sortObject(request.body);
      parts.push(JSON.stringify(sortedBody));
    }

    // Hash the key to keep it manageable
    const rawKey = parts.join('::');
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');

    return `${prefix}:${hash}`;
  }

  /**
   * Recursively sort object keys for consistent serialization
   */
  private sortObject(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sortObject(item));
    }

    const sorted: any = {};
    Object.keys(obj)
      .sort()
      .forEach(key => {
        sorted[key] = this.sortObject(obj[key]);
      });

    return sorted;
  }
}
