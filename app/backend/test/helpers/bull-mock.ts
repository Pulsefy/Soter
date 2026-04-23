/**
 * BullMQ test helper.
 *
 * Provides a factory that overrides the BullMQ root Redis connection with
 * ioredis-mock so that queue operations work in-memory without a real Redis
 * instance.  This makes e2e tests fully self-contained in CI.
 *
 * Usage:
 *   const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
 *     .overrideProvider(BULL_CONFIG_DEFAULT_TOKEN)
 *     .useValue(bullMockConfig())
 *     .compile();
 *
 * Alternatively, use the `withBullMock` helper which applies all overrides.
 */

import { TestingModuleBuilder } from '@nestjs/testing';

// ioredis-mock ships a Redis-compatible in-memory client
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RedisMock = require('ioredis-mock') as new (opts?: object) => object;

/**
 * Create a shared ioredis-mock instance.
 * All queues in the same test process share the same in-memory store.
 */
export function createRedisMock() {
  return new RedisMock({ lazyConnect: false });
}

/**
 * Apply BullMQ connection override to a TestingModuleBuilder.
 *
 * Overrides the shared Redis connection used by BullModule.forRootAsync so
 * that all queues and workers connect to the in-memory mock instead of a
 * real Redis server.
 */
export function withBullMock(
  builder: TestingModuleBuilder,
): TestingModuleBuilder {
  // BullMQ's NestJS integration exposes the shared connection config via this
  // token.  We replace the connection factory with one that returns our mock.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BULL_CONFIG_DEFAULT_TOKEN } = require('@nestjs/bullmq');
    const redisMock = createRedisMock();
    return builder
      .overrideProvider(BULL_CONFIG_DEFAULT_TOKEN)
      .useValue({ connection: redisMock });
  } catch {
    // Token not available in this version – fall back to no-op
    return builder;
  }
}
