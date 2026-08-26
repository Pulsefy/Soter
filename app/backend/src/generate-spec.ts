/**
 * generate-spec.ts
 *
 * Standalone script that bootstraps the NestJS application, produces the
 * OpenAPI document (identical to what SwaggerModule serves at /api/docs),
 * and writes it to the committed artifact path `openapi/openapi.json`.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/generate-spec.ts
 *   # or via npm script:
 *   pnpm --filter backend run spec:generate
 *
 * Prerequisites: DATABASE_URL and REDIS_HOST must be reachable so NestJS
 * can complete its module initialization (same requirement as starting the
 * app normally). For CI, ensure the postgres/redis service containers are
 * up and migrations have been applied before running this script.
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';

import { AppModule } from './app.module';
import { buildSwaggerConfig } from './swagger-config';

async function generate() {
  // Load env so ConfigService / Prisma don't fail during module init.
  const candidates = [
    join(process.cwd(), '.env'),
    join(process.cwd(), 'app', 'backend', '.env'),
    join(__dirname, '..', '.env'),
  ];
  const envPath = candidates.find(p => existsSync(p));
  if (envPath) loadEnv({ path: envPath });

  const app = await NestFactory.create(AppModule, {
    // Silence startup logs — we only want spec output.
    logger: false,
  });

  // Mirror the exact same bootstrap as main.ts so the generated spec matches
  // what is served at runtime.
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

  // Write artifact
  const outDir = join(process.cwd(), 'openapi');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2), 'utf-8');

  const pathCount = Object.keys(document.paths ?? {}).length;
  const schemaCount = Object.keys(
    (document.components?.schemas as Record<string, unknown>) ?? {},
  ).length;

  console.log(`✅  OpenAPI spec written to ${outPath}`);
  console.log(`    Paths: ${pathCount}  |  Schemas: ${schemaCount}`);

  await app.close();
  process.exit(0);
}

void generate();
