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
 * Set SPEC_OUTPUT_PATH to write the document somewhere other than the
 * committed artifact. CI uses this to snapshot the freshly generated spec
 * (openapi/openapi.generated.json) without mutating the file the drift
 * check is about to read.
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
  const outPath = process.env.SPEC_OUTPUT_PATH
    ? join(process.cwd(), process.env.SPEC_OUTPUT_PATH)
    : join(outDir, 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2), 'utf-8');

  const pathCount = Object.keys(document.paths ?? {}).length;
  const schemaCount = Object.keys(
    (document.components?.schemas as Record<string, unknown>) ?? {},
  ).length;

  console.log(`✅  OpenAPI spec written to ${outPath}`);
  console.log(`    Paths: ${pathCount}  |  Schemas: ${schemaCount}`);

  await app.close();

  if (pathCount === 0) {
    console.error(
      '❌  Generated OpenAPI document contains zero paths — controller\n' +
        '    metadata was not discovered. Refusing to publish an empty spec.',
    );
    process.exit(1);
  }

  process.exit(0);
}

void generate().catch((err: unknown) => {
  console.error('❌  Failed to generate OpenAPI spec.');
  console.error(err);
  process.exit(1);
});

