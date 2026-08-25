-- Add expiry column to idempotency_records
ALTER TABLE \"idempotency_records\" ADD COLUMN \"expires_at\" TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days');

-- Index for efficient purge queries
CREATE INDEX \"idempotency_records_expires_at_idx\" ON \"idempotency_records\" (\"expires_at\");