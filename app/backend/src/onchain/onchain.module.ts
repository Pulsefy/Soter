import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { OnchainAdapter, ONCHAIN_ADAPTER_TOKEN } from './onchain.adapter';
export { ONCHAIN_ADAPTER_TOKEN };
import { MockOnchainAdapter } from './onchain.adapter.mock';
import { SorobanAdapter } from './soroban.adapter';
import { OnchainProcessor } from './onchain.processor';
import { OnchainService } from './onchain.service';
import { LedgerBackfillService } from './ledger-backfill.service';
import { LedgerReconciliationService } from './ledger-reconciliation.service';
import { LedgerAdminController } from './ledger-admin.controller';
import { JobsModule } from '../jobs/jobs.module';
import { LoggerModule } from '../logger/logger.module';
import { MetricsModule } from '../observability/metrics/metrics.module';
import { SorobanTransactionLifecycleService } from './soroban-transaction-lifecycle.service';
import { SorobanTransactionScheduler } from './soroban-transaction.scheduler';
import { SorobanTransactionProcessor } from './soroban-transaction.processor';
import { SorobanEventCorrelationService } from './soroban-event-correlation.service';
import { SorobanEventCorrelationScheduler } from './soroban-event-correlation.scheduler';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonServicesModule } from '../common/services/common-services.module';

/**
 * Factory function to create the appropriate adapter based on configuration
 */
export const createOnchainAdapter = (
  configService: ConfigService,
): OnchainAdapter => {
  const adapterType =
    configService.get<string>('ONCHAIN_ADAPTER')?.toLowerCase() || 'mock';

  switch (adapterType) {
    case 'mock':
      return new MockOnchainAdapter();
    case 'soroban':
      return new SorobanAdapter(configService);
    default:
      throw new Error(
        `Unknown ONCHAIN_ADAPTER: ${adapterType}. Supported values: mock, soroban`,
      );
  }
};

const onchainAdapterProvider: Provider = {
  provide: ONCHAIN_ADAPTER_TOKEN,
  useFactory: createOnchainAdapter,
  inject: [ConfigService],
};

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    BullModule.registerQueueAsync({
      name: 'onchain',
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST') || 'localhost',
          port: parseInt(configService.get<string>('REDIS_PORT') || '6379'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueueAsync({
      name: 'soroban-transactions',
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST') || 'localhost',
          port: parseInt(configService.get<string>('REDIS_PORT') || '6379'),
        },
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    JobsModule,
    LoggerModule,
    MetricsModule,
    CommonServicesModule,
  ],
  controllers: [LedgerAdminController],
  providers: [
    MockOnchainAdapter,
    SorobanAdapter,
    onchainAdapterProvider,
    OnchainProcessor,
    OnchainService,
    LedgerBackfillService,
    LedgerReconciliationService,
    SorobanTransactionLifecycleService,
    SorobanTransactionScheduler,
    SorobanTransactionProcessor,
    SorobanEventCorrelationService,
    SorobanEventCorrelationScheduler,
  ],
  exports: [
    ONCHAIN_ADAPTER_TOKEN,
    OnchainService,
    LedgerBackfillService,
    LedgerReconciliationService,
    SorobanTransactionLifecycleService,
    SorobanTransactionScheduler,
    SorobanEventCorrelationService,
  ],
})
export class OnchainModule {}
