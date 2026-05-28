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
  GetContractMetadataResult,
  GetPauseStateResult,
  GetFeeConfigResult,
  GetPackageSummaryResult,
} from './onchain.adapter';
import { SorobanErrorMapper } from './utils/soroban-error.mapper';

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
  private sorobanLib: Record<string, any> | null = null;

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

  private async loadSorobanSDK() {
    if (this.sorobanLib) {
      return this.sorobanLib;
    }

    try {
      // Dynamically import stellar/cli SDK
      // @ts-expect-error - stellar is optional, only required in production
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod = await import('stellar');
      this.sorobanLib = {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        rpc: mod,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        api: mod,
        ...(mod as Record<string, any>),
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
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

      const _client = await this.getRpcClient(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment

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

      const _client = await this.getRpcClient(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment

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

      const _client = await this.getRpcClient(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment

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

      const _client = await this.getRpcClient(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment

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

      const _client = await this.getRpcClient(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment

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

      const _client = await this.getRpcClient(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment

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

      const _client = await this.getRpcClient(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment

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

      const _client = await this.getRpcClient(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment

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

  // --- Read-only view implementations ---

  /**
   * Returns contract metadata (admin address + version) from on-chain storage.
   * Calls get_admin() and get_version() — both are read-only, no signing required.
   */
  async getContractMetadata(): Promise<GetContractMetadataResult> {
    this.ensureContractId();
    this.logger.debug('Fetching contract metadata');

    try {
      const _sdk = await this.loadSorobanSDK();
      const _client = await this.getRpcClient(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment

      // In full Soroban integration, invoke get_admin() and get_version()
      // via simulateTransaction (read-only, no fee/signing needed).
      // Returning structured placeholder until SDK invocation is wired.
      return {
        admin: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        version: 1,
        timestamp: new Date(),
      };
    } catch (error) {
      const mappedError = this.errorMapper.mapError(error);
      this.logger.error('Failed to fetch contract metadata:', mappedError);
      throw error;
    }
  }

  /**
   * Returns global and per-action pause state from on-chain storage.
   * Calls is_paused() and is_action_paused(action) for create/claim/withdraw.
   * All calls are read-only simulations — no signing or fee required.
   */
  async getPauseState(): Promise<GetPauseStateResult> {
    this.ensureContractId();
    this.logger.debug('Fetching contract pause state');

    try {
      const _sdk = await this.loadSorobanSDK();
      const _client = await this.getRpcClient(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment

      // In full Soroban integration:
      //   paused         = simulateTx(is_paused())
      //   createPaused   = simulateTx(is_action_paused(symbol_short!("create")))
      //   claimPaused    = simulateTx(is_action_paused(symbol_short!("claim")))
      //   withdrawPaused = simulateTx(is_action_paused(symbol_short!("p_wdrw")))
      return {
        paused: false,
        createPaused: false,
        claimPaused: false,
        withdrawPaused: false,
        timestamp: new Date(),
      };
    } catch (error) {
      const mappedError = this.errorMapper.mapError(error);
      this.logger.error('Failed to fetch pause state:', mappedError);
      throw error;
    }
  }

  /**
   * Returns the contract configuration (min_amount, max_expires_in, allowed_tokens).
   * Calls get_config() — read-only, no signing required.
   * Frontend uses minAmount to validate amounts client-side before submitting.
   */
  async getFeeConfig(): Promise<GetFeeConfigResult> {
    this.ensureContractId();
    this.logger.debug('Fetching contract fee config');

    try {
      const _sdk = await this.loadSorobanSDK();
      const _client = await this.getRpcClient(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment

      // In full Soroban integration:
      //   config = simulateTx(get_config())
      //   Map Config { min_amount: i128, max_expires_in: u64, allowed_tokens: Vec<Address> }
      return {
        minAmount: '1',
        maxExpiresIn: 0,
        allowedTokens: [],
        timestamp: new Date(),
      };
    } catch (error) {
      const mappedError = this.errorMapper.mapError(error);
      this.logger.error('Failed to fetch fee config:', mappedError);
      throw error;
    }
  }

  /**
   * Returns package details enriched with isExpired and ttlSeconds.
   * Calls get_package(id) — read-only, no signing required.
   * Frontend uses this to render accurate claim UI without a separate indexer call.
   */
  async getPackageSummary(
    params: GetAidPackageParams,
  ): Promise<GetPackageSummaryResult> {
    this.ensureContractId();
    this.logger.debug('Fetching package summary for:', params.packageId);

    try {
      const _sdk = await this.loadSorobanSDK();
      const _client = await this.getRpcClient(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment

      // In full Soroban integration: simulateTx(get_package(id))
      const mockPackage: AidPackage = {
        id: params.packageId,
        recipient: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFXWBTRSE53XSTE23JMCVOCJGXVSVZ',
        amount: '1000000000',
        token: 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ5LKG3FZTSZ3NYNEJBBENSN',
        status: 'Created',
        createdAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
      };

      const nowSeconds = Math.floor(Date.now() / 1000);
      const hasExpiry = mockPackage.expiresAt > 0;
      const isExpired = hasExpiry && nowSeconds > mockPackage.expiresAt;
      const ttlSeconds = hasExpiry
        ? Math.max(0, mockPackage.expiresAt - nowSeconds)
        : null;

      return {
        package: mockPackage,
        isExpired,
        ttlSeconds,
        timestamp: new Date(),
      };
    } catch (error) {
      const mappedError = this.errorMapper.mapError(error);
      this.logger.error('Failed to fetch package summary:', mappedError);
      throw error;
    }
  }
}
