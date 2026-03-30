import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { OnchainAdapter, ONCHAIN_ADAPTER_TOKEN } from './onchain.adapter';
export { ONCHAIN_ADAPTER_TOKEN };
import { MockOnchainAdapter } from './onchain.adapter.mock';
import { OnchainProcessor } from './onchain.processor';
import { OnchainService } from './onchain.service';

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
      // TODO: Implement SorobanOnchainAdapter when ready
      throw new Error(
        'Soroban adapter not yet implemented. Use ONCHAIN_ADAPTER=mock',
      );
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
            count: 100,
            age: 7 * 24 * 60 * 60,
          },
          removeOnFail: {
            count: 50,
            age: 7 * 24 * 60 * 60,
          },
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueueAsync({
      name: 'onchain-dead-letter',
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST') || 'localhost',
          port: parseInt(configService.get<string>('REDIS_PORT') || '6379'),
        },
        defaultJobOptions: {
          removeOnComplete: false,
          removeOnFail: false,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    MockOnchainAdapter,
    onchainAdapterProvider,
    OnchainProcessor,
    OnchainService,
  ],
  exports: [ONCHAIN_ADAPTER_TOKEN, OnchainService, BullModule],
})
export class OnchainModule {}
