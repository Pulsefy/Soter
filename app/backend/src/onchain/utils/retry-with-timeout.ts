import { Logger } from '@nestjs/common';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  operationTimeoutMs: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
  operationTimeoutMs: 120000,
};

export async function withRetryTimeout<T>(
  fn: () => Promise<T>,
  description: string,
  correlationId: string,
  config: Partial<RetryConfig> = {},
  logger?: Logger,
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, operationTimeoutMs } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await Promise.race([
        fn(),
        new Promise<T>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`Operation timed out after ${operationTimeoutMs}ms`),
              ),
            operationTimeoutMs,
          ),
        ),
      ]);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (logger) {
        logger.warn(
          `[${correlationId}] ${description} attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}`,
        );
      }
      if (attempt < maxRetries) {
        const delay = Math.min(
          baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
          maxDelayMs,
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}
