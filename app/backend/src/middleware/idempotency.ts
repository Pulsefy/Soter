import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import type { RedisClientType } from 'redis';
import {
  IdempotencyRecord,
  IdempotencyRequest,
} from '../types/idempotency.types';

function fingerprint(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export function idempotencyMiddleware(
  redisClient: RedisClientType,
  ttlSeconds: number = 86400,
) {
  return async (
    req: IdempotencyRequest & Request,
    res: Response,
    next: NextFunction,
  ) => {
    const key = req.headers['idempotency-key'] as string | undefined;
    const endpoint = req.originalUrl || req.url;

    if (!key) {
      return next();
    }

    const cacheKey = `idempotency:${endpoint}:${key}`;

    try {
      const cached = await redisClient.get(cacheKey);

      if (cached) {
        const record: IdempotencyRecord = JSON.parse(
          cached,
        ) as IdempotencyRecord;

        const currentFingerprint = fingerprint(req.body);

        if (currentFingerprint !== record.fingerprint) {
          return res.status(409).json({
            error: 'Idempotency key already used with a different request body',
            key,
          });
        }

        res.status(record.statusCode).set(record.headers).send(record.body);

        return;
      }

      // First request – store fingerprint and intercept response
      const reqFingerprint = fingerprint(req.body);

      req.idempotency = {
        key,
        cacheKey,
        fingerprint: reqFingerprint,
      };

      const originalSend = res.send.bind(res);

      res.send = (body?: unknown): Response => {
        const recordToCache: IdempotencyRecord = {
          body,
          statusCode: res.statusCode,
          headers: res.getHeaders() as Record<
            string,
            string | number | string[]
          >,
          fingerprint: reqFingerprint,
        };

        void redisClient.setEx(
          cacheKey,
          ttlSeconds,
          JSON.stringify(recordToCache),
        );

        return originalSend(body);
      };

      next();
    } catch (err) {
      console.error('Redis error in idempotency middleware:', err);

      return next();
    }
  };
}
