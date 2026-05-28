import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { RedisClient } from 'redis';
import {
  IdempotencyRecord,
  IdempotencyRequest,
} from '../types/idempotency.types';

function fingerprint(body: any): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export function idempotencyMiddleware(
  redisClient: RedisClient,
  ttlSeconds: number = 86400,
) {
  return async (req: IdempotencyRequest, res: Response, next: NextFunction) => {
    const key = req.headers['idempotency-key'] as string | undefined;
    const endpoint = req.originalUrl || req.url;

    if (!key) {
      return next();
    }

    const cacheKey = `idempotency:${endpoint}:${key}`;

    return new Promise<void>(resolve => {
      redisClient.get(cacheKey, (err, cached) => {
        if (err) {
          console.error('Redis error in idempotency middleware:', err);
          return next(); // fail open
        }

        if (cached) {
          const record: IdempotencyRecord = JSON.parse(cached);
          const currentFingerprint = fingerprint(req.body);

          if (currentFingerprint !== record.fingerprint) {
            res.status(409).json({
              error:
                'Idempotency key already used with a different request body',
              key,
            });
            return resolve();
          }

          // Return cached response
          res.status(record.statusCode).set(record.headers).send(record.body);
          return resolve();
        }

        // First request – store fingerprint and intercept response
        const reqFingerprint = fingerprint(req.body);
        req.idempotency = { key, cacheKey, fingerprint: reqFingerprint };

        const originalSend = res.send.bind(res);
        res.send = (body: any): Response => {
          const recordToCache: IdempotencyRecord = {
            body,
            statusCode: res.statusCode,
            headers: res.getHeaders() as Record<
              string,
              string | number | string[]
            >,
            fingerprint: reqFingerprint,
          };
          redisClient.setex(
            cacheKey,
            ttlSeconds,
            JSON.stringify(recordToCache),
            setErr => {
              if (setErr)
                console.error('Failed to cache idempotency response:', setErr);
            },
          );
          return originalSend(body);
        };
        next();
        resolve();
      });
    });
  };
}
