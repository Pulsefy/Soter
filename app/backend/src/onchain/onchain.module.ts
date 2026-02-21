import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OnchainAdapter } from './onchain.adapter';
import { MockOnchainAdapter } from './onchain.adapter.mock';

export const ONCHAIN_ADAPTER_TOKEN = 'ONCHAIN_ADAPTER';

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
  imports: [ConfigModule],
  providers: [MockOnchainAdapter, onchainAdapterProvider],
  exports: [ONCHAIN_ADAPTER_TOKEN],
})
export class OnchainModule {}
