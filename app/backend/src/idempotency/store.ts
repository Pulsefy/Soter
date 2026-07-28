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

  constructor(pool: Pool) {
    this.pool = pool;
  }

  public async tryAcquire(
    key: IdempotencyKey,
    fingerprint: RequestFingerprint,
  ): Promise<IdempotencyRecord | undefined> {
    const insertResult = await this.pool.query(
      `INSERT INTO idempotency_records (idempotency_key, request_fingerprint, status)
           VALUES ($1, $2, 'processing')
               ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [key.asString(), fingerprint.asString()],
    );

    if (insertResult.rows.length > 0) {
      return undefined; // Fresh key — proceed!
    }

    // Key exists — fetch it
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

  public async cleanup(maxAgeHours: number): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM idempotency_records
           WHERE created_at < now() - ($1::int || ' hours')::interval`,
      [maxAgeHours],
    );
    return result.rowCount ?? 0;
  }
}
