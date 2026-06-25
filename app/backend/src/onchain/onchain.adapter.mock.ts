import { Injectable } from '@nestjs/common';
import {
  OnchainAdapter,
  InitEscrowParams,
  InitEscrowResult,
  CreateClaimParams,
  CreateClaimResult,
  DisburseParams,
  DisburseResult,
  CreateAidPackageParams,
  CreateAidPackageResult,
  BatchCreateAidPackagesParams,
  BatchCreateAidPackagesResult,
  ClaimAidPackageParams,
  ClaimAidPackageResult,
  DisburseAidPackageParams,
  DisburseAidPackageResult,
  GetAidPackageParams,
  GetAidPackageResult,
  GetAidPackageCountParams,
  GetAidPackageCountResult,
  AidPackage,
  GetTokenBalanceParams,
  GetTokenBalanceResult,
  ContractMetadata,
  PauseState,
  FeeConfig,
  PackageSummary,
  GetTransactionStatusParams,
  GetTransactionStatusResult,
  TxStatus,
} from './onchain.adapter';
import { createHash } from 'crypto';

/**
 * Mock implementation of OnchainAdapter for development and testing
 * Returns deterministic responses based on input parameters
 */
@Injectable()
export class MockOnchainAdapter implements OnchainAdapter {
  private readonly mockEscrowAddress =
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  /**
   * Generate a deterministic mock transaction hash from input
   */
  private generateMockHash(input: string): string {
    const hash = createHash('sha256').update(input).digest('hex');
    // Format as Stellar/Soroban transaction hash (64 hex chars)
    return hash.substring(0, 64).toUpperCase();
  }

  /**
   * Generate a deterministic package ID from package ID string
   */
  private generatePackageId(packageId: string): string {
    const hash = createHash('sha256')
      .update(`package-${packageId}`)
      .digest('hex');
    // Convert first 16 hex chars to decimal for package ID
    return BigInt('0x' + hash.substring(0, 16)).toString();
  }

  async initEscrow(params: InitEscrowParams): Promise<InitEscrowResult> {
    await Promise.resolve();
    const transactionHash = this.generateMockHash(
      `init-${params.adminAddress}-${Date.now()}`,
    );

    return {
      escrowAddress: this.mockEscrowAddress,
      transactionHash,
      timestamp: new Date(),
      status: 'success',
      metadata: {
        adminAddress: params.adminAddress,
        adapter: 'mock',
      },
    };
  }

  async createAidPackage(
    params: CreateAidPackageParams,
  ): Promise<CreateAidPackageResult> {
    await Promise.resolve();
    const transactionHash = this.generateMockHash(
      `create-package-${params.packageId}-${Date.now()}`,
    );

    return {
      packageId: params.packageId,
      transactionHash,
      timestamp: new Date(),
      status: 'success',
      metadata: {
        packageId: params.packageId,
        operatorAddress: params.operatorAddress,
        recipientAddress: params.recipientAddress,
        amount: params.amount,
        tokenAddress: params.tokenAddress,
        expiresAt: params.expiresAt,
        adapter: 'mock',
      },
    };
  }

  async batchCreateAidPackages(
    params: BatchCreateAidPackagesParams,
  ): Promise<BatchCreateAidPackagesResult> {
    await Promise.resolve();
    const packageIds = params.recipientAddresses.map((_, index) => `${index}`);
    const transactionHash = this.generateMockHash(
      `batch-create-${params.operatorAddress}-${Date.now()}`,
    );

    return {
      packageIds,
      transactionHash,
      timestamp: new Date(),
      status: 'success',
      metadata: {
        operatorAddress: params.operatorAddress,
        count: params.recipientAddresses.length,
        tokenAddress: params.tokenAddress,
        adapter: 'mock',
      },
    };
  }

  async claimAidPackage(
    params: ClaimAidPackageParams,
  ): Promise<ClaimAidPackageResult> {
    await Promise.resolve();
    const transactionHash = this.generateMockHash(
      `claim-package-${params.packageId}-${params.recipientAddress}-${Date.now()}`,
    );

    return {
      packageId: params.packageId,
      transactionHash,
      timestamp: new Date(),
      status: 'success',
      amountClaimed: '1000000000', // Mock amount
      metadata: {
        packageId: params.packageId,
        recipientAddress: params.recipientAddress,
        adapter: 'mock',
      },
    };
  }

  async disburseAidPackage(
    params: DisburseAidPackageParams,
  ): Promise<DisburseAidPackageResult> {
    await Promise.resolve();
    const transactionHash = this.generateMockHash(
      `disburse-package-${params.packageId}-${Date.now()}`,
    );

    return {
      packageId: params.packageId,
      transactionHash,
      timestamp: new Date(),
      status: 'success',
      amountDisbursed: '1000000000',
      metadata: {
        packageId: params.packageId,
        operatorAddress: params.operatorAddress,
        adapter: 'mock',
      },
    };
  }

  async getAidPackage(
    params: GetAidPackageParams,
  ): Promise<GetAidPackageResult> {
    await Promise.resolve();

    const mockPackage: AidPackage = {
      id: params.packageId,
      recipient: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
      amount: '1000000000',
      token: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
      status: 'Created',
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
      metadata: {
        campaign_ref: 'campaign-123',
      },
    };

    return {
      package: mockPackage,
      timestamp: new Date(),
    };
  }

  async getAidPackageCount(
    _params: GetAidPackageCountParams,
  ): Promise<GetAidPackageCountResult> {
    await Promise.resolve();

    return {
      aggregates: {
        totalCommitted: '5000000000',
        totalClaimed: '2000000000',
        totalExpiredCancelled: '500000000',
      },
      timestamp: new Date(),
    };
  }

  async getTokenBalance(
    params: GetTokenBalanceParams,
  ): Promise<GetTokenBalanceResult> {
    await Promise.resolve();

    // Generate deterministic mock balance based on token address
    const mockBalance = this.generateMockBalance(params.tokenAddress);

    return {
      tokenAddress: params.tokenAddress,
      accountAddress: params.accountAddress,
      balance: mockBalance,
      timestamp: new Date(),
    };
  }

  /**
   * Generate a deterministic mock balance from token address
   */
  private generateMockBalance(tokenAddress: string): string {
    const hash = createHash('sha256').update(tokenAddress).digest('hex');
    // Use first 10 hex chars to generate a balance between 0 and ~17B stroops
    const balanceValue = parseInt(hash.substring(0, 10), 16);
    return balanceValue.toString();
  }

  async getContractMetadata(): Promise<ContractMetadata> {
    await Promise.resolve();
    return {
      version: '1.0.0',
      name: 'Mock Contract',
      timestamp: new Date(),
    };
  }

  async getPauseState(): Promise<PauseState> {
    await Promise.resolve();
    return {
      isPaused: false,
      timestamp: new Date(),
    };
  }

  async getFeeConfig(): Promise<FeeConfig> {
    await Promise.resolve();
    return {
      feePercentage: '0',
      maxFee: '0',
      timestamp: new Date(),
    };
  }

  async getPackageSummary(packageId: string): Promise<PackageSummary> {
    await Promise.resolve();
    return {
      packageId,
      totalAmount: '0',
      claimedAmount: '0',
      status: 'Active',
      timestamp: new Date(),
    };
  }

  async getTransactionStatus(
    params: GetTransactionStatusParams,
  ): Promise<GetTransactionStatusResult> {
    await Promise.resolve();
    const hash = params.hash.toUpperCase();

    // Deterministically map hash prefix to a status for predictable tests
    const firstChar = hash.charAt(0);
    let status: TxStatus;
    if (firstChar >= '0' && firstChar <= '7') {
      status = 'succeeded';
    } else if (firstChar >= '8' && firstChar <= 'B') {
      status = 'pending';
    } else if (firstChar >= 'C' && firstChar <= 'D') {
      status = 'failed';
    } else {
      status = 'unknown';
    }

    return {
      hash,
      status,
      timestamp: new Date(),
      ledger: status === 'succeeded' ? 12345 : undefined,
      errorMessage:
        status === 'failed' ? 'Mock contract transaction failed' : undefined,
    };
  }

  // Legacy methods for backward compatibility
  async createClaim(params: CreateClaimParams): Promise<CreateClaimResult> {
    await Promise.resolve();
    const packageId = this.generatePackageId(params.claimId);
    const transactionHash = this.generateMockHash(
      `create-${params.claimId}-${packageId}-${Date.now()}`,
    );

    return {
      packageId,
      transactionHash,
      timestamp: new Date(),
      status: 'success',
      metadata: {
        claimId: params.claimId,
        recipientAddress: params.recipientAddress,
        amount: params.amount,
        tokenAddress: params.tokenAddress,
        expiresAt: params.expiresAt,
        adapter: 'mock',
      },
    };
  }

  async disburse(params: DisburseParams): Promise<DisburseResult> {
    await Promise.resolve();
    const transactionHash = this.generateMockHash(
      `disburse-${params.claimId}-${params.packageId}-${Date.now()}`,
    );

    // Use provided amount or default to a mock value
    const amountDisbursed = params.amount || '1000000000'; // 1000.0000000 in stroops

    return {
      transactionHash,
      timestamp: new Date(),
      status: 'success',
      amountDisbursed,
      metadata: {
        claimId: params.claimId,
        packageId: params.packageId,
        recipientAddress: params.recipientAddress,
        adapter: 'mock',
      },
    };
  }
}
