import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Counter } from 'prom-client';
import { IdempotencyStore } from './store';
import { LoggerService } from '../logger/logger.service';

const purgedCounter = new Counter({
  name: 'idempotency_records_purged_total',
  help: 'Total number of idempotency records purged by expiry cleanup',
  labelNames: ['batch'],
});

@Injectable()
export class IdempotencyExpiryProcessor {
  private readonly batchSize = 1000;

  constructor(
    private readonly store: IdempotencyStore,
    private readonly logger: LoggerService,
  ) {}

  @Cron('0 * * * *')
  async purgeExpired(): Promise<void> {
    const purged = await this.store.cleanup(this.batchSize);
    purgedCounter.inc({ batch: 'expired' }, purged);
    this.logger.log(
      {
        message: 'Purged expired idempotency records',
        purged,
        batchSize: this.batchSize,
      },
      'IdempotencyExpiryProcessor',
    );
  }
}