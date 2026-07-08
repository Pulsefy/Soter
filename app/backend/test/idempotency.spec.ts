import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

import { IdempotencyStore } from '../src/idempotency/store';
import { idempotencyMiddleware } from '../src/idempotency/middleware';
import { submitTransaction } from '../src/handlers/transaction';
import { RequestFingerprint } from '../src/idempotency/fingerprint';

// Create a unique test database name
const testDbName = `soter_test_${uuidv4().slice(0, 8)}`;

// Use proper connection string format
const DEFAULT_USER = 'postgres';
const DEFAULT_PASSWORD = 'postgres';
const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = '5432';
const DEFAULT_DATABASE = 'postgres';

// Build connection string properly
function buildConnectionString(params: {
  user?: string;
  password?: string;
  host?: string;
  port?: string;
  database?: string;
}): string {
  const {
    user = DEFAULT_USER,
    password = DEFAULT_PASSWORD,
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
    database = DEFAULT_DATABASE,
  } = params;

  // Ensure password is present
  if (!password || password.trim() === '') {
    throw new Error('Password cannot be empty. Please set a valid password.');
  }

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

// Try to get connection string from env or use default
let baseUrl: string;
try {
  if (process.env.DATABASE_URL) {
    // Validate that the connection string has a password

    const hasPassword = /:\/\/[^:]+:[^@]+@/.test(process.env.DATABASE_URL);
    if (!hasPassword) {
      console.warn(
        '⚠️ DATABASE_URL is missing a password. Using default connection string.',
      );
      baseUrl = buildConnectionString({});
    } else {
      baseUrl = process.env.DATABASE_URL;
    }
  } else {
    baseUrl = buildConnectionString({});
  }
} catch (error) {
  console.warn('⚠️ Error building connection string:', error.message);
  baseUrl = buildConnectionString({});
}

const testDbUrl = baseUrl.replace(/\/[^/]+$/, `/${testDbName}`);

let pool: Pool;
let store: IdempotencyStore;
let app: express.Application;

// Check if we should run the tests (skip if no database)
let hasValidDatabase = false;

/**
 * Test database connection with retry logic
 */
async function testDatabaseConnection(
  connectionString: string,
): Promise<boolean> {
  let testPool: Pool | null = null;
  try {
    testPool = new Pool({
      connectionString,
      max: 1,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 5000,
    });
    await testPool.query('SELECT 1');
    return true;
  } catch (error) {
    console.warn(`⚠️ Cannot connect to database: ${error.message}`);
    return false;
  } finally {
    if (testPool) {
      await testPool.end().catch(() => {});
    }
  }
}

/**
 * Create a test database with retry logic
 */
async function createTestDatabase(
  adminPool: Pool,
  dbName: string,
): Promise<void> {
  try {
    // Check if database already exists
    const result = await adminPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );

    if (result.rows.length === 0) {
      await adminPool.query(`CREATE DATABASE ${dbName}`);
    } else {
      // Drop and recreate to ensure clean state
      await adminPool.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await adminPool.query(`CREATE DATABASE ${dbName}`);
    }
  } catch (error) {
    console.warn(`⚠️ Failed to create test database ${dbName}:`, error.message);
    throw new Error(`Could not create test database: ${error.message}`);
  }
}

/**
 * Drop test database with error handling
 */
async function dropTestDatabase(
  adminPool: Pool,
  dbName: string,
): Promise<void> {
  try {
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName}`);
  } catch (error) {
    console.warn(`⚠️ Failed to drop test database ${dbName}:`, error.message);
  }
}

/**
 * Create idempotency records table
 */
async function createIdempotencyTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS idempotency_records (
      idempotency_key TEXT PRIMARY KEY,
      request_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      response_body BYTEA,
      response_status SMALLINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/**
 * Create express app with idempotency middleware
 */
function createTestApp(store: IdempotencyStore): express.Application {
  const app = express();
  app.use(express.json());
  app.post(
    '/v1/transactions/submit',
    idempotencyMiddleware(store),
    submitTransaction,
  );
  return app;
}

// Run beforeAll to check database connection and set hasValidDatabase
beforeAll(async () => {
  hasValidDatabase = await testDatabaseConnection(baseUrl);
  if (hasValidDatabase) {
    console.log(
      '✅ Database connection successful. Running integration tests.',
    );
  } else {
    console.log('⚠️ Database connection failed. Skipping integration tests.');
  }
}, 10000);

// Use describe or describe.skip based on database availability
(hasValidDatabase ? describe : describe.skip)(
  'Idempotency integration tests',
  () => {
    beforeAll(async () => {
      let adminPool: Pool | null = null;

      try {
        // Create admin connection
        adminPool = new Pool({
          connectionString: baseUrl,
          max: 2,
        });

        // Create test database
        await createTestDatabase(adminPool, testDbName);

        // Connect to the test database
        pool = new Pool({
          connectionString: testDbUrl,
          max: 5,
          idleTimeoutMillis: 10000,
        });

        // Create store
        store = new IdempotencyStore(pool);

        // Create table
        await createIdempotencyTable(pool);

        // Create app
        app = createTestApp(store);
      } catch (error) {
        console.error('❌ Failed to set up test database:', error.message);
        throw error;
      } finally {
        if (adminPool) {
          await adminPool.end();
        }
      }
    }, 30000);

    afterAll(async () => {
      let adminPool: Pool | null = null;

      try {
        // Clean up test data
        if (pool) {
          await pool.query('DROP TABLE IF EXISTS idempotency_records;');
          await pool.end();
        }

        // Drop test database
        if (baseUrl) {
          adminPool = new Pool({ connectionString: baseUrl });
          await dropTestDatabase(adminPool, testDbName);
        }
      } catch (error) {
        console.warn('⚠️ Error during test cleanup:', error.message);
      } finally {
        if (adminPool) {
          await adminPool.end();
        }
      }
    }, 30000);

    it('Missing key returns 400', async () => {
      const res = await request(app)
        .post('/v1/transactions/submit')
        .send({ transactionXdr: 'AAAAAAABLC0=' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing');
    });

    it('Invalid key returns 400', async () => {
      const res = await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', 'bad key!')
        .send({ transactionXdr: 'AAAAAAABLC0=' });

      expect(res.status).toBe(400);
    });

    it('First request succeeds', async () => {
      const res = await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', 'key-1')
        .send({ transactionXdr: 'AAAAAAABLC0=' });

      expect(res.status).toBe(200);
      expect(res.headers['x-idempotent-replayed']).toBeUndefined();
    });

    it('Duplicate request replays cached response', async () => {
      const res1 = await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', 'key-2')
        .send({ transactionXdr: 'AAAAAAABLC0=' });

      const res2 = await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', 'key-2')
        .send({ transactionXdr: 'AAAAAAABLC0=' });

      expect(res2.status).toBe(200);
      expect(res2.headers['x-idempotent-replayed']).toBe('true');
      expect(res2.body.hash).toEqual(res1.body.hash);
    });

    it('Mismatched body returns 409', async () => {
      await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', 'key-3')
        .send({ transactionXdr: 'AAAAAAABLC0=' });

      const res = await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', 'key-3')
        .send({ transactionXdr: 'B' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('fingerprint');
    });

    it('Processing record returns 409', async () => {
      const validBody = { transactionXdr: 'AAAAAAABLC0=' };
      const validFingerprint =
        RequestFingerprint.fromBody(validBody).asString();

      await pool.query(
        `
          INSERT INTO idempotency_records (
            idempotency_key,
            request_fingerprint,
            status
          )
          VALUES ($1, $2, 'processing')
        `,
        ['key-4', validFingerprint],
      );

      const res = await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', 'key-4')
        .send(validBody);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('processed');
    });

    it('GET /v1/transactions/:hash returns 404', async () => {
      const res = await request(app).get('/v1/transactions/some-hash');

      expect(res.status).toBe(404);
    });

    it('Handles request body with arrays for fingerprinting', async () => {
      const bodyWithArray = {
        transactionXdr: 'AAAA',
        args: [1, 2, 3],
      };

      const res = await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', 'key-array')
        .send(bodyWithArray);

      expect(res.status).toBe(200);
    });

    it('Too long key returns 400', async () => {
      const longKey = 'a'.repeat(129);

      const res = await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', longKey)
        .send({ transactionXdr: 'AAAAAAABLC0=' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('maximum length');
    });

    it('Cleanup deletes expired records', async () => {
      await pool.query(
        `
          INSERT INTO idempotency_records (
            idempotency_key,
            request_fingerprint,
            status,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            $2,
            'succeeded',
            now() - interval '48 hours',
            now() - interval '48 hours'
          )
        `,
        ['expired-key', 'fake-fingerprint'],
      );

      const deleted = await store.cleanup(24);

      expect(deleted).toBe(1);
    });
  },
);
