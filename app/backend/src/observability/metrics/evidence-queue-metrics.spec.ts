import { Test, TestingModule } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';
import { Gauge, Histogram } from 'prom-client';
import { MetricsService } from './metrics.service';

/**
 * All metric names injected into MetricsService via @InjectMetric.
 * Must stay in sync with the constructor parameter list.
 */
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
  'evidence_queue_depth',
  'evidence_queue_oldest_pending_age_seconds',
  'evidence_queue_intake_to_decision_seconds',
];

const stubMetric = () => ({
  inc: jest.fn(),
  dec: jest.fn(),
  set: jest.fn(),
  observe: jest.fn(),
});

describe('MetricsService – evidence queue SLA metrics (issue #954)', () => {
  let service: MetricsService;
  let depthGauge: Gauge<string>;
  let oldestAgeGauge: Gauge<string>;
  let intakeHistogram: Histogram<string>;

  beforeEach(async () => {
    // Real prom-client instances isolated from the global registry.
    depthGauge = new Gauge({
      name: 'evidence_queue_depth',
      help: 'test',
      labelNames: ['status'],
      registers: [],
    });
    oldestAgeGauge = new Gauge({
      name: 'evidence_queue_oldest_pending_age_seconds',
      help: 'test',
      labelNames: [],
      registers: [],
    });
    intakeHistogram = new Histogram({
      name: 'evidence_queue_intake_to_decision_seconds',
      help: 'test',
      labelNames: ['decision'],
      buckets: [60, 300, 900, 1800, 3600, 7200, 86400],
      registers: [],
    });

    const providers = ALL_METRIC_NAMES.map(name => {
      if (name === 'evidence_queue_depth')
        return { provide: getToken(name), useValue: depthGauge };
      if (name === 'evidence_queue_oldest_pending_age_seconds')
        return { provide: getToken(name), useValue: oldestAgeGauge };
      if (name === 'evidence_queue_intake_to_decision_seconds')
        return { provide: getToken(name), useValue: intakeHistogram };
      return { provide: getToken(name), useValue: stubMetric() };
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService, ...providers],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
  });

  // ─── setEvidenceQueueDepth ────────────────────────────────────────────────

  it('sets queue depth gauge for each status', async () => {
    service.setEvidenceQueueDepth('pending', 5);
    service.setEvidenceQueueDepth('uploading', 2);
    service.setEvidenceQueueDepth('completed', 10);
    service.setEvidenceQueueDepth('failed', 1);

    const data = await depthGauge.get();
    const byStatus = (status: string) =>
      data.values.find(v => v.labels.status === status)?.value;

    expect(byStatus('pending')).toBe(5);
    expect(byStatus('uploading')).toBe(2);
    expect(byStatus('completed')).toBe(10);
    expect(byStatus('failed')).toBe(1);
  });

  it('updates queue depth gauge to the latest value', async () => {
    service.setEvidenceQueueDepth('pending', 3);
    service.setEvidenceQueueDepth('pending', 7);

    const data = await depthGauge.get();
    const value = data.values.find(v => v.labels.status === 'pending')?.value;
    expect(value).toBe(7);
  });

  // ─── setEvidenceQueueOldestPendingAge ─────────────────────────────────────

  it('sets the oldest-pending-age gauge', async () => {
    service.setEvidenceQueueOldestPendingAge(120);

    const data = await oldestAgeGauge.get();
    expect(data.values[0]?.value).toBe(120);
  });

  it('sets oldest-pending-age to 0 when queue is empty', async () => {
    service.setEvidenceQueueOldestPendingAge(0);

    const data = await oldestAgeGauge.get();
    expect(data.values[0]?.value).toBe(0);
  });

  // ─── recordEvidenceIntakeToDecision ───────────────────────────────────────

  it('records completed decision in histogram', async () => {
    service.recordEvidenceIntakeToDecision('completed', 300);

    const data = await intakeHistogram.get();
    const completedSamples = data.values.filter(
      v => v.labels.decision === 'completed',
    );
    // At least one bucket should have been incremented
    const hasObservation = completedSamples.some(v => v.value > 0);
    expect(hasObservation).toBe(true);
  });

  it('records failed decision in histogram', async () => {
    service.recordEvidenceIntakeToDecision('failed', 600);

    const data = await intakeHistogram.get();
    const failedSamples = data.values.filter(
      v => v.labels.decision === 'failed',
    );
    const hasObservation = failedSamples.some(v => v.value > 0);
    expect(hasObservation).toBe(true);
  });

  it('keeps completed and failed observations independent', async () => {
    service.recordEvidenceIntakeToDecision('completed', 100);
    service.recordEvidenceIntakeToDecision('completed', 200);
    service.recordEvidenceIntakeToDecision('failed', 500);

    const data = await intakeHistogram.get();

    // _count for completed should be 2
    const completedCount = data.values.find(
      v =>
        v.labels.decision === 'completed' &&
        v.metricName === 'evidence_queue_intake_to_decision_seconds_count',
    );
    // _count for failed should be 1
    const failedCount = data.values.find(
      v =>
        v.labels.decision === 'failed' &&
        v.metricName === 'evidence_queue_intake_to_decision_seconds_count',
    );

    expect(completedCount?.value).toBe(2);
    expect(failedCount?.value).toBe(1);
  });
});
