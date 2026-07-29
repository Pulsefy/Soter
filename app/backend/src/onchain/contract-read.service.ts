import { Injectable, Inject, Logger } from '@nestjs/common';
import { ONCHAIN_ADAPTER_TOKEN, OnchainAdapter } from './onchain.adapter';

export interface ContractReadAdapter {
  getContractMetadata(): Promise<OnChainMetadata>;
  getPauseState(): Promise<OnChainPauseState>;
  getFeeConfig(): Promise<OnChainFeeConfig>;
  getAidPackageCount(tokenAddress?: string): Promise<OnChainAggregates>;
}

export interface OnChainMetadata {
  version: string;
  name: string;
  timestamp: Date;
}

export interface OnChainPauseState {
  isPaused: boolean;
  timestamp: Date;
}

export interface OnChainFeeConfig {
  feePercentage: string;
  maxFee: string;
  timestamp: Date;
}

export interface OnChainAggregates {
  totalCommitted: string;
  totalClaimed: string;
  totalExpiredCancelled: string;
}

@Injectable()
export class ContractReadServiceImpl implements ContractReadAdapter {
  private readonly logger = new Logger(ContractReadServiceImpl.name);

  constructor(
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
  ) {}

  async getContractMetadata(): Promise<OnChainMetadata> {
    const metadata = await this.onchainAdapter.getContractMetadata();
    return {
      version: metadata.version,
      name: metadata.name,
      timestamp: metadata.timestamp,
    };
  }

  async getPauseState(): Promise<OnChainPauseState> {
    const pauseState = await this.onchainAdapter.getPauseState();
    return {
      isPaused: pauseState.isPaused,
      timestamp: pauseState.timestamp,
    };
  }

  async getFeeConfig(): Promise<OnChainFeeConfig> {
    const feeConfig = await this.onchainAdapter.getFeeConfig();
    return {
      feePercentage: feeConfig.feePercentage,
      maxFee: feeConfig.maxFee,
      timestamp: feeConfig.timestamp,
    };
  }

  async getAidPackageCount(tokenAddress?: string): Promise<OnChainAggregates> {
    const result = await this.onchainAdapter.getAidPackageCount({
      token: tokenAddress ?? 'STELLAR_TEST_TOKEN',
    });
    return {
      totalCommitted: result.aggregates.totalCommitted,
      totalClaimed: result.aggregates.totalClaimed,
      totalExpiredCancelled: result.aggregates.totalExpiredCancelled,
    };
  }
}
