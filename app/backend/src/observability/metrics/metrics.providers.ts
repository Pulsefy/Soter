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
];
