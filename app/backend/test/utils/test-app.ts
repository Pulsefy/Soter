import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { MockOnchainAdapter } from '../../src/onchain/onchain.adapter.mock';
import { ONCHAIN_ADAPTER_TOKEN } from '../../src/onchain/onchain.adapter';

/**
 * Mock BullMQ module that doesn't require Redis
 */
const MockBullModule = {
  forRoot: () => ({
    module: BullModule,
    providers: [
      {
        provide: 'BULLMQ_MODULE_OPTIONS',
        useValue: {
          connection: null,
        },
      },
    ],
  }),
  registerQueue: () => ({
    module: BullModule,
    providers: [],
    exports: [],
  }),
};

/**
 * Creates a test application instance with all necessary mocks and configurations
 * for end-to-end testing. This boots the full NestJS application with test-specific
 * overrides to ensure CI safety and deterministic behavior.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      // Override config to load test environment
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: '.env.test',
      }),
      
      // Use mock BullMQ to avoid Redis connection
      MockBullModule.forRoot(),
      
      // Import the main application module
      AppModule,
    ],
  })
  .overrideProvider(ONCHAIN_ADAPTER_TOKEN)
  .useValue(new MockOnchainAdapter())
  .compile();

  const app = moduleFixture.createNestApplication();

  // Configure app for testing
  app.setGlobalPrefix('api/v1');

  await app.init();

  return app;
}

/**
 * Cleanup function to properly shut down the test application
 */
export async function cleanupTestApp(app: INestApplication): Promise<void> {
  if (app) {
    await app.close();
  }
}

/**
 * Test utility to get the base URL for API requests
 */
export function getApiBaseUrl(app: INestApplication): string {
  return `http://localhost:${app.getHttpServer().address().port}/api/v1`;
}
