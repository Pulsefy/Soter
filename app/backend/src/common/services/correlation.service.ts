import {
  Injectable,
  LoggerService as NestLoggerService,
  Scope,
} from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { CORRELATION_ID_KEY } from '../../common/utils/correlation-id.util';

@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService implements NestLoggerService {
  private context?: string;
  private readonly asyncLocalStorage: AsyncLocalStorage<Map<string, any>>;

  constructor() {
    this.asyncLocalStorage = new AsyncLocalStorage();
  }

  /**
   * Get the async local storage instance for correlation ID propagation
   */
  getAsyncLocalStorage(): AsyncLocalStorage<Map<string, any>> {
    return this.asyncLocalStorage;
  }

  /**
   * Get the current correlation ID from async storage
   */
  getCorrelationId(): string | null {
    const store = this.asyncLocalStorage.getStore();
    if (store) {
      return store.get(CORRELATION_ID_KEY) || null;
    }
    return null;
  }

  /**
   * Set the context for the logger instance
   */
  setContext(context: string): void {
    this.context = context;
  }

  private formatMessage(
    message: string,
    context?: string,
    metadata?: Record<string, any>,
  ): string {
    const correlationId = this.getCorrelationId();
    const ctx = context || this.context || 'Application';
    let formatted = `[${ctx}] ${message}`;

    if (correlationId) {
      formatted = `[${correlationId}] ${formatted}`;
    }

    if (metadata && Object.keys(metadata).length > 0) {
      formatted += ` ${JSON.stringify(metadata)}`;
    }

    return formatted;
  }

  log(message: string, context?: string, metadata?: Record<string, any>): void {
    console.log(this.formatMessage(message, context, metadata));
  }

  error(
    message: string,
    trace?: string,
    context?: string,
    metadata?: Record<string, any>,
  ): void {
    const formatted = this.formatMessage(message, context, metadata);
    if (trace) {
      console.error(`${formatted}\n${trace}`);
    } else {
      console.error(formatted);
    }
  }

  warn(
    message: string,
    context?: string,
    metadata?: Record<string, any>,
  ): void {
    console.warn(this.formatMessage(message, context, metadata));
  }

  debug(
    message: string,
    context?: string,
    metadata?: Record<string, any>,
  ): void {
    console.debug(this.formatMessage(message, context, metadata));
  }

  verbose(
    message: string,
    context?: string,
    metadata?: Record<string, any>,
  ): void {
    console.log(this.formatMessage(message, context, metadata));
  }
}
