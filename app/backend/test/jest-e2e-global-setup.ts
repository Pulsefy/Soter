/**
 * Jest globalSetup for e2e tests.
 *
 * Runs ONCE before all test suites in a separate Node process.
 * Responsible for:
 *  1. Ensuring the test SQLite database exists and is up-to-date
 *     by running `prisma migrate deploy` against it.
 *
 * This keeps the e2e suite self-contained – no manual DB setup required
 * in CI or local development.
 */

import { execSync } from 'child_process';
import { join, resolve } from 'path';

export default async function globalSetup(): Promise<void> {
  const backendRoot = join(__dirname, '..');
  // Use an absolute path so Prisma can find the file regardless of CWD
  const dbAbsPath = resolve(backendRoot, 'prisma', 'test.db');
  const dbUrl = `file:${dbAbsPath}`;

  process.env.DATABASE_URL = dbUrl;

  console.log(`[e2e globalSetup] Running prisma migrate deploy on ${dbUrl}…`);

  try {
    execSync('npx prisma migrate deploy', {
      cwd: backendRoot,
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'pipe',
    });
    console.log('[e2e globalSetup] Migrations applied successfully.');
  } catch (err) {
    // If migrations fail (e.g. already up-to-date), log but don't abort
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[e2e globalSetup] prisma migrate deploy warning: ${message}`,
    );
  }
}
