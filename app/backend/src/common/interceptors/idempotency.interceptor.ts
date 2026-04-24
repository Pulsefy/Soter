import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

/** TTL for idempotency keys: 24 hours */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Only apply to POST requests
    if (request.method !== 'POST') return next.handle();

    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    if (!idempotencyKey) return next.handle();

    const bodyHash = createHash('sha256')
      .update(JSON.stringify(request.body ?? {}))
      .digest('hex');

    // Purge expired keys lazily
    await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });

    if (existing) {
      if (existing.bodyHash !== bodyHash) {
        throw new UnprocessableEntityException(
          'Idempotency key reused with a different request body',
        );
      }
      // Replay the original response
      response.status(existing.statusCode);
      return of(existing.response);
    }

    return next.handle().pipe(
      tap({
        next: async (data: unknown) => {
          const statusCode = response.statusCode || 201;
          await this.prisma.idempotencyKey.create({
            data: {
              key: idempotencyKey,
              bodyHash,
              statusCode,
              response: data as object,
              expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
            },
          });
        },
      }),
    );
  }
}
