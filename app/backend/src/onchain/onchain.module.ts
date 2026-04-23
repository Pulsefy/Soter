import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { OnchainAdapter, ONCHAIN_ADAPTER_TOKEN } from './onchain.adapter';
export { ONCHAIN_ADAPTER_TOKEN };
import { MockOnchainAdapter } from './onchain.adapter.mock';
import { SorobanAdapter } from './soroban.adapter';
import { OnchainProcessor } from './onchain.processor';
import { OnchainService } from './onchain.service';
import { JobsModule } from '../jobs/jobs.module';

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
    BullModule.registerQueueAsync({
      name: 'onchain',
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST') || 'localhost',
          port: parseInt(configService.get<string>('REDIS_PORT') || '6379'),
        },
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 10000,
          },
          removeOnComplete: {
            count: 200,  // keep last 200 completed onchain jobs
            age: 86400,  // and no older than 24 h
          },
          removeOnFail: false, // keep all failed jobs for audit / DLQ inspection
        },
      }),
      inject: [ConfigService],
    }),
    // Import JobsModule to get access to DeadLetterService
    JobsModule,
  ],
  providers: [
    MockOnchainAdapter,
    SorobanAdapter,
    onchainAdapterProvider,
    OnchainProcessor,
    OnchainService,
  ],
  exports: [ONCHAIN_ADAPTER_TOKEN, OnchainService],
})
export class OnchainModule {}
