/**
 * Jest setup file for e2e tests.
 *
 * Runs BEFORE any test module is imported, so environment variables set here
 * are visible to Prisma, BullMQ, and all NestJS modules.
 *
 * This file is referenced by jest-e2e.json → "setupFiles".
 */

import { resolve, join } from 'path';

// ---------------------------------------------------------------------------
// Database – use the dedicated test SQLite file (absolute path for Prisma)
// ---------------------------------------------------------------------------
const backendRoot = resolve(__dirname, '..');
const dbAbsPath = resolve(backendRoot, 'prisma', 'test.db');
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? `file:${dbAbsPath}`;

// ---------------------------------------------------------------------------
// Adapters – use mocks so no real Stellar keys or RPC URLs are needed
// ---------------------------------------------------------------------------
process.env.ONCHAIN_ADAPTER = 'mock';
process.env.VERIFICATION_MODE = 'mock';

// ---------------------------------------------------------------------------
// Redis – BullMQ will attempt to connect; if Redis is unavailable the queue
// operations gracefully degrade (counts return 0).  Tests that exercise
// queue endpoints are written to tolerate this.
// ---------------------------------------------------------------------------
process.env.REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT ?? '6379';

// ---------------------------------------------------------------------------
// Auth – a well-known dev key so tests don't need a real API_KEY secret.
// The harness seeds this key into the DB after app init.
// ---------------------------------------------------------------------------
process.env.API_KEY = process.env.API_KEY ?? 'e2e-test-admin-key';

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------
process.env.NODE_ENV = 'test';
// Suppress Stellar RPC health-check failures in CI
process.env.HEALTHCHECK_STELLAR_REQUIRED = 'false';
