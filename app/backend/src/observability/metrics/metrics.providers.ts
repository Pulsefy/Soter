import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';

/**
 * Custom Prometheus metric providers
 */
export const metricsProviders = [
  // HTTP Metrics
  makeCounterProvider({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
  }),
  makeHistogramProvider({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  }),

  // Job Metrics
  makeCounterProvider({
    name: 'jobs_processed_total',
    help: 'Total number of jobs processed successfully',
    labelNames: ['job_type'],
  }),
  makeCounterProvider({
    name: 'jobs_failed_total',
    help: 'Total number of jobs that failed',
    labelNames: ['job_type'],
  }),

  // Connection Metrics
  makeGaugeProvider({
    name: 'active_connections',
    help: 'Number of active connections',
    labelNames: [],
  }),

  // Database Metrics
  makeHistogramProvider({
    name: 'db_query_duration_seconds',
    help: 'Duration of database queries in seconds',
    labelNames: ['operation'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  }),

  // On-chain Metrics
  makeCounterProvider({
    name: 'onchain_operations_total',
    help: 'Total number of on-chain operations',
    labelNames: ['operation', 'adapter', 'status'],
  }),
  makeHistogramProvider({
    name: 'onchain_operation_duration_seconds',
    help: 'Duration of on-chain operations in seconds',
    labelNames: ['operation', 'adapter'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  }),
  makeHistogramProvider({
    name: 'contract_call_latency_seconds',
    help: 'Latency of Testnet contract calls grouped by operation and status',
    labelNames: ['operation', 'status'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  }),
  makeCounterProvider({
    name: 'tx_submission_failures_total',
    help: 'Total number of Testnet transaction submission failures',
    labelNames: ['operation', 'reason'],
  }),

  // Ingestion Metrics
  makeGaugeProvider({
    name: 'ingestion_lag_seconds',
    help: 'Time lag between event creation and processing in seconds',
    labelNames: ['source'],
  }),

  // Webhook Metrics
  makeCounterProvider({
    name: 'webhook_retries_total',
    help: 'Total number of webhook delivery retries',
    labelNames: ['webhook_type', 'reason'],
  }),
  makeHistogramProvider({
    name: 'webhook_delivery_duration_seconds',
    help: 'Duration of webhook delivery attempts in seconds',
    labelNames: ['webhook_type'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  }),
  makeCounterProvider({
    name: 'callback_failures_total',
    help: 'Total number of callback or async processing failures',
    labelNames: ['callback_type', 'reason'],
  }),

  // Notification Delivery Metrics (issue #716)
  makeCounterProvider({
    name: 'notification_delivery_attempts_total',
    help: 'Total number of notification delivery attempts, labelled by type and outcome',
    labelNames: ['type', 'outcome'],
  }),
  makeCounterProvider({
    name: 'notification_delivery_failures_by_category_total',
    help: 'Total number of failed notification delivery attempts, labelled by type and a bounded failure category (not raw error text)',
    labelNames: ['type', 'failure_category'],
  }),

  // Error Rate Metrics
  makeCounterProvider({
    name: 'error_rate_total',
    help: 'Total number of errors across all systems',
    labelNames: [
      'method',
      'route',
      'status_code',
      'job_type',
      'operation',
      'adapter',
      'error_type',
    ],
  }),

  // Analytics Cache Metrics
  makeCounterProvider({
    name: 'analytics_cache_hits_total',
    help: 'Total number of analytics cache hits',
    labelNames: ['endpoint'],
  }),
  makeCounterProvider({
    name: 'analytics_cache_misses_total',
    help: 'Total number of analytics cache misses',
    labelNames: ['endpoint'],
  }),
  makeCounterProvider({
    name: 'analytics_cache_invalidations_total',
    help: 'Total number of analytics cache invalidations',
    labelNames: ['reason'],
  }),

  // Generic Response Cache Metrics (issue #702)
  makeCounterProvider({
    name: 'cache_hits_total',
    help: 'Total number of response cache hits, labelled by key group',
    labelNames: ['key_group'],
  }),
  makeCounterProvider({
    name: 'cache_misses_total',
    help: 'Total number of response cache misses, labelled by key group',
    labelNames: ['key_group'],
  }),
  makeCounterProvider({
    name: 'cache_invalidations_total',
    help: 'Total number of response cache invalidations, labelled by key group',
    labelNames: ['key_group'],
  }),
  makeGaugeProvider({
    name: 'cache_keys_total',
    help: 'Current number of Redis keys per cache key group',
    labelNames: ['key_group'],
  }),

  // Verification Priority Metrics
  makeCounterProvider({
    name: 'verification_jobs_enqueued_total',
    help: 'Total number of verification jobs enqueued, labelled by priority tier',
    labelNames: ['priority'],
  }),
  makeGaugeProvider({
    name: 'verification_queue_waiting_by_priority',
    help: 'Current number of waiting verification jobs by priority tier',
    labelNames: ['priority'],
  }),

  // Claim Funnel Metrics
  makeCounterProvider({
    name: 'claims_created_total',
    help: 'Total number of claims created',
    labelNames: ['campaign_id'],
  }),
  makeCounterProvider({
    name: 'claims_verified_total',
    help: 'Total number of claims verified',
    labelNames: ['campaign_id'],
  }),
  makeCounterProvider({
    name: 'claims_approved_total',
    help: 'Total number of claims approved',
    labelNames: ['campaign_id'],
  }),
  makeCounterProvider({
    name: 'claims_disbursed_total',
    help: 'Total number of claims disbursed',
    labelNames: ['campaign_id', 'onchain_enabled'],
  }),
  makeCounterProvider({
    name: 'claims_cancelled_total',
    help: 'Total number of claims cancelled',
    labelNames: ['campaign_id', 'from_status'],
  }),
  makeGaugeProvider({
    name: 'claims_in_funnel',
    help: 'Current number of claims at each funnel stage',
    labelNames: ['status'],
  }),
  makeHistogramProvider({
    name: 'claim_funnel_duration_seconds',
    help: 'Time spent within each claim funnel stage before transitioning',
    labelNames: ['from_status', 'to_status'],
    buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 86400],
  }),

  // Entity Link Review Queue Metrics (issue #949)
  makeGaugeProvider({
    name: 'entity_link_review_queue_depth',
    help: 'Current number of entity links awaiting review, by entity type',
    labelNames: ['entity_type'],
  }),
  makeCounterProvider({
    name: 'entity_link_review_decisions_total',
    help: 'Total number of entity link review decisions made, by decision type',
    labelNames: ['decision'],
  }),
  makeHistogramProvider({
    name: 'entity_link_review_duration_seconds',
    help: 'Time a link spent in the review queue before a reviewer decided it',
    labelNames: ['decision'],
    buckets: [60, 300, 900, 3600, 14400, 86400, 259200, 604800],
  }),

  // API Key Rate Limit Metrics (issue #952)
  makeCounterProvider({
    name: 'api_key_rate_limit_rejections_total',
    help: 'Total number of per-API-key rate limit rejections',
    labelNames: ['scope', 'api_key_id'],
  }),
];
