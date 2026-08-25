import { Pool } from 'pg';
import { IdempotencyKey } from './key';
import { RequestFingerprint } from './fingerprint';

export type RecordStatus = 'processing' | 'succeeded' | 'failed';

export interface IdempotencyRecord {
  idempotencyKey: string;
  requestFingerprint: string;
  status: RecordStatus;
  responseBody: Buffer | null;
  responseStatus: number | null;
}

export class IdempotencyStore {
  private pool: Pool;
  private readonly retentionMs: number;

  constructor(pool: Pool, retentionMs = 30 * 24 * 60 * 60 * 1000) {
    this.pool = pool;
    this.retentionMs = retentionMs;
  }

  public async tryAcquire(
    key: IdempotencyKey,
    fingerprint: RequestFingerprint,
  ): Promise<IdempotencyRecord | undefined> {
    const expiresAt = new Date(Date.now() + this.retentionMs);
    const insertResult = await this.pool.query(
      `INSERT INTO idempotency_records (idempotency_key, request_fingerprint, status, expires_at)
           VALUES ($1, $2, 'processing', $3)
       ON CONFLICT (idempotency_key) DO UPDATE
           SET request_fingerprint = EXCLUDED.request_fingerprint,
               status = 'processing',
               response_body = NULL,
               response_status = NULL,
               expires_at = EXCLUDED.expires_at
           WHERE idempotency_records.expires_at < now()
       RETURNING idempotency_key`,
      [key.asString(), fingerprint.asString(), expiresAt],
    );

    if (insertResult.rows.length > 0) {
      return undefined;
    }

    const { rows } = await this.pool.query(
      `SELECT idempotency_key, request_fingerprint, status, response_body, response_status
           FROM idempotency_records WHERE idempotency_key = $1`,
      [key.asString()],
    );

    const row = rows[0];
    return {
      idempotencyKey: row.idempotency_key,
      requestFingerprint: row.request_fingerprint,
      status: row.status,
      responseBody: row.response_body,
      responseStatus: row.response_status,
    };
  }

  public async complete(
    key: IdempotencyKey,
    status: RecordStatus,
    responseStatus: number,
    responseBody: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE idempotency_records
           SET status = $2, response_status = $3, response_body = $4, updated_at = now()
           WHERE idempotency_key = $1`,
      [key.asString(), status, responseStatus, Buffer.from(responseBody)],
    );
  }

  public async cleanup(batchSize: number, maxExpiry: Date = new Date()): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM idempotency_records
       WHERE idempotency_key IN ([
         SELECT idempotency_key FROM idempotency_records
         WHERE expires_at < $1
         ORDER BY expires_at
         LIMIT $2
       )]`,
      [maxExpiry, batchSize],
    );
    return result.rowCount ?? 0;
  }
}