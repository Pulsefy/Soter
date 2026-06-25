import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { Pool } from 'pg';

import { IdempotencyStore } from '../src/idempotency/store';
import { idempotencyMiddleware } from '../src/idempotency/middleware';
import { submitTransaction } from '../src/handlers/transaction';
import { RequestFingerprint } from '../src/idempotency/fingerprint';

const hasDatabase = Boolean(process.env.DATABASE_URL);

let pool: Pool;
let store: IdempotencyStore;
let app: express.Application;

const validBody = { transactionXdr: 'AAAAAAABLC0=' };

(hasDatabase ? describe : describe.skip)(
  'Idempotency integration tests',
  () => {
    beforeAll(async () => {
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      });

      store = new IdempotencyStore(pool);

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

      app = express();

      app.use(express.json());

      app.post(
        '/v1/transactions/submit',
        idempotencyMiddleware(store),
        submitTransaction,
      );
    });

    afterAll(async () => {
      await pool.query('DROP TABLE IF EXISTS idempotency_records;');
      await pool.end();
    });

    it('Missing key returns 400', async () => {
      const res = await request(app)
        .post('/v1/transactions/submit')
        .send(validBody);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing');
    });

    it('Invalid key returns 400', async () => {
      const res = await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', 'bad key!')
        .send(validBody);

      expect(res.status).toBe(400);
    });

    it('First request succeeds', async () => {
      const res = await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', 'key-1')
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.headers['x-idempotent-replayed']).toBeUndefined();
    });

    it('Duplicate request replays cached response', async () => {
      const res1 = await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', 'key-2')
        .send(validBody);

      const res2 = await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', 'key-2')
        .send(validBody);

      expect(res2.status).toBe(200);
      expect(res2.headers['x-idempotent-replayed']).toBe('true');
      expect(res2.body.hash).toEqual(res1.body.hash);
    });

    it('Mismatched body returns 409', async () => {
      await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', 'key-3')
        .send(validBody);

      const res = await request(app)
        .post('/v1/transactions/submit')
        .set('Idempotency-Key', 'key-3')
        .send({ transactionXdr: 'B' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('fingerprint');
    });

    it('Processing record returns 409', async () => {
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
        .send(validBody);

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
