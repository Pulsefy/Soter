import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
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
} from './onchain.adapter';
import { SorobanErrorMapper } from './utils/soroban-error.mapper';

interface SorobanSDK {
  SorobanRpc: {
    Server: new (url: string, options: { allowHttp: boolean }) => any;
  };
  [key: string]: any;
}

/**
 * Soroban adapter implementation for AidEscrow contract
 * Handles all interactions with the Soroban AidEscrow contract via RPC
 */
@Injectable()
export class SorobanAdapter implements OnchainAdapter {
  private readonly logger = new Logger(SorobanAdapter.name);
  private contractId: string;
  private rpcUrl: string;
  private networkPassphrase: string;
  private errorMapper: SorobanErrorMapper;

  // Note: The actual Soroban SDK will be lazily imported when needed
  // to avoid bundle size issues in development builds
  private sorobanLib: SorobanSDK | null = null;

  constructor(private configService: ConfigService) {
    this.contractId = this.configService.get<string>('SOROBAN_CONTRACT_ID', '');
    this.rpcUrl = this.configService.get<string>(
      'STELLAR_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );
    this.networkPassphrase = this.configService.get<string>(
      'STELLAR_NETWORK_PASSPHRASE',
      'Test SDF Network ; September 2015',
    );
    this.errorMapper = new SorobanErrorMapper();

    if (!this.contractId) {
      this.logger.warn(
        'SOROBAN_CONTRACT_ID not configured. SorobanAdapter will not function.',
      );
    }
  }

  private async loadSorobanSDK(): Promise<SorobanSDK> {
    if (this.sorobanLib) {
      return this.sorobanLib;
    }

    try {
      // Dynamically import stellar/cli SDK
      // @ts-expect-error - stellar is optional, only required in production
      const mod = (await import('stellar')) as unknown as SorobanSDK;
      this.sorobanLib = {
        rpc: mod,
        api: mod,
        SorobanRpc: mod.SorobanRpc,
        ...mod,
      };
      return this.sorobanLib;
    } catch (error) {
      this.logger.error('Failed to load Soroban SDK:', error);
      throw new Error(
        'Soroban SDK not available. Install: npm install stellar',
      );
    }
  }

  /**
   * Creates RPC client for contract calls
   */
  private async getRpcClient() {
    const sdk = await this.loadSorobanSDK();
    return new sdk.SorobanRpc.Server(this.rpcUrl, {
      allowHttp: this.rpcUrl.startsWith('http://'),
    });
  }

  /**
   * Validates that contract ID is configured
   */
  private ensureContractId(): void {
    if (!this.contractId) {
      throw new Error(
        'SOROBAN_CONTRACT_ID is not configured. Cannot proceed with contract calls.',
      );
    }
  }

  async initEscrow(params: InitEscrowParams): Promise<InitEscrowResult> {
    this.ensureContractId();
    this.logger.debug('Initializing escrow with admin:', params.adminAddress);

    try {
      const _sdk = await this.loadSorobanSDK();
      const _client = await this.getRpcClient();

      // Note: Actual implementation would require signing the transaction
      // with the contract owner's keypair and submitting to the network.
      // This is a simplified version showing the structure.

      const transactionHash = this.generateMockHash(
        `init-${params.adminAddress}-${Date.now()}`,
      );

      return {
        escrowAddress: this.contractId,
        transactionHash,
        timestamp: new Date(),
        status: 'success',
        metadata: {
          contractId: this.contractId,
          rpcUrl: this.rpcUrl,
        },
      };
    } catch (error) {
      const mappedError = this.errorMapper.mapError(error);
      this.logger.error('Failed to init escrow:', mappedError);
      throw error;
    }
  }

  async createAidPackage(
    params: CreateAidPackageParams,
  ): Promise<CreateAidPackageResult> {
    this.ensureContractId();
    this.logger.debug('Creating aid package:', {
      packageId: params.packageId,
      recipient: params.recipientAddress,
      amount: params.amount,
    });

    try {
      const _sdk = await this.loadSorobanSDK();
      const _client = await this.getRpcClient();

      // Implementation would call contract's create_package method
      // This is a placeholder showing the expected response

      const transactionHash = this.generateMockHash(
        `create-${params.packageId}-${Date.now()}`,
      );

      return {
        packageId: params.packageId,
        transactionHash,
        timestamp: new Date(),
        status: 'success',
        metadata: {
          contractId: this.contractId,
          operator: params.operatorAddress,
        },
      };
    } catch (error) {
      const mappedError = this.errorMapper.mapError(error);
      this.logger.error('Failed to create aid package:', mappedError);
      throw error;
    }
  }

  async batchCreateAidPackages(
    params: BatchCreateAidPackagesParams,
  ): Promise<BatchCreateAidPackagesResult> {
    this.ensureContractId();
    this.logger.debug('Creating batch aid packages:', {
      count: params.recipientAddresses.length,
      tokenAddress: params.tokenAddress,
    });

    try {
      const _sdk = await this.loadSorobanSDK();
      const _client = await this.getRpcClient();

      // Implementation would call contract's batch_create_packages method
      const packageIds = params.recipientAddresses.map((_, index) =>
        index.toString(),
      );
      const transactionHash = this.generateMockHash(`batch-${Date.now()}`);

      return {
        packageIds,
        transactionHash,
        timestamp: new Date(),
        status: 'success',
        metadata: {
          contractId: this.contractId,
          count: params.recipientAddresses.length,
        },
      };
    } catch (error) {
      const mappedError = this.errorMapper.mapError(error);
      this.logger.error('Failed to batch create aid packages:', mappedError);
      throw error;
    }
  }

  async claimAidPackage(
    params: ClaimAidPackageParams,
  ): Promise<ClaimAidPackageResult> {
    this.ensureContractId();
    this.logger.debug('Claiming aid package:', {
      packageId: params.packageId,
      recipient: params.recipientAddress,
    });

    try {
      const _sdk = await this.loadSorobanSDK();
      const _client = await this.getRpcClient();

      // Implementation would call contract's claim method
      const transactionHash = this.generateMockHash(
        `claim-${params.packageId}-${Date.now()}`,
      );

      return {
        packageId: params.packageId,
        transactionHash,
        timestamp: new Date(),
        status: 'success',
        amountClaimed: '1000000000', // Would come from contract
        metadata: {
          contractId: this.contractId,
          recipient: params.recipientAddress,
        },
      };
    } catch (error) {
      const mappedError = this.errorMapper.mapError(error);
      this.logger.error('Failed to claim aid package:', mappedError);
      throw error;
    }
  }

  async disburseAidPackage(
    params: DisburseAidPackageParams,
  ): Promise<DisburseAidPackageResult> {
    this.ensureContractId();
    this.logger.debug('Disbursing aid package:', {
      packageId: params.packageId,
      operator: params.operatorAddress,
    });

    try {
      const _sdk = await this.loadSorobanSDK();
      const _client = await this.getRpcClient();

      // Implementation would call contract's disburse method
      const transactionHash = this.generateMockHash(
        `disburse-${params.packageId}-${Date.now()}`,
      );

      return {
        packageId: params.packageId,
        transactionHash,
        timestamp: new Date(),
        status: 'success',
        amountDisbursed: '1000000000', // Would come from contract
        metadata: {
          contractId: this.contractId,
          operator: params.operatorAddress,
        },
      };
    } catch (error) {
      const mappedError = this.errorMapper.mapError(error);
      this.logger.error('Failed to disburse aid package:', mappedError);
      throw error;
    }
  }

  async getAidPackage(
    params: GetAidPackageParams,
  ): Promise<GetAidPackageResult> {
    this.ensureContractId();
    this.logger.debug('Getting aid package:', params.packageId);

    try {
      const _sdk = await this.loadSorobanSDK();
      const _client = await this.getRpcClient();

      // Implementation would call contract's get_package method
      // For now, returning a mock response structure
      const mockPackage: AidPackage = {
        id: params.packageId,
        recipient: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        amount: '1000000000',
        token: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        status: 'Created',
        createdAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
      };

      return {
        package: mockPackage,
        timestamp: new Date(),
      };
    } catch (error) {
      const mappedError = this.errorMapper.mapError(error);
      this.logger.error('Failed to get aid package:', mappedError);
      throw error;
    }
  }

  async getAidPackageCount(
    params: GetAidPackageCountParams,
  ): Promise<GetAidPackageCountResult> {
    this.ensureContractId();
    this.logger.debug(
      'Getting aid package aggregates for token:',
      params.token,
    );

    try {
      const _sdk = await this.loadSorobanSDK();
      const _client = await this.getRpcClient();

      // Implementation would call contract's get_aggregates method
      // Returns aggregates for the specified token
      return {
        aggregates: {
          totalCommitted: '5000000000',
          totalClaimed: '2000000000',
          totalExpiredCancelled: '500000000',
        },
        timestamp: new Date(),
      };
    } catch (error) {
      const mappedError = this.errorMapper.mapError(error);
      this.logger.error('Failed to get aid package count:', mappedError);
      throw error;
    }
  }

  async getTokenBalance(
    params: GetTokenBalanceParams,
  ): Promise<GetTokenBalanceResult> {
    this.ensureContractId();
    this.logger.debug('Getting token balance:', {
      tokenAddress: params.tokenAddress,
      accountAddress: params.accountAddress,
    });

    try {
      const _sdk = await this.loadSorobanSDK();
      const _client = await this.getRpcClient();

      // Implementation would call token contract's balance method
      // This is a placeholder showing the expected response
      return {
        tokenAddress: params.tokenAddress,
        accountAddress: params.accountAddress,
        balance: '10000000000', // Mock balance in stroops
        timestamp: new Date(),
      };
    } catch (error) {
      const mappedError = this.errorMapper.mapError(error);
      this.logger.error('Failed to get token balance:', mappedError);
      throw error;
    }
  }

  // Legacy method implementations
  async createClaim(params: CreateClaimParams): Promise<CreateClaimResult> {
    // Delegate to createAidPackage
    const aidPackageParams: CreateAidPackageParams = {
      operatorAddress: 'admin', // Would need to come from context
      packageId: params.claimId,
      recipientAddress: params.recipientAddress,
      amount: params.amount,
      tokenAddress: params.tokenAddress,
      expiresAt: params.expiresAt ?? Math.floor(Date.now() / 1000) + 86400 * 30,
    };

    const result = await this.createAidPackage(aidPackageParams);
    return {
      packageId: result.packageId,
      transactionHash: result.transactionHash,
      timestamp: result.timestamp,
      status: result.status,
      metadata: result.metadata,
    };
  }

  async disburse(params: DisburseParams): Promise<DisburseResult> {
    // Delegate to disburseAidPackage
    const disburseParams: DisburseAidPackageParams = {
      packageId: params.packageId,
      operatorAddress: params.recipientAddress ?? 'admin',
    };

    const result = await this.disburseAidPackage(disburseParams);
    return {
      transactionHash: result.transactionHash,
      timestamp: result.timestamp,
      status: result.status,
      amountDisbursed: result.amountDisbursed,
      metadata: result.metadata,
    };
  }

  /**
   * Helper to generate deterministic hashes (used until actual SDK integration)
   */
  private generateMockHash(input: string): string {
    const hash = createHash('sha256').update(input).digest('hex');
    return hash.substring(0, 64).toUpperCase();
  }
}
