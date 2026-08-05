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

    // Notification Delivery Metrics (issue #716)
    @InjectMetric('notification_delivery_attempts_total')
    public notificationDeliveryAttemptsCounter: Counter<string>,
    @InjectMetric('notification_delivery_failures_by_category_total')
    public notificationDeliveryFailuresByCategoryCounter: Counter<string>,
    @InjectMetric('error_rate_total')
    public errorRateCounter: Counter<string>,
    @InjectMetric('analytics_cache_hits_total')
    public analyticsCacheHitsCounter: Counter<string>,
    @InjectMetric('analytics_cache_misses_total')
    public analyticsCacheMissesCounter: Counter<string>,
    @InjectMetric('analytics_cache_invalidations_total')
    public analyticsCacheInvalidationsCounter: Counter<string>,
    @InjectMetric('verification_jobs_enqueued_total')
    public verificationJobsEnqueuedCounter: Counter<string>,
    @InjectMetric('verification_queue_waiting_by_priority')
    public verificationQueueWaitingByPriorityGauge: Gauge<string>,

    // Claim funnel metrics
    @InjectMetric('claims_created_total')
    public claimsCreatedCounter: Counter<string>,
    @InjectMetric('claims_verified_total')
    public claimsVerifiedCounter: Counter<string>,
    @InjectMetric('claims_approved_total')
    public claimsApprovedCounter: Counter<string>,
    @InjectMetric('claims_disbursed_total')
    public claimsDisbursedCounter: Counter<string>,
    @InjectMetric('claims_cancelled_total')
    public claimsCancelledCounter: Counter<string>,
    @InjectMetric('claims_in_funnel')
    public claimsInFunnelGauge: Gauge<string>,
    @InjectMetric('claim_funnel_duration_seconds')
    public claimFunnelDuration: Histogram<string>,
  ) {}

  /**
   * Increment the counter tracking how many jobs have been enqueued per priority tier.
   * Call once per successful enqueue, passing the priority label (e.g. 'URGENT', 'NORMAL').
   */
  incrementVerificationJobEnqueued(priorityLabel: string): void {
    this.verificationJobsEnqueuedCounter.inc({ priority: priorityLabel });
  }

  /**
   * Set the current snapshot of waiting verification jobs per priority tier.
   * Call after getQueueMetrics to keep the gauge in sync.
   */
  setVerificationQueueWaitingByPriority(
    priorityLabel: string,
    count: number,
  ): void {
    this.verificationQueueWaitingByPriorityGauge.set(
      { priority: priorityLabel },
      count,
    );
  }

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
   * Records a notification delivery attempt outcome (issue #716).
   * Call once per attempt, for both success and failure.
   */
  incrementNotificationDeliveryAttempt(
    type: string,
    outcome: 'success' | 'failed',
  ): void {
    this.notificationDeliveryAttemptsCounter.inc({ type, outcome });
  }

  /**
   * Records a failed notification delivery attempt's bounded failure
   * category (see notification-failure-classifier.ts). Deliberately does
   * NOT accept raw error text as a label, unlike incrementCallbackFailure
   * above — category is a small fixed set, so this stays low-cardinality.
   */
  incrementNotificationDeliveryFailureByCategory(
    type: string,
    failureCategory: string,
  ): void {
    this.notificationDeliveryFailuresByCategoryCounter.inc({
      type,
      failure_category: failureCategory,
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
   * Increment the counter for claims created, labelled by campaign_id.
   */
  incrementClaimsCreated(campaignId: string): void {
    this.claimsCreatedCounter.inc({ campaign_id: campaignId });
  }

  /**
   * Increment the counter for claims that transitioned to verified.
   */
  incrementClaimsVerified(campaignId: string): void {
    this.claimsVerifiedCounter.inc({ campaign_id: campaignId });
  }

  /**
   * Increment the counter for claims that transitioned to approved.
   */
  incrementClaimsApproved(campaignId: string): void {
    this.claimsApprovedCounter.inc({ campaign_id: campaignId });
  }

  /**
   * Increment the counter for claims that transitioned to disbursed.
   */
  incrementClaimsDisbursed(campaignId: string, onchainEnabled: boolean): void {
    this.claimsDisbursedCounter.inc({
      campaign_id: campaignId,
      onchain_enabled: String(onchainEnabled),
    });
  }

  /**
   * Increment the counter for claims that were cancelled.
   */
  incrementClaimsCancelled(campaignId: string, fromStatus: string): void {
    this.claimsCancelledCounter.inc({
      campaign_id: campaignId,
      from_status: fromStatus,
    });
  }

  /**
   * Adjust the gauge tracking the current number of claims at a given funnel stage.
   * Increments (inc) when a claim enters the stage, decrements (dec) when it leaves.
   */
  adjustClaimsInFunnel(status: string, delta: 1 | -1): void {
    this.claimsInFunnelGauge.inc({ status }, delta);
  }

  /**
   * Set the absolute count of claims at a given funnel stage.
   * Used for periodic gauge refresh to correct drift from incremental updates.
   */
  setClaimsInFunnel(status: string, count: number): void {
    this.claimsInFunnelGauge.set({ status }, count);
  }

  /**
   * Record the duration in seconds a claim spent within a funnel stage before transitioning.
   */
  recordClaimFunnelDuration(
    fromStatus: string,
    toStatus: string,
    durationSeconds: number,
  ): void {
    this.claimFunnelDuration.observe(
      {
        from_status: fromStatus,
        to_status: toStatus,
      },
      durationSeconds,
    );
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
