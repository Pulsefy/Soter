import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Idempotency interceptor for preventing duplicate requests.
 *
 * This interceptor:
 * 1. Extracts the idempotency key from request headers
 * 2. Checks if the key has been used before
 * 3. If used, returns the cached response
 * 4. If new, processes the request and stores the response
 *
 * Usage: Add `@UseInterceptors(IdempotencyInterceptor)` to controllers
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

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

    // Check if this key has already been processed
    const existingRecord = await this.prisma.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });

    if (existingRecord) {
      // Return cached response if key was already used
      response
        .status(existingRecord.responseStatus)
        .json(JSON.parse(existingRecord.responseBody));
      return new Observable();
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
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
              },
            });
          } catch (error) {
            // Log error but don't fail the request
            console.error('Failed to cache idempotency key:', error);
          }
        })();
      }),
    );
  }
}
