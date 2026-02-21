import { randomUUID } from 'crypto';
import { Request } from 'express';

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_KEY = 'correlationId';

export function generateCorrelationId(): string {
  return randomUUID();
}

export function getCorrelationIdFromRequest(req: Request): string {
  const headerId =
    (req.headers[CORRELATION_ID_HEADER] as string) ||
    (req.headers[REQUEST_ID_HEADER] as string);

  return headerId || generateCorrelationId();
}
