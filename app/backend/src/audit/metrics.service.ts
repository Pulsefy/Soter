import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry = new Registry();

  public httpRequestDuration: Histogram<string>;
  public httpRequestsTotal: Counter<string>;
  public dbQueryDuration: Histogram<string>;
  public dbErrorsTotal: Counter<string>;

  constructor() {
    this.registry.setDefaultLabels({
      app: 'soter-backend',
    });
  }

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry });
    this.registerCustomMetrics();
  }

  private registerCustomMetrics() {
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.dbQueryDuration = new Histogram({
      name: 'db_query_duration_seconds',
      help: 'Duration of database queries in seconds',
      labelNames: ['operation', 'entity'],
      registers: [this.registry],
    });

    this.dbErrorsTotal = new Counter({
      name: 'db_errors_total',
      help: 'Total number of database query errors',
      labelNames: ['operation', 'entity'],
      registers: [this.registry],
    });
  }

  getMetrics() {
    return this.registry.metrics();
  }
}
