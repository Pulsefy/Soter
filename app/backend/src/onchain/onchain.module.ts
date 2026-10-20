import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { OnchainAdapter, ONCHAIN_ADAPTER_TOKEN } from './onchain.adapter';
export { ONCHAIN_ADAPTER_TOKEN };
import { OnchainCircuitBreakerService } from './onchain-circuit-breaker.service';
import { MockOnchainAdapter } from './onchain.adapter.mock';
import { SorobanAdapter } from './soroban.adapter';
import { OnchainProcessor } from './onchain.processor';
import { OnchainService } from './onchain.service';
import { LedgerBackfillService } from './ledger-backfill.service';
import { LedgerReconciliationService } from './ledger-reconciliation.service';
import { LedgerReconciliationAlertService } from './ledger-reconciliation-alert.service';
import { LedgerAdminController } from './ledger-admin.controller';
import { AdminTransferController } from './admin-transfer.controller';
import { AdminTransferService } from './admin-transfer.service';
import { ActionPauseController } from './action-pause.controller';
import { ActionPauseService } from './action-pause.service';
import { StellarLedgerSource } from './stellar-ledger-source';
import { SurplusWithdrawalController } from './surplus-withdrawal.controller';
import { SurplusWithdrawalService } from './surplus-withdrawal.service';
import { JobsModule } from '../jobs/jobs.module';
import { LoggerModule } from '../logger/logger.module';
import { MetricsModule } from '../observability/metrics/metrics.module';
import { SorobanTransactionLifecycleService } from './soroban-transaction-lifecycle.service';
import { SorobanTransactionScheduler } from './soroban-transaction.scheduler';
import { SorobanTransactionProcessor } from './soroban-transaction.processor';
import { SorobanEventCorrelationService } from './soroban-event-correlation.service';
import { SorobanEventCorrelationScheduler } from './soroban-event-correlation.scheduler';
import { SorobanCorrelationTraceService } from './soroban-correlation-trace.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonServicesModule } from '../common/services/common-services.module';
import { NotificationsModule } from '../notifications/notifications.module';

const skipBackgroundJobs = process.env.SKIP_BACKGROUND_JOBS === 'true';

/**
 * Factory function to create the appropriate adapter based on configuration
 */
export const createOnchainAdapter = (
  configService: ConfigService,
  circuitBreaker?: OnchainCircuitBreakerService,
): OnchainAdapter => {
  const adapterType =
    configService.get<string>('ONCHAIN_ADAPTER')?.toLowerCase() || 'mock';

  switch (adapterType) {
    case 'mock':
      return new MockOnchainAdapter();
    case 'soroban': {
      const adapter = new SorobanAdapter(configService);
      return circuitBreaker ? circuitBreaker.protect(adapter) : adapter;
    }
    default:
      throw new Error(
        `Unknown ONCHAIN_ADAPTER: ${adapterType}. Supported values: mock, soroban`,
      );
  }
};

const onchainAdapterProvider: Provider = {
  provide: ONCHAIN_ADAPTER_TOKEN,
  useFactory: createOnchainAdapter,
  inject: [ConfigService, OnchainCircuitBreakerService],
};

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ...(skipBackgroundJobs
      ? []
      : [
          BullModule.registerQueueAsync({
            name: 'onchain',
            imports: [ConfigModule],
            useFactory: (configService: ConfigService) => ({
              connection: {
                host: configService.get<string>('REDIS_HOST') || 'localhost',
                port: parseInt(
                  configService.get<string>('REDIS_PORT') || '6379',
                ),
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
                port: parseInt(
                  configService.get<string>('REDIS_PORT') || '6379',
                ),
              },
            }),
            inject: [ConfigService],
          }),
        ]),
    ScheduleModule.forRoot(),
    JobsModule,
    LoggerModule,
    MetricsModule,
    CommonServicesModule,
    NotificationsModule,
  ],
  controllers: [
    LedgerAdminController,
    AdminTransferController,
    ActionPauseController,
    SurplusWithdrawalController,
  ],
  providers: [
    MockOnchainAdapter,
    SorobanAdapter,
    onchainAdapterProvider,
    OnchainCircuitBreakerService,
    OnchainProcessor,
    OnchainService,
    StellarLedgerSource,
    LedgerBackfillService,
    LedgerReconciliationService,
    LedgerReconciliationAlertService,
    SurplusWithdrawalService,
    AdminTransferService,
    ActionPauseService,
    SorobanTransactionLifecycleService,
    SorobanTransactionScheduler,
    SorobanTransactionProcessor,
    SorobanEventCorrelationService,
    SorobanEventCorrelationScheduler,
    SorobanCorrelationTraceService,
  ],
  exports: [
    ONCHAIN_ADAPTER_TOKEN,
    OnchainCircuitBreakerService,
    OnchainService,
    StellarLedgerSource,
    LedgerBackfillService,
    LedgerReconciliationService,
    LedgerReconciliationAlertService,
    SurplusWithdrawalService,
    SorobanTransactionLifecycleService,
    SorobanTransactionScheduler,
    SorobanEventCorrelationService,
    SorobanCorrelationTraceService,
  ],
})
export class OnchainModule {}
