import { Injectable, Inject, Logger } from '@nestjs/common';
import { ONCHAIN_ADAPTER_TOKEN, OnchainAdapter } from './onchain.adapter';

export interface ContractReadAdapter {
  getContractMetadata(): Promise<OnChainMetadata>;
  getPauseState(): Promise<OnChainPauseState>;
  getFeeConfig(): Promise<OnChainFeeConfig>;
  getAidPackageCount(tokenAddress?: string): Promise<OnChainAggregates>;
  listRecipientPackages(
    recipientAddress: string,
    cursor: number,
    limit: number,
  ): Promise<RecipientPackagePage>;
  getRecipientPackageCount(recipientAddress: string): Promise<number>;
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

/** Maximum number of package IDs returned per page — mirrors MAX_PAGE_SIZE in the contract. */
export const MAX_PAGE_SIZE = 50;

/**
 * Result of a paginated `list_recipient_packages` call.
 */
export interface RecipientPackagePage {
  /** Package IDs belonging to the recipient on this page. */
  packageIds: string[];
  /** The cursor value to pass for the next page (equals `cursor + limit`). */
  nextCursor: number;
  /** Whether there may be more results (i.e. a full page was returned). */
  hasMore: boolean;
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

  async listRecipientPackages(
    recipientAddress: string,
    cursor: number = 0,
    limit: number = MAX_PAGE_SIZE,
  ): Promise<RecipientPackagePage> {
    const effectiveLimit = Math.min(Math.max(1, limit), MAX_PAGE_SIZE);
    const safeCursor = Math.max(0, cursor);

    if (
      typeof (this.onchainAdapter as any).listRecipientPackages === 'function'
    ) {
      const result = await (this.onchainAdapter as any).listRecipientPackages({
        recipientAddress,
        cursor: safeCursor,
        limit: effectiveLimit,
      });
      return {
        packageIds: result.packageIds ?? [],
        nextCursor: safeCursor + effectiveLimit,
        hasMore: (result.packageIds ?? []).length >= effectiveLimit,
      };
    }

    // Fallback: return empty page if adapter doesn't support direct querying
    this.logger.debug(
      `listRecipientPackages called for ${recipientAddress} (cursor=${safeCursor}, limit=${effectiveLimit})`,
    );
    return {
      packageIds: [],
      nextCursor: safeCursor + effectiveLimit,
      hasMore: false,
    };
  }

  async getRecipientPackageCount(recipientAddress: string): Promise<number> {
    if (
      typeof (this.onchainAdapter as any).getRecipientPackageCount ===
      'function'
    ) {
      const result = await (
        this.onchainAdapter as any
      ).getRecipientPackageCount({
        recipientAddress,
      });
      return typeof result === 'number' ? result : (result?.count ?? 0);
    }

    this.logger.debug(
      `getRecipientPackageCount called for ${recipientAddress}`,
    );
    return 0;
  }
}
