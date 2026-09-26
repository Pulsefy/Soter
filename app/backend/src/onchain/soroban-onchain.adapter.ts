import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  OnchainAdapter,
  ONCHAIN_ADAPTER_TOKEN,
  InitEscrowParams,
  InitEscrowResult,
  AidPackage,
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
  GetTokenBalanceParams,
  GetTokenBalanceResult,
  CreateClaimParams,
  CreateClaimResult,
  DisburseParams,
  DisburseResult,
  ContractMetadata,
  PauseState,
  FeeConfig,
  PackageSummary,
  GetTransactionStatusParams,
  GetTransactionStatusResult,
  TxStatus,
} from './onchain.adapter';

/**
 * Narrow an RPC result to a plain object so its fields can be read.
 *
 * Soroban RPC responses are untyped JSON, so every field access has to tolerate
 * a missing, null or non-object payload. Returns an empty record rather than
 * null so callers can read through with their existing ?? defaults.
 */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

/** Read a field from an untyped RPC result as a string, with a fallback. */
function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}

const PACKAGE_STATUSES = [
  'Created',
  'Claimed',
  'Expired',
  'Cancelled',
  'Refunded',
] as const satisfies readonly AidPackage['status'][];

/**
 * Read a package status from an untyped RPC result.
 *
 * Falls back to 'Created' when the chain reports a status this build does not
 * recognise, rather than passing an unknown string through the adapter contract.
 */
function readPackageStatus(value: unknown): AidPackage['status'] {
  return PACKAGE_STATUSES.includes(value as AidPackage['status'])
    ? (value as AidPackage['status'])
    : 'Created';
}

/** Calls the Soroban RPC endpoint and returns the result value. */
async function rpcCall(
  http: HttpService,
  rpcUrl: string,
  method: string,
  params: unknown,
): Promise<unknown> {
  const body = { jsonrpc: '2.0', id: 1, method, params };
  const res = await firstValueFrom(http.post(rpcUrl, body));
  if (res.data.error) {
    throw new Error(JSON.stringify(res.data.error));
  }
  return res.data.result;
}

@Injectable()
export class SorobanOnchainAdapter implements OnchainAdapter {
  private readonly logger = new Logger(SorobanOnchainAdapter.name);
  private readonly rpcUrl: string;
  private readonly contractId: string;
  private readonly secretKey: string;
  private readonly networkPassphrase: string;

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {
    this.rpcUrl = config.getOrThrow<string>('SOROBAN_RPC_URL');
    this.contractId = config.getOrThrow<string>('SOROBAN_CONTRACT_ID');
    this.secretKey = config.getOrThrow<string>('SOROBAN_SECRET_KEY');
    const network = config.get<string>('STELLAR_NETWORK', 'testnet');
    this.networkPassphrase =
      network === 'mainnet'
        ? 'Public Global Stellar Network ; September 2015'
        : 'Test SDF Network ; September 2015';
  }

  private async invokeContract(
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    const sim = await rpcCall(this.http, this.rpcUrl, 'simulateTransaction', {
      transaction: JSON.stringify({
        contractId: this.contractId,
        method,
        args,
      }),
    });
    if (sim && typeof sim === 'object' && 'error' in sim) {
      const error = (sim as Record<string, unknown>).error;
      throw new Error('Simulation error: ' + JSON.stringify(error));
    }
    const result = await rpcCall(this.http, this.rpcUrl, 'sendTransaction', {
      transaction: JSON.stringify({
        contractId: this.contractId,
        method,
        args,
        networkPassphrase: this.networkPassphrase,
        secret: this.secretKey,
      }),
    });
    return result && typeof result === 'object' && 'returnValue' in result
      ? (result as Record<string, unknown>).returnValue
      : null;
  }

  async initEscrow(params: InitEscrowParams): Promise<InitEscrowResult> {
    this.logger.log('initEscrow admin=' + params.adminAddress);
    await this.invokeContract('initialize', [params.adminAddress]);
    return {
      escrowAddress: this.contractId,
      transactionHash: '',
      timestamp: new Date(),
      status: 'success',
    };
  }

  async createAidPackage(
    params: CreateAidPackageParams,
  ): Promise<CreateAidPackageResult> {
    this.logger.log('createAidPackage id=' + params.packageId);
    await this.invokeContract('create_package', [
      params.operatorAddress,
      params.packageId,
      params.recipientAddress,
      params.amount,
      params.tokenAddress,
      params.expiresAt,
    ]);
    return {
      packageId: params.packageId,
      transactionHash: '',
      timestamp: new Date(),
      status: 'success',
    };
  }

  async batchCreateAidPackages(
    params: BatchCreateAidPackagesParams,
  ): Promise<BatchCreateAidPackagesResult> {
    const packageIds: string[] = [];
    for (let i = 0; i < params.recipientAddresses.length; i++) {
      const id = String(Date.now()) + '-' + String(i);
      await this.createAidPackage({
        operatorAddress: params.operatorAddress,
        packageId: id,
        recipientAddress: params.recipientAddresses[i],
        amount: params.amounts[i],
        tokenAddress: params.tokenAddress,
        expiresAt: Math.floor(Date.now() / 1000) + params.expiresIn,
      });
      packageIds.push(id);
    }
    return {
      packageIds,
      transactionHash: '',
      timestamp: new Date(),
      status: 'success',
    };
  }

  async claimAidPackage(
    params: ClaimAidPackageParams,
  ): Promise<ClaimAidPackageResult> {
    await this.invokeContract('claim', [
      params.packageId,
      params.receiptPointer ?? null,
    ]);
    return {
      packageId: params.packageId,
      transactionHash: '',
      timestamp: new Date(),
      status: 'success',
      amountClaimed: '0',
    };
  }

  async disburseAidPackage(
    params: DisburseAidPackageParams,
  ): Promise<DisburseAidPackageResult> {
    await this.invokeContract('disburse', [
      params.packageId,
      params.receiptPointer ?? null,
    ]);
    return {
      packageId: params.packageId,
      transactionHash: '',
      timestamp: new Date(),
      status: 'success',
      amountDisbursed: '0',
    };
  }

  async getAidPackage(
    params: GetAidPackageParams,
  ): Promise<GetAidPackageResult> {
    const result = await rpcCall(this.http, this.rpcUrl, 'getContractData', {
      contractId: this.contractId,
      key: params.packageId,
    });
    const pkg = asRecord(result);
    return {
      package: {
        id: params.packageId,
        recipient: readString(pkg.recipient, ''),
        amount: readString(pkg.amount, '0'),
        token: readString(pkg.token, ''),
        status: readPackageStatus(pkg.status),
        createdAt: Number(pkg.created_at ?? 0),
        expiresAt: Number(pkg.expires_at ?? 0),
      },
      timestamp: new Date(),
    };
  }

  async getAidPackageCount(
    params: GetAidPackageCountParams,
  ): Promise<GetAidPackageCountResult> {
    const result = await rpcCall(this.http, this.rpcUrl, 'getContractData', {
      contractId: this.contractId,
      key: 'aggregates_' + params.token,
    });
    const agg = asRecord(result);
    return {
      aggregates: {
        totalCommitted: readString(agg.total_committed, '0'),
        totalClaimed: readString(agg.total_claimed, '0'),
        totalExpiredCancelled: readString(agg.total_expired_cancelled, '0'),
      },
      timestamp: new Date(),
    };
  }

  async getTokenBalance(
    params: GetTokenBalanceParams,
  ): Promise<GetTokenBalanceResult> {
    const result = await rpcCall(this.http, this.rpcUrl, 'getContractData', {
      contractId: params.tokenAddress,
      key: params.accountAddress,
    });
    return {
      tokenAddress: params.tokenAddress,
      accountAddress: params.accountAddress,
      balance: readString(result, '0'),
      timestamp: new Date(),
    };
  }

  async getContractMetadata(): Promise<ContractMetadata> {
    const result = await rpcCall(this.http, this.rpcUrl, 'getContractData', {
      contractId: this.contractId,
      key: 'metadata',
    });
    const meta = asRecord(result);
    return {
      version: readString(meta.version, '1.0.0'),
      name: readString(meta.name, 'Soroban Contract'),
      timestamp: new Date(),
    };
  }

  async getPauseState(): Promise<PauseState> {
    const result = await rpcCall(this.http, this.rpcUrl, 'getContractData', {
      contractId: this.contractId,
      key: 'paused',
    });
    return {
      isPaused: typeof result === 'boolean' ? result : false,
      timestamp: new Date(),
    };
  }

  async getFeeConfig(): Promise<FeeConfig> {
    const result = await rpcCall(this.http, this.rpcUrl, 'getContractData', {
      contractId: this.contractId,
      key: 'fee_config',
    });
    const fee = asRecord(result);
    return {
      feePercentage: readString(fee.fee_percentage, '0'),
      maxFee: readString(fee.max_fee, '0'),
      timestamp: new Date(),
    };
  }

  async getPackageSummary(packageId: string): Promise<PackageSummary> {
    const result = await rpcCall(this.http, this.rpcUrl, 'getContractData', {
      contractId: this.contractId,
      key: 'summary_' + packageId,
    });
    const summary = asRecord(result);
    return {
      packageId,
      totalAmount: readString(summary.total_amount, '0'),
      claimedAmount: readString(summary.claimed_amount, '0'),
      status: readString(summary.status, 'Active'),
      timestamp: new Date(),
    };
  }

  async createClaim(params: CreateClaimParams): Promise<CreateClaimResult> {
    const result = await this.createAidPackage({
      operatorAddress: this.secretKey,
      packageId: params.claimId,
      recipientAddress: params.recipientAddress,
      amount: params.amount,
      tokenAddress: params.tokenAddress,
      expiresAt: params.expiresAt ?? Math.floor(Date.now() / 1000) + 86400 * 30,
    });
    return {
      packageId: result.packageId,
      transactionHash: result.transactionHash,
      timestamp: result.timestamp,
      status: result.status,
    };
  }

  async disburse(params: DisburseParams): Promise<DisburseResult> {
    const result = await this.disburseAidPackage({
      packageId: params.packageId,
      operatorAddress: params.recipientAddress ?? this.secretKey,
      receiptPointer: params.receiptPointer,
    });
    return {
      transactionHash: result.transactionHash,
      timestamp: result.timestamp,
      status: result.status,
      amountDisbursed: result.amountDisbursed,
    };
  }

  async getTransactionStatus(
    params: GetTransactionStatusParams,
  ): Promise<GetTransactionStatusResult> {
    const hash = params.hash.toUpperCase();
    try {
      const result = await rpcCall(this.http, this.rpcUrl, 'getTransaction', {
        hash,
      });
      const r = asRecord(result);
      let status: TxStatus;
      switch (r.status) {
        case 'SUCCESS':
          status = 'succeeded';
          break;
        case 'FAILED':
          status = 'failed';
          break;
        case 'NOT_FOUND':
          status = 'pending';
          break;
        default:
          status = 'unknown';
      }
      return {
        hash,
        status,
        timestamp: new Date(),
        ledger: typeof r.ledger === 'number' ? r.ledger : undefined,
        errorMessage:
          status === 'failed'
            ? readString(r.resultXdr, 'Transaction failed')
            : undefined,
      };
    } catch {
      return { hash, status: 'unknown', timestamp: new Date() };
    }
  }
}

export { ONCHAIN_ADAPTER_TOKEN };
