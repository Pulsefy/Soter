import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram, Gauge } from 'prom-client';

@Injectable()
export class MetricsService {
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
}
