export interface IdempotencyRecord {
  body: any;
  statusCode: number;
  headers: Record<string, string | number | string[]>;
  fingerprint: string;
}

export interface IdempotencyRequest extends Express.Request {
  idempotency?: {
    key: string;
    cacheKey: string;
    fingerprint: string;
  };
}
