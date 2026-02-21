import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { LoggerService } from '../logger/logger.service';

// Export the original interface for backward compatibility
export interface RequestWithRequestId extends Request {
  requestId?: string;
}

// Extended interface with both properties (keeps the original through inheritance)
export interface RequestWithCorrelation extends RequestWithRequestId {
  correlationId?: string;
}

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id'; // Keep for backward compatibility
export const CORRELATION_ID_KEY = 'correlationId';

/**
 * Generate a correlation/request ID
 * Uses UUID v4 for uniqueness
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Extract correlation ID from request headers or generate a new one
 * Checks multiple header names for compatibility
 */
export function getCorrelationIdFromRequest(req: Request): string {
  // Check both header names for backward compatibility
  const headerId =
    (req.headers[CORRELATION_ID_HEADER] as string) ||
    (req.headers[REQUEST_ID_HEADER] as string);

  return headerId || generateCorrelationId();
}

@Injectable()
export class RequestCorrelationMiddleware implements NestMiddleware {
  constructor(private readonly logger: LoggerService) {}

  use(req: RequestWithCorrelation, res: Response, next: NextFunction) {
    // Get or generate correlation ID
    const correlationId = getCorrelationIdFromRequest(req);

    // Attach to request object (both names for backward compatibility)
    req.correlationId = correlationId;
    req.requestId = correlationId; // Keep for backward compatibility

    // Set in response headers (both headers for client compatibility)
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    res.setHeader(REQUEST_ID_HEADER, correlationId);

    // Store correlation ID in async local storage for the logger
    const asyncLocalStorage = this.logger.getAsyncLocalStorage();
    const store = new Map<string, any>();
    store.set(CORRELATION_ID_KEY, correlationId);

    // Log request start (optional - can be removed if too verbose)
    this.logger.debug(
      `Incoming request: ${req.method} ${req.url}`,
      'RequestCorrelationMiddleware',
      { correlationId, ip: req.ip, userAgent: req.headers['user-agent'] },
    );

    // Run the rest of the request in the async storage context
    asyncLocalStorage.run(store, () => {
      // Track response time
      const startTime = Date.now();

      // Add response finish listener to log completion
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        this.logger.debug(
          `Request completed: ${req.method} ${req.url} ${res.statusCode} - ${duration}ms`,
          'RequestCorrelationMiddleware',
          { correlationId, statusCode: res.statusCode, duration },
        );
      });

      next();
    });
  }
}

export type { RequestWithRequestId as RequestWithRequestIdAlias };
