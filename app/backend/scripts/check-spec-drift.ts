/**
 * scripts/check-spec-drift.ts
 *
 * CI guard: regenerates the OpenAPI spec in memory and compares it with the
 * committed artifact at openapi/openapi.json.
 *
 * Exit codes:
 *   0 — specs match (no drift)
 *   1 — specs differ (drift detected) OR committed artifact is missing
 *
 * Usage (invoked by the `spec:check` npm script):
 *   pnpm --filter backend run spec:check
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';

import { AppModule } from '../src/app.module';
import { buildSwaggerConfig } from '../src/swagger-config';

async function checkDrift() {
  // Load env
  const candidates = [
    join(process.cwd(), '.env'),
    join(process.cwd(), 'app', 'backend', '.env'),
    join(__dirname, '..', '.env'),
  ];
  const envPath = candidates.find(p => existsSync(p));
  if (envPath) loadEnv({ path: envPath });

  const committedPath = join(process.cwd(), 'openapi', 'openapi.json');

  if (!existsSync(committedPath)) {
    console.error(
      '❌  Committed artifact openapi/openapi.json not found.\n' +
        '    Run `pnpm --filter backend run spec:generate` and commit the result.',
    );
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, { logger: false });

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

  const freshDocument = SwaggerModule.createDocument(app, buildSwaggerConfig());
  await app.close();

  // Normalize both sides by round-tripping through JSON.stringify(JSON.parse())
  // so formatting differences (whitespace, key order) don't cause false positives.
  const fresh = JSON.stringify(freshDocument);
  const committed = JSON.stringify(JSON.parse(readFileSync(committedPath, 'utf-8')));

  if (fresh === committed) {
    console.log('✅  OpenAPI spec is up to date — no drift detected.');
    process.exit(0);
  }

  console.error(
    '❌  OpenAPI spec drift detected!\n\n' +
      '    The committed artifact (openapi/openapi.json) does not match the\n' +
      '    spec generated from the current source code.\n\n' +
      '    To fix this, run:\n' +
      '      pnpm --filter backend run spec:generate\n' +
      '    then commit the updated openapi/openapi.json.',
  );

  process.exit(1);
}

void checkDrift();
