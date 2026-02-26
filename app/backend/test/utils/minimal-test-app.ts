import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from '../../src/health/health.module';
import { LoggerModule } from '../../src/logger/logger.module';
import { PrismaModule } from '../../src/prisma/prisma.module';

/**
 * Creates a minimal test application for health endpoints testing
 * that doesn't require Redis or other external dependencies
 */
export async function createMinimalTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      // Override config to load test environment
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: '.env.test',
      }),
      
      // Only include modules needed for health testing
      LoggerModule,
      PrismaModule,
      HealthModule,
    ],
  })
  .compile();

  const app = moduleFixture.createNestApplication();

  // Configure app for testing
  app.setGlobalPrefix('api/v1');

  await app.init();

  return app;
}

/**
 * Cleanup function to properly shut down test application
 */
export async function cleanupTestApp(app: INestApplication): Promise<void> {
  if (app) {
    await app.close();
  }
}

/**
 * Test utility to get base URL for API requests
 */
export function getApiBaseUrl(app: INestApplication): string {
  return `http://localhost:${app.getHttpServer().address().port}/api/v1`;
}
