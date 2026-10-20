import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Gauge, Histogram } from 'prom-client';
import { Pool } from 'pg';
import { monitorPrismaPool } from './prisma-pool-metrics';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private connected = false;
  private readonly pool: Pool;

  constructor(
    @InjectMetric('prisma_pool_size')
    poolSizeGauge: Gauge<string>,
    @InjectMetric('prisma_pool_connections_in_use')
    poolConnectionsInUseGauge: Gauge<string>,
    @InjectMetric('prisma_pool_waiting_connections')
    poolWaitingConnectionsGauge: Gauge<string>,
    @InjectMetric('prisma_pool_wait_duration_seconds')
    poolWaitDuration: Histogram<string>,
  ) {
    const max = Number(process.env.DATABASE_POOL_MAX ?? 10);
    if (!Number.isSafeInteger(max) || max < 1) {
      throw new Error('DATABASE_POOL_MAX must be a positive integer');
    }
    let pool: Pool;
    super({
      adapter: new PrismaPg(
        (pool = new Pool({
          max,
          connectionString:
            process.env.DATABASE_URL ||
            'postgresql://soter_user:soter123@localhost:5432/soter_db',
        })),
        { disposeExternalPool: true },
      ),
    });
    this.pool = pool;
    monitorPrismaPool(pool, {
      size: poolSizeGauge,
      connectionsInUse: poolConnectionsInUseGauge,
      waitingConnections: poolWaitingConnectionsGauge,
      waitDuration: poolWaitDuration,
    });
  }

  async onModuleInit() {
    const isTest =
      process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
    const hasDatabaseUrl = !!process.env.DATABASE_URL;

    if (isTest && !hasDatabaseUrl) {
      return;
    }

    try {
      await this.$connect();
      this.connected = true;
    } catch (err) {
      this.connected = false;
      this.logger.error('Failed to connect on startup', err as Error);
    }
  }

  isConnected() {
    return this.connected;
  }

  async onModuleDestroy() {
    if (!this.connected) {
      await this.pool.end();
      return;
    }

    await this.$disconnect();
  }
}
