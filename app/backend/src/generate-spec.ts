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
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadSwaggerEnv, createSwaggerDocument } from './swagger-document';

async function generate() {
  loadSwaggerEnv();

  const { app, document } = await createSwaggerDocument();

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

void generate().catch((err: unknown) => {
  console.error('❌  Failed to generate OpenAPI spec.');
  console.error(err);
  process.exit(1);
});
