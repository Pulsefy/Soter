/**
 * Shared Nest bootstrap used by generate-spec.ts and check-spec-drift.ts
 * so the committed OpenAPI artifact matches the live /api/docs document.
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';

import { buildSwaggerConfig } from './swagger-config';

export function loadSwaggerEnv(): void {
  const candidates = [
    join(process.cwd(), '.env'),
    join(process.cwd(), 'app', 'backend', '.env'),
    join(__dirname, '..', '.env'),
  ];
  const envPath = candidates.find(p => existsSync(p));
  if (envPath) loadEnv({ path: envPath });
}

export async function createSwaggerDocument(): Promise<{
  app: INestApplication;
  document: OpenAPIObject;
}> {
  // Spec generation only needs controller metadata. Skip queue schedulers
  // that would block (or fail) when Redis is unreachable.
  process.env.SKIP_BACKGROUND_JOBS = 'true';

  const { SpecAppModule } = await import('./spec-app.module');
  const app = await NestFactory.create(SpecAppModule, { logger: false });

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
      errorHttpStatusCode: 422,
    }),
  );

  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  return { app, document };
}
