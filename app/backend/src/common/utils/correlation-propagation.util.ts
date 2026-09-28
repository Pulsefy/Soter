import { Request } from 'express';
import {
  CORRELATION_ID_HEADER,
  CORRELATION_ID_KEY,
} from './correlation-id.util';
import { LoggerService } from '../../logger/logger.service';

/**
 * Utility for propagating correlation IDs to outbound requests
 */
export class CorrelationPropagationUtil {
  private static instance: CorrelationPropagationUtil;
  private logger: LoggerService | null = null;

  private constructor() {}

  static getInstance(): CorrelationPropagationUtil {
    if (!CorrelationPropagationUtil.instance) {
      CorrelationPropagationUtil.instance = new CorrelationPropagationUtil();
    }
    return CorrelationPropagationUtil.instance;
  }

  /**
   * Set logger instance for correlation propagation logging
   */
  setLogger(logger: LoggerService): void {
    this.logger = logger;
  }

  /**
   * Get the current correlation ID from the request or async storage
   */
  getCurrentCorrelationId(req?: Request): string | null {
    // First try to get from request
    if (req) {
      const fromRequest = (req as any).correlationId || (req as any).requestId;
      if (fromRequest) {
        return fromRequest;
      }
    }

    // Try to get from async storage
    try {
      const asyncLocalStorage = this.logger?.getAsyncLocalStorage();
      if (asyncLocalStorage) {
        const store = asyncLocalStorage.getStore() as
          | Map<string, any>
          | undefined;
        if (store) {
          const fromStore = store.get(CORRELATION_ID_KEY);
          if (fromStore) {
            return fromStore;
          }
        }
      }
    } catch {
      // Async storage not available - ignore error
    }

    return null;
  }

  /**
   * Get headers with correlation ID for outbound requests
   */
  getCorrelationHeaders(req?: Request): Record<string, string> {
    const correlationId = this.getCurrentCorrelationId(req);
    const headers: Record<string, string> = {};

    if (correlationId) {
      headers[CORRELATION_ID_HEADER] = correlationId;
    }

    return headers;
  }

  /**
   * Add correlation ID to fetch options or axios config
   */
  addCorrelationToRequest(
    config: Record<string, any>,
    req?: Request,
  ): Record<string, any> {
    const headers = this.getCorrelationHeaders(req);

    if (Object.keys(headers).length > 0) {
      config.headers = {
        ...config.headers,
        ...headers,
      };
    }

    return config;
  }

  /**
   * Log outbound request with correlation ID
   */
  logOutboundRequest(
    url: string,
    method: string,
    req?: Request,
    metadata?: Record<string, any>,
  ): void {
    const correlationId = this.getCurrentCorrelationId(req);

    if (this.logger) {
      this.logger.debug(
        `Outbound request: ${method} ${url}`,
        'CorrelationPropagation',
        {
          correlationId,
          ...metadata,
        },
      );
    }
  }
}
