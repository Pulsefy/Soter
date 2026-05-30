import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import pino, { Logger as PinoLogger, Bindings, ChildLoggerOptions } from 'pino';
import { AsyncLocalStorage } from 'async_hooks';
import { CORRELATION_ID_KEY } from '../common/utils/correlation-id.util';
import { redactLogData } from './log-redaction.util';

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
   * Apply redaction to log data to prevent PII leakage (Issue #461)
   */
  private redactMetadata(meta?: LogMeta): LogMeta {
    if (!meta) return meta;
    return redactLogData(meta) as LogMeta;
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
   * Redacts sensitive data and PII to prevent data leaks (Issue #461)
   */
  log(message: LogMessage, context?: LogContext, meta?: LogMeta): void {
    const correlationId = this.getCorrelationId();
    const redactedMeta = this.redactMetadata(meta);

    if (typeof message === 'object' && message !== null) {
      const redactedMessage = redactLogData(message) as Record<string, unknown>;
      this.logger.info({ context, correlationId, ...redactedMessage, ...(redactedMeta || {}) });
    } else {
      this.logger.info({ context, correlationId, ...(redactedMeta || {}) }, message);
    }
  }

  /**
   * Log an error message
   * Redacts sensitive data and PII to prevent data leaks (Issue #461)
   */
  error(
    message: LogMessage,
    trace?: ErrorTrace,
    context?: LogContext,
    meta?: LogMeta,
  ): void {
    const correlationId = this.getCorrelationId();
    const redactedMeta = this.redactMetadata(meta);

    if (typeof message === 'object' && message !== null) {
      const redactedMessage = redactLogData(message) as Record<string, unknown>;
      this.logger.error({
        context,
        correlationId,
        trace,
        ...redactedMessage,
        ...(redactedMeta || {}),
      });
    } else {
      this.logger.error(
        { context, correlationId, trace, ...(redactedMeta || {}) },
        message,
      );
    }
  }

  /**
   * Log a warning message
   * Redacts sensitive data and PII to prevent data leaks (Issue #461)
   */
  warn(message: LogMessage, context?: LogContext, meta?: LogMeta): void {
    const correlationId = this.getCorrelationId();
    const redactedMeta = this.redactMetadata(meta);

    if (typeof message === 'object' && message !== null) {
      const redactedMessage = redactLogData(message) as Record<string, unknown>;
      this.logger.warn({ context, correlationId, ...redactedMessage, ...(redactedMeta || {}) });
    } else {
      this.logger.warn({ context, correlationId, ...(redactedMeta || {}) }, message);
    }
  }

  /**
   * Log a debug message
   * Redacts sensitive data and PII to prevent data leaks (Issue #461)
   */
  debug(message: LogMessage, context?: LogContext, meta?: LogMeta): void {
    const correlationId = this.getCorrelationId();
    const redactedMeta = this.redactMetadata(meta);

    if (typeof message === 'object' && message !== null) {
      const redactedMessage = redactLogData(message) as Record<string, unknown>;
      this.logger.debug({
        context,
        correlationId,
        ...redactedMessage,
        ...(redactedMeta || {}),
      });
    } else {
      this.logger.debug({ context, correlationId, ...(redactedMeta || {}) }, message);
    }
  }

  /**
   * Log a verbose message
   * Redacts sensitive data and PII to prevent data leaks (Issue #461)
   */
  verbose(message: LogMessage, context?: LogContext, meta?: LogMeta): void {
    const correlationId = this.getCorrelationId();
    const redactedMeta = this.redactMetadata(meta);

    if (typeof message === 'object' && message !== null) {
      const redactedMessage = redactLogData(message) as Record<string, unknown>;
      this.logger.trace({
        context,
        correlationId,
        ...redactedMessage,
        ...(redactedMeta || {}),
      });
    } else {
      this.logger.trace({ context, correlationId, ...(redactedMeta || {}) }, message);
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
