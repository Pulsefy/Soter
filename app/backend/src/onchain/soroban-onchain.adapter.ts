import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import * as StellarSdk from '@stellar/stellar-sdk';

/**
 * Soroban adapter implementation for AidEscrow contract
 * Handles all interactions with the Soroban AidEscrow contract via RPC
 */
@Injectable()
export class SorobanOnchainAdapter implements OnchainAdapter {
  private readonly logger = new Logger(SorobanOnchainAdapter.name);
  private readonly contractId: string;
  private readonly rpcUrl: string;
  private readonly networkPassphrase: string;
  private readonly secretKey: string;
  private readonly errorMapper: SorobanErrorMapper;
  private readonly server: StellarSdk.rpc.Server;
  private readonly keypair: StellarSdk.Keypair;

  constructor(private configService: ConfigService) {
    this.contractId = this.configService.get<string>('SOROBAN_CONTRACT_ID', '');
    this.rpcUrl = this.configService.get<string>(
      'STELLAR_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );
    this.networkPassphrase = this.configService.get<string>(
      'STELLAR_NETWORK_PASSPHRASE',
      StellarSdk.Networks.TESTNET,
    );
    this.secretKey = this.configService.get<string>('SOROBAN_SECRET_KEY', '');
    this.errorMapper = new SorobanErrorMapper();

    this.server = new StellarSdk.rpc.Server(this.rpcUrl, {
      allowHttp: this.rpcUrl.startsWith('http://'),
    });

    if (this.secretKey) {
      this.keypair = StellarSdk.Keypair.fromSecret(this.secretKey);
    } else {
      this.logger.warn('SOROBAN_SECRET_KEY not configured. Write operations will fail.');
    }

    if (!this.contractId) {
      this.logger.warn('SOROBAN_CONTRACT_ID not configured. Contract calls will fail.');
    }
  }

  /**
   * Helper to build and submit a Soroban contract invocation
   */
  private async invokeContract(
    method: string,
    args: StellarSdk.xdr.ScVal[] = [],
  ): Promise<{ response: StellarSdk.rpc.Api.GetTransactionResponse; hash: string }> {
    if (!this.keypair) {
      throw new Error('Secret key not configured for signing');
    }

    this.logger.debug(`Invoking contract method: ${method}`);

    // 1. Fetch account sequence
    const account = await this.server.getAccount(this.keypair.publicKey());

    // 2. Build transaction
    const contract = new StellarSdk.Contract(this.contractId);
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(StellarSdk.TimeoutInfinite)
      .build();

    // 3. Simulate to get footprint and resource fees
    const simulation = await this.server.simulateTransaction(tx);
    if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
      this.logger.error(`Simulation error for ${method}:`, simulation.error);
      throw this.handleSorobanError(simulation.error, method);
    }

    // 4. Assemble transaction with simulation results
    const assembledTx = StellarSdk.rpc.assembleTransaction(tx, simulation).build();

    // 5. Sign
    assembledTx.sign(this.keypair);

    // 6. Submit
    const submission = await this.server.sendTransaction(assembledTx);
    if (submission.status !== 'PENDING') {
      this.logger.error(`Submission error for ${method}:`, submission);
      throw new Error(`Transaction submission failed: ${submission.status}`);
    }

    this.logger.debug(`Transaction submitted: ${submission.hash}`);

    // 7. Poll for status
    const response = await this.pollTransaction(submission.hash);
    return { response, hash: submission.hash };
  }

  /**
   * Poll for transaction completion
   */
  private async pollTransaction(
    hash: string,
    maxRetries = 20,
    intervalMs = 1000,
  ): Promise<StellarSdk.rpc.Api.GetTransactionResponse> {
    for (let i = 0; i < maxRetries; i++) {
      const response = await this.server.getTransaction(hash);
      if (response.status === 'SUCCESS') {
        this.logger.debug(`Transaction ${hash} succeeded`);
        return response;
      }
      if (response.status === 'FAILED') {
        const resultXdr = (response as any).resultXdr;
        this.logger.error(
          `Transaction ${hash} failed:`,
          resultXdr ? resultXdr.toXDR('base64') : 'No result XDR',
        );
        throw this.handleFailedTransaction(response);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Transaction polling timed out for hash: ${hash}`);
  }

  /**
   * Handle failed transaction response
   */
  private handleFailedTransaction(response: StellarSdk.rpc.Api.GetTransactionResponse): Error {
    const resultXdr = (response as any).resultXdr;
    if (resultXdr) {
      try {
        this.logger.error(`Detailed result XDR: ${resultXdr.toXDR('base64')}`);
      } catch (e) {
        this.logger.error('Failed to parse result XDR', e);
      }
    }
    return new Error(`Transaction failed with status: ${response.status}`);
  }

  /**
   * Map Soroban errors to backend exceptions
   */
  private handleSorobanError(error: any, method: string): Error {
    this.logger.error(`Soroban error in ${method}:`, error);
    return this.errorMapper.mapError(error) as any;
  }

  async initEscrow(params: InitEscrowParams): Promise<InitEscrowResult> {
    const adminAddr = StellarSdk.nativeToScVal(params.adminAddress, { type: 'address' });

    try {
      const { response, hash } = await this.invokeContract('init', [adminAddr]);
      return {
        escrowAddress: this.contractId,
        transactionHash: hash,
        timestamp: new Date(),
        status: 'success',
        metadata: { method: 'init' },
      };
    } catch (error) {
      this.errorMapper.throwMappedError(error);
    }
  }

  async createAidPackage(params: CreateAidPackageParams): Promise<CreateAidPackageResult> {
    const args = [
      StellarSdk.nativeToScVal(params.operatorAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(BigInt(params.packageId), { type: 'u64' }),
      StellarSdk.nativeToScVal(params.recipientAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(BigInt(params.amount), { type: 'i128' }),
      StellarSdk.nativeToScVal(params.tokenAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(BigInt(params.expiresAt), { type: 'u64' }),
    ];

    try {
      const { response, hash } = await this.invokeContract('create_package', args);
      return {
        packageId: params.packageId,
        transactionHash: hash,
        timestamp: new Date(),
        status: 'success',
        metadata: { method: 'create_package' },
      };
    } catch (error) {
      this.errorMapper.throwMappedError(error);
    }
  }

  async batchCreateAidPackages(
    params: BatchCreateAidPackagesParams,
  ): Promise<BatchCreateAidPackagesResult> {
    const recipients = params.recipientAddresses.map((addr) =>
      StellarSdk.nativeToScVal(addr, { type: 'address' }),
    );
    const amounts = params.amounts.map((amt) =>
      StellarSdk.nativeToScVal(BigInt(amt), { type: 'i128' }),
    );

    const args = [
      StellarSdk.nativeToScVal(params.operatorAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(recipients, { type: 'vec' }),
      StellarSdk.nativeToScVal(amounts, { type: 'vec' }),
      StellarSdk.nativeToScVal(params.tokenAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(BigInt(params.expiresIn), { type: 'u64' }),
    ];

    try {
      const { response, hash } = await this.invokeContract('batch_create_packages', args);
      return {
        packageIds: [], // Would need to parse from result XDR
        transactionHash: hash,
        timestamp: new Date(),
        status: 'success',
        metadata: { method: 'batch_create_packages' },
      };
    } catch (error) {
      this.errorMapper.throwMappedError(error);
    }
  }

  async claimAidPackage(params: ClaimAidPackageParams): Promise<ClaimAidPackageResult> {
    const args = [StellarSdk.nativeToScVal(BigInt(params.packageId), { type: 'u64' })];

    try {
      const { response, hash } = await this.invokeContract('claim', args);
      return {
        packageId: params.packageId,
        transactionHash: hash,
        timestamp: new Date(),
        status: 'success',
        amountClaimed: '0', // Parse from events if needed
      };
    } catch (error) {
      this.errorMapper.throwMappedError(error);
    }
  }

  async disburseAidPackage(params: DisburseAidPackageParams): Promise<DisburseAidPackageResult> {
    const args = [StellarSdk.nativeToScVal(BigInt(params.packageId), { type: 'u64' })];

    try {
      const { response, hash } = await this.invokeContract('disburse', args);
      return {
        packageId: params.packageId,
        transactionHash: hash,
        timestamp: new Date(),
        status: 'success',
        amountDisbursed: '0',
      };
    } catch (error) {
      this.errorMapper.throwMappedError(error);
    }
  }

  async getAidPackage(params: GetAidPackageParams): Promise<GetAidPackageResult> {
    const idVal = StellarSdk.nativeToScVal(BigInt(params.packageId), { type: 'u64' });
    
    try {
      // Read-only call (simulation is enough)
      const account = await this.server.getAccount(this.keypair.publicKey());
      const contract = new StellarSdk.Contract(this.contractId);
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('get_package', idVal))
        .setTimeout(StellarSdk.TimeoutInfinite)
        .build();

      const simulation = await this.server.simulateTransaction(tx);
      if (StellarSdk.rpc.Api.isSimulationSuccess(simulation)) {
        const resultVal = simulation.result.retval;
        const pkg = StellarSdk.scValToNative(resultVal);
        
        return {
          package: {
            id: pkg.id.toString(),
            recipient: pkg.recipient,
            amount: pkg.amount.toString(),
            token: pkg.token,
            status: this.mapStatus(pkg.status),
            createdAt: Number(pkg.created_at),
            expiresAt: Number(pkg.expires_at),
          },
          timestamp: new Date(),
        };
      }
      throw new Error('Failed to fetch package');
    } catch (error) {
      this.errorMapper.throwMappedError(error);
    }
  }

  private mapStatus(status: any): any {
    const statuses = ['Created', 'Claimed', 'Expired', 'Cancelled', 'Refunded'];
    if (typeof status === 'object' && status.name) return status.name;
    return statuses[status] || 'Created';
  }

  async getAidPackageCount(params: GetAidPackageCountParams): Promise<GetAidPackageCountResult> {
    const tokenVal = StellarSdk.nativeToScVal(params.token, { type: 'address' });
    
    try {
      const account = await this.server.getAccount(this.keypair.publicKey());
      const contract = new StellarSdk.Contract(this.contractId);
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('get_aggregates', tokenVal))
        .setTimeout(StellarSdk.TimeoutInfinite)
        .build();

      const simulation = await this.server.simulateTransaction(tx);
      if (StellarSdk.rpc.Api.isSimulationSuccess(simulation)) {
        const resultVal = simulation.result.retval;
        const aggregates = StellarSdk.scValToNative(resultVal);
        
        return {
          aggregates: {
            totalCommitted: aggregates.total_committed.toString(),
            totalClaimed: aggregates.total_claimed.toString(),
            totalExpiredCancelled: aggregates.total_expired_cancelled.toString(),
          },
          timestamp: new Date(),
        };
      }
      throw new Error('Failed to fetch aggregates');
    } catch (error) {
      this.errorMapper.throwMappedError(error);
    }
  }

  async getTokenBalance(params: GetTokenBalanceParams): Promise<GetTokenBalanceResult> {
    const accountVal = StellarSdk.nativeToScVal(params.accountAddress, { type: 'address' });
    
    try {
      const account = await this.server.getAccount(this.keypair.publicKey());
      const contract = new StellarSdk.Contract(params.tokenAddress);
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call('balance', accountVal))
        .setTimeout(StellarSdk.TimeoutInfinite)
        .build();

      const simulation = await this.server.simulateTransaction(tx);
      if (StellarSdk.rpc.Api.isSimulationSuccess(simulation)) {
        const balance = StellarSdk.scValToNative(simulation.result.retval);
        return {
          tokenAddress: params.tokenAddress,
          accountAddress: params.accountAddress,
          balance: balance.toString(),
          timestamp: new Date(),
        };
      }
      throw new Error('Failed to fetch token balance');
    } catch (error) {
      this.errorMapper.throwMappedError(error);
    }
  }

  // Legacy methods
  async createClaim(params: CreateClaimParams): Promise<CreateClaimResult> {
    const result = await this.createAidPackage({
      operatorAddress: this.keypair.publicKey(),
      packageId: params.claimId,
      recipientAddress: params.recipientAddress,
      amount: params.amount,
      tokenAddress: params.tokenAddress,
      expiresAt: params.expiresAt || Math.floor(Date.now() / 1000) + 86400 * 30,
    });
    
    return {
      packageId: result.packageId,
      transactionHash: result.transactionHash,
      timestamp: result.timestamp,
      status: result.status,
      metadata: result.metadata,
    };
  }

  async disburse(params: DisburseParams): Promise<DisburseResult> {
    const result = await this.disburseAidPackage({
      packageId: params.packageId,
      operatorAddress: this.keypair.publicKey(),
    });
    
    return {
      transactionHash: result.transactionHash,
      timestamp: result.timestamp,
      status: result.status,
      amountDisbursed: result.amountDisbursed,
      metadata: result.metadata,
    };
  }
}
