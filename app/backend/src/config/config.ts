import { registerAs } from 'nestj/config';

export default registerAs('config', () => ({
  aiWebhookSecret: process.env.AI_WEBHOOK_SECRET,
  idempotency: {
    retentionMs: parseInt(process.env.IDEMPOTENCY_RETENTION_MS ?? '8640000', 10),
    purgeBatchSize: parseInt(process.env.IDEMPOTENCY_PURGE_BATCH_SIZE ?? '1000', 10),
    purgeIntervalMs: parseInt(process.env.IDEMPOTENCY_PURGE_INTERVAL_MS ?? '3600000', 10),
  },
}));
