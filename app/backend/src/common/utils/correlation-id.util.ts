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

/**
 * Extract correlation ID from request object or headers
 */
export function extractCorrelationId(req: Request): string | null {
  const fromRequest = (req as any).correlationId || (req as any).requestId;
  if (fromRequest) {
    return fromRequest;
  }

  const fromHeaders =
    (req.headers[CORRELATION_ID_HEADER] as string) ||
    (req.headers[REQUEST_ID_HEADER] as string);

  return fromHeaders || null;
}

/**
 * Get correlation headers for outbound requests
 */
export function getCorrelationHeaders(
  correlationId: string | null,
): Record<string, string> {
  if (!correlationId) {
    return {};
  }
  return {
    [CORRELATION_ID_HEADER]: correlationId,
    [REQUEST_ID_HEADER]: correlationId,
  };
}
