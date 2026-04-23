/**
 * Shared test harness for e2e specs.
 *
 * Bootstraps a full NestJS application with:
 *  - URI versioning  (/api/v1/...)
 *  - Global ValidationPipe
 *  - SQLite test database (DATABASE_URL=file:./prisma/test.db)
 *  - MockOnchainAdapter (ONCHAIN_ADAPTER=mock)
 *  - No external secrets required
 *
 * Usage:
 *   const harness = await createTestHarness();
 *   // ... tests ...
 *   await harness.close();
 */

import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { AppRole } from 'src/auth/app-role.enum';

import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Environment defaults – no real secrets needed in CI
// ---------------------------------------------------------------------------
const _backendRoot = resolve(__dirname, '..');
const _dbAbsPath = resolve(_backendRoot, 'prisma', 'test.db');
process.env.DATABASE_URL = process.env.DATABASE_URL ?? `file:${_dbAbsPath}`;
process.env.ONCHAIN_ADAPTER = 'mock';
process.env.VERIFICATION_MODE = 'mock';
process.env.REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT ?? '6379';
// Use a well-known dev key so tests don't need a real API_KEY env var
process.env.API_KEY = process.env.API_KEY ?? 'e2e-test-admin-key';

/** The API key inserted into the DB for e2e tests. */
export const E2E_API_KEY = 'e2e-test-admin-key';
export const E2E_OPERATOR_KEY = 'e2e-test-operator-key';

export interface TestHarness {
  app: INestApplication;
  prisma: PrismaService;
  /** Supertest server handle */
  server: ReturnType<INestApplication['getHttpServer']>;
  /** Tear down the application */
  close: () => Promise<void>;
}

export async function createTestHarness(): Promise<TestHarness> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'v',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();

  const prisma = app.get(PrismaService);

  // Seed the test API keys so the ApiKeyGuard can authenticate requests
  await prisma.apiKey.upsert({
    where: { key: E2E_API_KEY },
    update: { role: AppRole.admin, revokedAt: null },
    create: {
      key: E2E_API_KEY,
      role: AppRole.admin,
      description: 'E2E test admin key',
    },
  });

  await prisma.apiKey.upsert({
    where: { key: E2E_OPERATOR_KEY },
    update: { role: AppRole.operator, revokedAt: null },
    create: {
      key: E2E_OPERATOR_KEY,
      role: AppRole.operator,
      description: 'E2E test operator key',
    },
  });

  return {
    app,
    prisma,
    server: app.getHttpServer(),
    close: () => app.close(),
  };
}
