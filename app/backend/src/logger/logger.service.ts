import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import pino, { Logger as PinoLogger, Bindings, ChildLoggerOptions } from 'pino';
import { AsyncLocalStorage } from 'async_hooks';
import { CORRELATION_ID_KEY } from '../common/utils/correlation-id.util';

// Type definitions
type LogLevel = 'info' | 'error' | 'warn' | 'debug' | 'trace';
type LogMessage = string | Record<string, unknown>;
type LogMeta = Record<string, unknown> | undefined;
type LogContext = string | undefined;
type ErrorTrace = string | undefined;

// Interface for log entries
interface LogEntry {
  message?: string;
  context?: string;
  correlationId?: string;
  timestamp: string;
  [key: string]: unknown;
}

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: PinoLogger;
  private readonly asyncLocalStorage = new AsyncLocalStorage<
    Map<string, unknown>
  >();

  constructor() {
    this.logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label: string): Record<string, unknown> => ({ level: label }),
        log: (object: Record<string, unknown>): Record<string, unknown> => {
          const correlationId = this.getCorrelationId();
          if (correlationId) {
            return { ...object, correlationId };
          }
          return object;
        },
      },
    });
  }

  /**
   * Get correlation ID from async local storage
   */
  private getCorrelationId(): string | undefined {
    const store = this.asyncLocalStorage.getStore();
    return store?.get(CORRELATION_ID_KEY) as string | undefined;
  }

  /**
   * Format message with correlation ID for methods that bypass Pino's formatters
   */
  private formatMessage(
    message: LogMessage,
    context?: string,
    meta?: LogMeta,
  ): LogEntry {
    const correlationId = this.getCorrelationId();
    const timestamp = new Date().toISOString();

    // If message is an object, merge it with metadata
    if (typeof message === 'object' && message !== null) {
      return {
        ...message,
        ...(meta || {}),
        correlationId,
        context,
        timestamp,
      };
    }

    // String message with metadata
    return {
      message,
      ...(meta || {}),
      correlationId,
      context,
      timestamp,
    };
  }

  /**
   * Log a message with context
   */
  log(message: LogMessage, context?: LogContext, meta?: LogMeta): void {
    const correlationId = this.getCorrelationId();

    if (typeof message === 'object' && message !== null) {
      this.logger.info({ context, correlationId, ...message, ...(meta || {}) });
    } else {
      this.logger.info({ context, correlationId, ...(meta || {}) }, message);
    }
  }

  /**
   * Log an error message
   */
  error(
    message: LogMessage,
    trace?: ErrorTrace,
    context?: LogContext,
    meta?: LogMeta,
  ): void {
    const correlationId = this.getCorrelationId();

    if (typeof message === 'object' && message !== null) {
      this.logger.error({
        context,
        correlationId,
        trace,
        ...message,
        ...(meta || {}),
      });
    } else {
      this.logger.error(
        { context, correlationId, trace, ...(meta || {}) },
        message,
      );
    }
  }

  /**
   * Log a warning message
   */
  warn(message: LogMessage, context?: LogContext, meta?: LogMeta): void {
    const correlationId = this.getCorrelationId();

    if (typeof message === 'object' && message !== null) {
      this.logger.warn({ context, correlationId, ...message, ...(meta || {}) });
    } else {
      this.logger.warn({ context, correlationId, ...(meta || {}) }, message);
    }
  }

  /**
   * Log a debug message
   */
  debug(message: LogMessage, context?: LogContext, meta?: LogMeta): void {
    const correlationId = this.getCorrelationId();

    if (typeof message === 'object' && message !== null) {
      this.logger.debug({
        context,
        correlationId,
        ...message,
        ...(meta || {}),
      });
    } else {
      this.logger.debug({ context, correlationId, ...(meta || {}) }, message);
    }
  }

  /**
   * Log a verbose message
   */
  verbose(message: LogMessage, context?: LogContext, meta?: LogMeta): void {
    const correlationId = this.getCorrelationId();

    if (typeof message === 'object' && message !== null) {
      this.logger.trace({
        context,
        correlationId,
        ...message,
        ...(meta || {}),
      });
    } else {
      this.logger.trace({ context, correlationId, ...(meta || {}) }, message);
    }
  }

  /**
   * Get the underlying Pino logger instance
   */
  getLogger(): PinoLogger {
    return this.logger;
  }

  /**
   * Expose the async local storage for middleware use
   */
  getAsyncLocalStorage(): AsyncLocalStorage<Map<string, unknown>> {
    return this.asyncLocalStorage;
  }

  /**
   * Create a child logger with fixed correlation ID
   */
  child(bindings: Bindings, options?: ChildLoggerOptions): LoggerService {
    const childLogger = this.logger.child(bindings, options);
    const correlationId = this.getCorrelationId();

    // Create a proxy that maintains correlation ID in methods
    const proxy = new Proxy(this, {
      get: (target: LoggerService, prop: string | symbol): unknown => {
        if (prop === 'getLogger') {
          return (): PinoLogger => childLogger;
        }

        const logMethods = ['log', 'error', 'warn', 'debug', 'verbose'];
        if (typeof prop === 'string' && logMethods.includes(prop)) {
          return (...args: unknown[]): void => {
            const pinoMethod =
              prop === 'verbose' ? 'trace' : (prop as LogLevel);
            const lastArg = args[args.length - 1];

            if (
              lastArg &&
              typeof lastArg === 'object' &&
              !Array.isArray(lastArg)
            ) {
              // Meta object provided
              const meta = {
                ...(lastArg as Record<string, unknown>),
                correlationId,
              };
              args[args.length - 1] = meta;
            } else {
              // No meta object, add one
              args.push({ correlationId });
            }

            // Type assertion needed for dynamic method call
            (
              childLogger as unknown as Record<
                string,
                (...args: unknown[]) => void
              >
            )[pinoMethod](...args);
          };
        }

        return target[prop as keyof LoggerService];
      },
    });

    return proxy;
  }
}
