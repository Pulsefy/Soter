import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram, Gauge } from 'prom-client';

export type CacheResult = 'hit' | 'miss';

@Injectable()
export class MetricsService {
  // Dynamic metrics storage for Soroban transaction lifecycle tracking
  private sorobanTransactionLatency?: Histogram<string>;
  private readonly dynamicCounters = new Map<string, Counter<string>>();
  private readonly dynamicGauges = new Map<string, Gauge<string>>();
  private readonly dynamicHistograms = new Map<string, Histogram<string>>();

  constructor(
    @InjectMetric('http_requests_total')
    public httpRequestsCounter: Counter<string>,
    @InjectMetric('http_request_duration_seconds')
    public httpRequestDuration: Histogram<string>,
    @InjectMetric('jobs_processed_total')
    public jobsProcessedCounter: Counter<string>,
    @InjectMetric('jobs_failed_total')
    public jobsFailedCounter: Counter<string>,
    @InjectMetric('active_connections')
    public activeConnectionsGauge: Gauge<string>,
    @InjectMetric('db_query_duration_seconds')
    public dbQueryDuration: Histogram<string>,
    @InjectMetric('onchain_operations_total')
    public onchainOperationsCounter: Counter<string>,
    @InjectMetric('onchain_operation_duration_seconds')
    public onchainOperationDuration: Histogram<string>,
    @InjectMetric('contract_call_latency_seconds')
    public contractCallLatency: Histogram<string>,
    @InjectMetric('tx_submission_failures_total')
    public txSubmissionFailuresCounter: Counter<string>,
    @InjectMetric('ingestion_lag_seconds')
    public ingestionLagGauge: Gauge<string>,
    @InjectMetric('webhook_retries_total')
    public webhookRetriesCounter: Counter<string>,
    @InjectMetric('webhook_delivery_duration_seconds')
    public webhookDeliveryDuration: Histogram<string>,
    @InjectMetric('callback_failures_total')
    public callbackFailuresCounter: Counter<string>,
    @InjectMetric('error_rate_total')
    public errorRateCounter: Counter<string>,
    @InjectMetric('analytics_cache_hits_total')
    public analyticsCacheHitsCounter: Counter<string>,
    @InjectMetric('analytics_cache_misses_total')
    public analyticsCacheMissesCounter: Counter<string>,
    @InjectMetric('analytics_cache_invalidations_total')
    public analyticsCacheInvalidationsCounter: Counter<string>,
  ) {}

  /**
   * Increment HTTP request counter
   */
  incrementHttpRequest(
    method: string,
    route: string,
    statusCode: number,
  ): void {
    this.httpRequestsCounter.inc({
      method,
      route,
      status_code: statusCode.toString(),
    });

    // Track error rate
    if (statusCode >= 400) {
      this.errorRateCounter.inc({
        method,
        route,
        status_code: statusCode.toString(),
      });
    }
  }

  /**
   * Record HTTP request duration
   */
  recordHttpDuration(method: string, route: string, duration: number): void {
    this.httpRequestDuration.observe(
      {
        method,
        route,
      },
      duration,
    );
  }

  /**
   * Increment jobs processed counter
   */
  incrementJobsProcessed(jobType: string, status: 'success' | 'failed'): void {
    if (status === 'success') {
      this.jobsProcessedCounter.inc({ job_type: jobType });
    } else {
      this.jobsFailedCounter.inc({ job_type: jobType });
      this.errorRateCounter.inc({
        job_type: jobType,
        error_type: 'job_failure',
      });
    }
  }

  /**
   * Set active connections gauge
   */
  setActiveConnections(count: number): void {
    this.activeConnectionsGauge.set(count);
  }

  /**
   * Record database query duration
   */
  recordDbQueryDuration(operation: string, duration: number): void {
    this.dbQueryDuration.observe(
      {
        operation,
      },
      duration,
    );
  }

  /**
   * Increment on-chain operation counter
   */
  incrementOnchainOperation(
    operation: string,
    adapter: string,
    status: 'success' | 'failed',
  ): void {
    this.onchainOperationsCounter.inc({
      operation,
      adapter,
      status,
    });

    if (status === 'failed') {
      this.errorRateCounter.inc({
        operation,
        adapter,
        error_type: 'onchain_failure',
      });
    }
  }

  /**
   * Record on-chain operation duration
   */
  recordOnchainDuration(
    operation: string,
    adapter: string,
    duration: number,
  ): void {
    this.onchainOperationDuration.observe(
      {
        operation,
        adapter,
      },
      duration,
    );
  }

  recordContractCallLatency(
    operation: string,
    status: 'success' | 'failed',
    durationSeconds: number,
  ): void {
    this.contractCallLatency.observe({ operation, status }, durationSeconds);
  }

  incrementTxSubmissionFailure(operation: string, reason: string): void {
    this.txSubmissionFailuresCounter.inc({
      operation,
      reason: reason.slice(0, 80),
    });
  }

  /**
   * Set ingestion lag gauge (time between event creation and processing)
   */
  setIngestionLag(source: string, lagSeconds: number): void {
    this.ingestionLagGauge.set({ source }, lagSeconds);
  }

  /**
   * Increment webhook retry counter
   */
  incrementWebhookRetry(webhookType: string, reason: string): void {
    this.webhookRetriesCounter.inc({
      webhook_type: webhookType,
      reason,
    });
  }

  /**
   * Record webhook delivery duration
   */
  recordWebhookDeliveryDuration(webhookType: string, duration: number): void {
    this.webhookDeliveryDuration.observe(
      {
        webhook_type: webhookType,
      },
      duration,
    );
  }

  incrementCallbackFailure(callbackType: string, reason: string): void {
    this.callbackFailuresCounter.inc({
      callback_type: callbackType,
      reason: reason.slice(0, 80),
    });
  }

  /**
   * Record an analytics cache hit or miss.
   */
  recordAnalyticsCacheResult(endpoint: string, result: CacheResult): void {
    if (result === 'hit') {
      this.analyticsCacheHitsCounter.inc({ endpoint });
    } else {
      this.analyticsCacheMissesCounter.inc({ endpoint });
    }
  }

  /**
   * Increment the analytics cache invalidation counter.
   */
  incrementAnalyticsCacheInvalidation(reason: string): void {
    this.analyticsCacheInvalidationsCounter.inc({ reason });
  }

  /**
   * Record Soroban transaction latency with comprehensive status tracking
   */
  recordSorobanTransactionLatency(
    operation: string,
    status: 'success' | 'failed',
    duration: number,
  ): void {
    // Create dynamic histogram if it doesn't exist
    if (!this.sorobanTransactionLatency) {
      this.sorobanTransactionLatency = new Histogram({
        name: 'soroban_transaction_duration_seconds',
        help: 'Duration of Soroban transaction operations with lifecycle tracking',
        labelNames: ['operation', 'status'],
        buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
      });
    }

    this.sorobanTransactionLatency.observe(
      {
        operation,
        status,
      },
      duration,
    );
  }

  /**
   * Increment counter with dynamic labels for flexible metrics
   */
  incrementCounter(name: string, labels?: Record<string, string>): void {
    if (!this.dynamicCounters.has(name)) {
      this.dynamicCounters.set(
        name,
        new Counter({
          name,
          help: `Counter for ${name}`,
          labelNames: labels ? Object.keys(labels) : [],
        }),
      );
    }

    const counter = this.dynamicCounters.get(name)!;
    counter.inc(labels || {});
  }

  /**
   * Set gauge value with dynamic labels for monitoring
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    if (!this.dynamicGauges.has(name)) {
      this.dynamicGauges.set(
        name,
        new Gauge({
          name,
          help: `Gauge for ${name}`,
          labelNames: labels ? Object.keys(labels) : [],
        }),
      );
    }

    const gauge = this.dynamicGauges.get(name)!;
    if (labels) {
      gauge.set(labels, value);
    } else {
      gauge.set(value);
    }
  }

  /**
   * Record histogram metrics for duration tracking
   */
  recordHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
  ): void {
    const key = `${name}_histogram`;
    if (!this.dynamicHistograms.has(key)) {
      this.dynamicHistograms.set(
        key,
        new Histogram({
          name,
          help: `Histogram for ${name}`,
          labelNames: labels ? Object.keys(labels) : [],
          buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
        }),
      );
    }

    const histogram = this.dynamicHistograms.get(key)!;
    histogram.observe(labels || {}, value);
  }
}
