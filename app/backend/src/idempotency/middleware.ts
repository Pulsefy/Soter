import { Request, Response, NextFunction } from 'express';
import { IdempotencyStore } from './store';
import { IdempotencyKey } from './key';
import { RequestFingerprint } from './fingerprint';
import {
  IdempotencyError,
  FingerprintMismatchError,
  AlreadyProcessingError,
} from './error';

export function idempotencyMiddleware(store: IdempotencyStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 1. Parse Key
      const key = IdempotencyKey.fromHeaders(req);

      // 2. Fingerprint Body
      const fingerprint = RequestFingerprint.fromBody(req.body);

      // 3. Check Store
      const existingRecord = await store.tryAcquire(key, fingerprint);

      if (!existingRecord) {
        // First time: Intercept the response to cache it
        const originalSend = res.send.bind(res);

        res.send = (body: any) => {
          const status = res.statusCode;
          const recordStatus =
            status >= 200 && status < 300 ? 'succeeded' : 'failed';
          const bodyString =
            typeof body === 'string' ? body : JSON.stringify(body);

          // Fire and forget cache save (log on failure)
          store
            .complete(key, recordStatus, status, bodyString)
            .catch(err =>
              console.error(
                `Failed to save idempotency record for key ${key.asString()}:`,
                err,
              ),
            );

          return originalSend(body);
        };

        return next();
      }

      // Existing Record Found
      if (existingRecord.requestFingerprint !== fingerprint.asString()) {
        throw new FingerprintMismatchError();
      }

      if (existingRecord.status === 'processing') {
        throw new AlreadyProcessingError();
      }

      // Replay cached response
      res.setHeader('X-Idempotent-Replayed', 'true');
      res.status(existingRecord.responseStatus ?? 500);

      const bodyString = existingRecord.responseBody?.toString('utf-8') ?? '';
      try {
        res.json(JSON.parse(bodyString));
      } catch {
        res.send(bodyString);
      }
    } catch (error) {
      if (error instanceof IdempotencyError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      next(error);
    }
  };
}
