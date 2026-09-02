import {
  Injectable,
  Logger,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  IDEMPOTENCY_KEY_TTL_HOURS_ENV,
  resolveIdempotencyKeyTtlHours,
} from '../retention-policy/idempotency-key-retention.config';

/**
 * Idempotency interceptor for preventing duplicate requests.
 *
 * This interceptor:
 * 1. Extracts the idempotency key from request headers
 * 2. Checks if the key has been used before (ignoring expired records)
 * 3. If used and still valid, returns the cached response
 * 4. If new, processes the request and stores the response with an explicit expiry
 *
 * Expired-but-not-yet-purged records are treated as absent: the lookup only
 * considers rows whose `expiresAt` is still in the future, and a stale row is
 * deleted lazily so the unique key can be reused by a fresh request.
 *
 * Usage: Add `@UseInterceptors(IdempotencyInterceptor)` to controllers
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const idempotencyKey = request.headers['x-idempotency-key'] as string;

    // If no idempotency key, proceed normally
    if (!idempotencyKey) {
      return next.handle();
    }

    const ttlHours = resolveIdempotencyKeyTtlHours(
      this.configService.get<string>(IDEMPOTENCY_KEY_TTL_HOURS_ENV),
    );
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

    // Only records that have not expired yet participate in replay protection
    const existingRecord = await this.prisma.idempotencyKey.findFirst({
      where: { key: idempotencyKey, expiresAt: { gt: now } },
    });

    if (existingRecord) {
      // Return cached response if the key was already used
      response
        .status(existingRecord.responseStatus)
        .json(JSON.parse(existingRecord.responseBody));
      return new Observable();
    }

    // Expired-but-not-yet-purged rows behave as absent: clear the stale row so
    // the unique key can be reused by a fresh request.
    const cleared = await this.prisma.idempotencyKey.deleteMany({
      where: { key: idempotencyKey, expiresAt: { lte: now } },
    });
    if (cleared.count > 0) {
      this.logger.debug(
        {
          operation: 'idempotency-key-purge',
          job: 'lazy-expiry-clear',
          cleared: cleared.count,
          keyLength: idempotencyKey.length,
        },
        IdempotencyInterceptor.name,
      );
    }

    // Process the request and cache the response
    return next.handle().pipe(
      tap(data => {
        // Handle async operation without returning Promise to tap()
        void (async () => {
          try {
            await this.prisma.idempotencyKey.create({
              data: {
                key: idempotencyKey,
                responseStatus: response.statusCode,
                responseBody: JSON.stringify(data),
                expiresAt,
              },
            });
          } catch (error) {
            // Log error but don't fail the request
            this.logger.error(
              {
                operation: 'idempotency-key-cache',
                error: error instanceof Error ? error.message : String(error),
                keyLength: idempotencyKey.length,
              },
              IdempotencyInterceptor.name,
            );
          }
        })();
      }),
    );
  }
}
