import { Test, TestingModule } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge } from 'prom-client';
import { MetricsService } from './metrics.service';

// All metric names injected via @InjectMetric in MetricsService's constructor.
// Most are irrelevant to the cache metrics under test here, so they're wired
// to inert stub objects; only the cache-related metrics use real prom-client
// instances so we can exercise real counting/aggregation behaviour.
const ALL_METRIC_NAMES = [
  'http_requests_total',
  'http_request_duration_seconds',
  'jobs_processed_total',
  'jobs_failed_total',
  'active_connections',
  'db_query_duration_seconds',
  'onchain_operations_total',
  'onchain_operation_duration_seconds',
  'contract_call_latency_seconds',
  'tx_submission_failures_total',
  'ingestion_lag_seconds',
  'webhook_retries_total',
  'webhook_delivery_duration_seconds',
  'callback_failures_total',
  'notification_delivery_attempts_total',
  'notification_delivery_failures_by_category_total',
  'error_rate_total',
  'analytics_cache_hits_total',
  'analytics_cache_misses_total',
  'analytics_cache_invalidations_total',
  'cache_hits_total',
  'cache_misses_total',
  'cache_invalidations_total',
  'cache_keys_total',
  'verification_jobs_enqueued_total',
  'verification_queue_waiting_by_priority',
  'claims_created_total',
  'claims_verified_total',
  'claims_approved_total',
  'claims_disbursed_total',
  'claims_cancelled_total',
  'claims_in_funnel',
  'claim_funnel_duration_seconds',
  'api_key_rate_limit_rejections_total',
];

const stubMetric = () => ({
  inc: jest.fn(),
  dec: jest.fn(),
  set: jest.fn(),
  observe: jest.fn(),
});

async function valueFor(
  metric: Counter<string> | Gauge<string>,
  keyGroup: string,
): Promise<number | undefined> {
  const data = await metric.get();
  return data.values.find(v => v.labels.key_group === keyGroup)?.value;
}

describe('MetricsService - cache metrics (issue #702)', () => {
  let service: MetricsService;
  let cacheHitsCounter: Counter<string>;
  let cacheMissesCounter: Counter<string>;
  let cacheInvalidationsCounter: Counter<string>;
  let cacheKeysGauge: Gauge<string>;

  beforeEach(async () => {
    // Real prom-client instances, kept out of the default global registry
    // so repeated test runs don't collide on metric name registration.
    cacheHitsCounter = new Counter({
      name: 'cache_hits_total',
      help: 'test',
      labelNames: ['key_group'],
      registers: [],
    });
    cacheMissesCounter = new Counter({
      name: 'cache_misses_total',
      help: 'test',
      labelNames: ['key_group'],
      registers: [],
    });
    cacheInvalidationsCounter = new Counter({
      name: 'cache_invalidations_total',
      help: 'test',
      labelNames: ['key_group'],
      registers: [],
    });
    cacheKeysGauge = new Gauge({
      name: 'cache_keys_total',
      help: 'test',
      labelNames: ['key_group'],
      registers: [],
    });

    const providers = ALL_METRIC_NAMES.map(name => {
      if (name === 'cache_hits_total') {
        return { provide: getToken(name), useValue: cacheHitsCounter };
      }
      if (name === 'cache_misses_total') {
        return { provide: getToken(name), useValue: cacheMissesCounter };
      }
      if (name === 'cache_invalidations_total') {
        return { provide: getToken(name), useValue: cacheInvalidationsCounter };
      }
      if (name === 'cache_keys_total') {
        return { provide: getToken(name), useValue: cacheKeysGauge };
      }
      return { provide: getToken(name), useValue: stubMetric() };
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService, ...providers],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
  });

  it('records cache hits and misses labelled by key group', async () => {
    service.recordCacheHit('verification');
    service.recordCacheHit('verification');
    service.recordCacheMiss('analytics');

    await expect(valueFor(cacheHitsCounter, 'verification')).resolves.toBe(2);
    await expect(valueFor(cacheMissesCounter, 'analytics')).resolves.toBe(1);
  });

  it('increments cache invalidations labelled by key group', async () => {
    service.incrementCacheInvalidation('user');
    service.incrementCacheInvalidation('user');
    service.incrementCacheInvalidation('all');

    await expect(valueFor(cacheInvalidationsCounter, 'user')).resolves.toBe(2);
    await expect(valueFor(cacheInvalidationsCounter, 'all')).resolves.toBe(1);
  });

  it('sets the Redis key health gauge per key group', async () => {
    service.setCacheKeyGroupSize('verification', 12);
    service.setCacheKeyGroupSize('total', 42);

    await expect(valueFor(cacheKeysGauge, 'verification')).resolves.toBe(12);
    await expect(valueFor(cacheKeysGauge, 'total')).resolves.toBe(42);
  });

  it('aggregates cumulative hits/misses/invalidations across all key groups', async () => {
    service.recordCacheHit('verification');
    service.recordCacheHit('analytics');
    service.recordCacheHit('analytics');
    service.recordCacheMiss('verification');
    service.incrementCacheInvalidation('user');
    service.incrementCacheInvalidation('transaction');

    await expect(service.getCacheHitsTotal()).resolves.toBe(3);
    await expect(service.getCacheMissesTotal()).resolves.toBe(1);
    await expect(service.getCacheInvalidationsTotal()).resolves.toBe(2);
  });

  it('returns zero totals when no cache activity has been recorded', async () => {
    await expect(service.getCacheHitsTotal()).resolves.toBe(0);
    await expect(service.getCacheMissesTotal()).resolves.toBe(0);
    await expect(service.getCacheInvalidationsTotal()).resolves.toBe(0);
  });
});
